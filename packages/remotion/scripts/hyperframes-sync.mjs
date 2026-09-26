// Imports the full HyperFrames catalog (Apache-2.0, heygen-com/hyperframes) into
// public/hyperframes so Remotion can render any block or component offline.
//
//   node scripts/hyperframes-sync.mjs            # clone the pinned commit into .studio-cache
//   HYPERFRAMES_DIR=/path/to/hyperframes node scripts/hyperframes-sync.mjs
//
// What it does:
//   1. copies registry/blocks and registry/components (pinned commit);
//   2. mirrors every cdn.jsdelivr.net / cdnjs dependency from the npm registry
//      (only the files actually referenced, plus their relative ES imports);
//   3. replaces Google Fonts with @fontsource files (latin subset);
//   4. injects the HyperFrames runtime + a variables bridge at the head of every page;
//   5. writes catalog.json (metadata, variables, embedded media, dependencies).
//
// The generated tree is git-ignored. catalog.json is also copied to
// packages/engine/hyperframes-catalog.json, which is committed so the brain can pick
// blocks without running the sync.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HYPERFRAMES_REPO = 'https://github.com/heygen-com/hyperframes.git';
export const HYPERFRAMES_COMMIT = '8798e40';
export const HYPERFRAMES_CORE = '@hyperframes/core@0.8.78';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '..', '..');
const cache = join(repoRoot, '.studio-cache', 'hyperframes');
const out = join(pkgRoot, 'public', 'hyperframes');
const engineCatalog = join(repoRoot, 'packages', 'engine', 'hyperframes-catalog.json');
const studioRoot = join(pkgRoot, 'hyperframes-studio');

const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.svg']);
const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.glb', '.gltf', '.hdr', '.wav', '.mp3', '.mp4', '.webm', '.mov']);
const JSDELIVR = 'https://cdn.jsdelivr.net/npm/';
// cdnjs URLs used by the catalog, mapped to the same file on npm.
const CDNJS = {
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js': 'three@0.128.0/build/three.min.js',
};
// Directory URLs (DRACO decoder path) mapped to an npm directory; the listed files are mirrored.
const DIRS = {
  'https://www.gstatic.com/draco/versioned/decoders/1.5.6/': {
    to: 'three@0.147.0/examples/js/libs/draco/',
    files: ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'],
  },
};

const log = (...a) => console.log('[hyperframes]', ...a);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();

// ---------------------------------------------------------------------------
// 1. Source
function sourceDir() {
  if (process.env.HYPERFRAMES_DIR) return resolve(process.env.HYPERFRAMES_DIR);
  const dir = join(cache, 'src');
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(cache, { recursive: true });
    log(`cloning ${HYPERFRAMES_REPO}`);
    sh('git', ['clone', '--filter=blob:none', '--no-checkout', HYPERFRAMES_REPO, dir], { stdio: 'inherit' });
  }
  sh('git', ['-C', dir, 'checkout', '--quiet', HYPERFRAMES_COMMIT, '--', 'registry', 'LICENSE']);
  return dir;
}

// ---------------------------------------------------------------------------
// 2. npm mirror
function npmPackage(spec) {
  // spec: "three@0.147.0", "d3@7", "@fontsource/inter@5.3.0", "@fontsource/inter" (latest)
  const dir = join(cache, 'npm', spec.replace('/', '__'));
  const pkg = join(dir, 'package');
  if (existsSync(join(pkg, 'package.json'))) return pkg;
  mkdirSync(dir, { recursive: true });
  const file = sh('npm', ['pack', spec, '--silent', '--pack-destination', dir]).trim().split('\n').pop();
  sh('tar', ['-xzf', join(dir, file), '-C', dir]);
  rmSync(join(dir, file));
  return pkg;
}

function tryNpmPackage(spec) {
  try { return npmPackage(spec); } catch { return null; }
}

/** "three@0.147.0/build/three.min.js" -> { spec: "three@0.147.0", file: "build/three.min.js" } */
function splitNpmPath(p) {
  const parts = p.split('/');
  const n = p.startsWith('@') ? 2 : 1;
  return { spec: parts.slice(0, n).join('/'), file: parts.slice(n).join('/') };
}

const IMPORT_RE = /(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const mirrored = new Set();
/** Copies one npm file (and, for ES modules, its relative imports) into out/npm. */
function mirrorNpmFile(npmPath, transitive = false) {
  if (mirrored.has(npmPath)) return;
  mirrored.add(npmPath);
  const { spec, file } = splitNpmPath(npmPath);
  const pkg = npmPackage(spec);
  let src = join(pkg, file);
  if (!existsSync(src) || statSync(src).isDirectory()) {
    // jsdelivr serves "pkg@ver" (no file) as the package's main entry.
    const main = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    const entry = main.jsdelivr || main.unpkg || main.browser || main.main;
    if (!file && typeof entry === 'string') src = join(pkg, entry);
    else if (existsSync(`${src}.js`)) src = `${src}.js`;
    if (!existsSync(src)) {
      // A regex-found "import" inside a string or comment of a transitive file is not fatal.
      if (transitive) return;
      throw new Error(`npm file not found: ${npmPath}`);
    }
  }
  const dest = join(out, 'npm', spec, file || 'index.js');
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
  if (/\.m?js$/.test(src)) {
    const code = readFileSync(src, 'utf8');
    for (const m of code.matchAll(IMPORT_RE)) {
      const s = m[1] || m[2];
      if (s.startsWith('./') || s.startsWith('../')) mirrorNpmFile(`${spec}/${posix.join(posix.dirname(file), s)}`, true);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Fonts (Google Fonts -> @fontsource, latin subset)
const fontCss = new Map(); // google url -> relative css file (from out)
const fontFamilies = new Set();

function fontsourceFaces(family) {
  const id = family.toLowerCase().replace(/\s+/g, '-');
  for (const scope of ['@fontsource', '@fontsource-variable']) {
    const pkg = tryNpmPackage(`${scope}/${id}`);
    if (!pkg) continue;
    const files = readdirSync(join(pkg, 'files')).filter((f) => f.endsWith('.woff2') && f.includes('-latin-') && !f.includes('-latin-ext-'));
    if (!files.length) continue;
    const faces = [];
    for (const f of files) {
      // inter-latin-400-normal.woff2 | roboto-flex-latin-wght-normal.woff2 | ...-standard-normal
      const m = f.match(/-latin-([a-z0-9]+)-(normal|italic)\.woff2$/);
      if (!m) continue;
      const weight = /^\d+$/.test(m[1]) ? m[1] : '100 900';
      const dest = join(out, 'fonts', id, f);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(pkg, 'files', f), dest);
      faces.push({ file: `${id}/${f}`, weight, style: m[2] });
    }
    // Prefer static weights when both exist.
    const statics = faces.filter((x) => x.weight !== '100 900');
    return { id, pkg: scope, faces: statics.length ? statics : faces };
  }
  return null;
}

const facesCache = new Map();
function googleFontsCss(url) {
  const clean = url.replace(/&amp;/g, '&');
  if (fontCss.has(clean)) return fontCss.get(clean);
  const families = [...new URL(clean).searchParams.getAll('family')].map((f) => f.split(':')[0].replace(/\+/g, ' ').trim()).filter(Boolean);
  let css = `/* Local replacement for ${clean} (generated from @fontsource). */\n`;
  for (const family of families) {
    if (!facesCache.has(family)) facesCache.set(family, fontsourceFaces(family));
    const found = facesCache.get(family);
    if (!found) { log(`WARN font not on @fontsource: ${family}`); continue; }
    fontFamilies.add(`${family} (${found.pkg}/${found.id})`);
    for (const f of found.faces) {
      css += `@font-face{font-family:'${family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url('./${f.file}') format('woff2');}\n`;
    }
  }
  const name = `fonts/g-${createHash('sha1').update(clean).digest('hex').slice(0, 10)}.css`;
  writeFileSync(join(out, name), css);
  fontCss.set(clean, name);
  return name;
}

// ---------------------------------------------------------------------------
// 4. Rewriting
function rel(fromFile, target) {
  const r = relative(dirname(fromFile), join(out, target)).split('\\').join('/');
  return r.startsWith('.') ? r : `./${r}`;
}

function rewrite(file, text) {
  const deps = new Set();
  // Google Fonts: drop preconnects, point stylesheets/@imports at local CSS.
  text = text.replace(/<link[^>]*rel="preconnect"[^>]*>\s*/g, '');
  text = text.replace(/https:\/\/fonts\.googleapis\.com\/css2\?[^"')\s]+/g, (u) => rel(file, googleFontsCss(u)));
  for (const [from, to] of Object.entries(CDNJS)) {
    if (text.includes(from)) { mirrorNpmFile(to); deps.add(splitNpmPath(to).spec); text = text.split(from).join(rel(file, `npm/${to}`)); }
  }
  for (const [from, { to, files }] of Object.entries(DIRS)) {
    if (!text.includes(from)) continue;
    for (const f of files) mirrorNpmFile(to + f);
    deps.add(splitNpmPath(to).spec);
    text = text.split(from).join(`${rel(file, `npm/${to}`)}/`);
  }
  // Import-map prefixes ("three/addons/": ".../examples/jsm/"): mirror each used specifier.
  const prefixes = [...text.matchAll(/"([^"]+\/)"\s*:\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/([^"]+\/)"/g)];
  for (const [, key, target] of prefixes) {
    for (const m of text.matchAll(IMPORT_RE)) {
      const s = m[1] || m[2];
      if (s.startsWith(key)) mirrorNpmFile(target + s.slice(key.length));
    }
  }
  text = text.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/([^"'`)\s]+)/g, (_, p) => {
    if (!p.endsWith('/')) mirrorNpmFile(p);
    deps.add(splitNpmPath(p).spec);
    // Import-map prefixes must keep their trailing slash.
    return rel(file, `npm/${p}`) + (p.endsWith('/') ? '/' : '');
  });
  return { text, deps };
}

function injectHead(file, html) {
  const tags = `<script src="${rel(file, 'hf-bridge.js')}"></script><script src="${rel(file, 'hyperframe.runtime.js')}"></script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tags}`);
  return tags + html;
}

// ---------------------------------------------------------------------------
// 5. Catalog
function parseHtmlVariables(html) {
  const m = html.match(/data-composition-variables='([\s\S]*?)'/);
  if (!m) return [];
  try { return JSON.parse(m[1]); } catch { return []; }
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/** Copies one item (registry or studio) into out/<type>/<name>, rewrites it, returns its catalog entry. */
function importItem(dir, type, name, source) {
  const meta = JSON.parse(readFileSync(join(dir, 'registry-item.json'), 'utf8'));
  const dest = join(out, type, name);
  cpSync(dir, dest, { recursive: true, filter: (p) => !/\/(source|node_modules)(\/|$)/.test(p.slice(dir.length)) });
  const deps = new Set();
  const media = [];
  for (const f of walk(dest)) {
    const ext = extname(f).toLowerCase();
    if (MEDIA_EXT.has(ext)) media.push(relative(dest, f));
    if (!TEXT_EXT.has(ext) || f.endsWith('registry-item.json')) continue;
    let text = readFileSync(f, 'utf8');
    const r = rewrite(f, text);
    text = r.text;
    r.deps.forEach((d) => deps.add(d));
    if (ext === '.html' && /__timelines|data-composition-id/.test(text)) text = injectHead(f, text);
    writeFileSync(f, text);
  }
  const entry = `${name}.html`;
  let html = readFileSync(join(dest, entry), 'utf8');
  // Files listed by the registry but not in the repository (fetched from HeyGen's CDN by
  // their installer, e.g. album covers of the carousels): the item renders with holes.
  const missingFiles = (meta.files ?? []).map((f) => f.path).filter((f) => !existsSync(join(dest, f)));
  const snippetRoot = type === 'components' || /<body[^>]*>\s*<template/i.test(html);
  if (snippetRoot) {
    // Snippets are mounted from host.html: installed-path references ("assets/x" per the
    // registry's `target`) are resolved from the hyperframes root, so point them at the file.
    let changed = false;
    for (const f of meta.files ?? []) {
      if (!f.target || f.target === f.path || !existsSync(join(dest, f.path)) || f.path.endsWith('.html')) continue;
      if (html.includes(f.target)) { html = html.split(f.target).join(`${type}/${name}/${f.path}`); changed = true; }
    }
    if (changed) writeFileSync(join(dest, entry), html);
  }
  const variables = meta.variables ?? parseHtmlVariables(html);
  // Elastic components take the host's duration; their demo page gives a sensible default.
  const own = meta.duration ?? Number(html.match(/data-duration="([\d.]+)"/)?.[1] ?? 0);
  const demoHtml = existsSync(join(dest, 'demo.html')) ? readFileSync(join(dest, 'demo.html'), 'utf8') : '';
  const duration = own || Number(demoHtml.match(/data-duration="([\d.]+)"/)?.[1] ?? 0) || 5;
  // Snippets (<template> roots, all components and a few blocks) are mounted by host.html.
  const snippet = snippetRoot;
  const compositionId = html.match(/data-composition-id="([^"]+)"/)?.[1] ?? name;
  return {
    name,
    type: type === 'blocks' ? 'block' : 'component',
    title: meta.title ?? name,
    description: meta.description ?? '',
    tags: meta.tags ?? [],
    family: meta.family,
    jobs: meta.jobs,
    dimensions: meta.dimensions ?? { width: 1920, height: 1080 },
    duration,
    ...(own && !meta.elastic ? {} : { elasticDuration: true }),
    path: `hyperframes/${type}/${name}/${entry}`,
    mount: snippet ? 'host' : 'page',
    ...(compositionId !== name ? { compositionId } : {}),
    demo: type === 'components' && existsSync(join(dest, 'demo.html')) ? `hyperframes/${type}/${name}/demo.html` : undefined,
    variables: variables.map((v) => ({
      id: v.id, type: v.type, role: v.role, label: v.label, description: v.description,
      default: v.default, options: v.options?.map((o) => o.value ?? o),
    })),
    params: meta.params ?? [],
    embeddedMedia: media.sort(),
    ...(missingFiles.length ? { missingFiles } : {}),
    dependencies: [...deps].sort(),
    preview: meta.preview?.poster,
    ...(source === 'studio' ? { source } : {}),
  };
}

function main() {
  const src = sourceDir();
  const reg = join(src, 'registry');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'fonts'), { recursive: true });
  cpSync(join(src, 'LICENSE'), join(out, 'LICENSE'));

  // Runtime + bridge.
  const core = npmPackage(HYPERFRAMES_CORE);
  cpSync(join(core, 'dist', 'hyperframe.runtime.iife.js'), join(out, 'hyperframe.runtime.js'));
  cpSync(join(here, 'hyperframes', 'hf-bridge.js'), join(out, 'hf-bridge.js'));
  const hostFonts = googleFontsCss('https://fonts.googleapis.com/css2?family=Inter&family=Source+Serif+4&family=JetBrains+Mono');
  writeFileSync(join(out, 'host.html'), readFileSync(join(here, 'hyperframes', 'host.html'), 'utf8').replace('__FONTS_CSS__', hostFonts));

  const items = [];
  for (const type of ['blocks', 'components']) {
    for (const name of readdirSync(join(reg, type)).sort()) {
      const dir = join(reg, type, name);
      if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'registry-item.json'))) continue;
      items.push(importItem(dir, type, name, 'hyperframes'));
    }
  }
  // Studio blocks (packages/remotion/hyperframes-studio): our own HyperFrames compositions,
  // sharing _studio/ (design system, helpers, fonts).
  cpSync(join(studioRoot, '_studio'), join(out, 'blocks', '_studio'), { recursive: true });
  const interVar = npmPackage('@fontsource-variable/inter@5.3.0');
  cpSync(join(interVar, 'files', 'inter-latin-opsz-normal.woff2'), join(out, 'blocks', '_studio', 'inter-opsz.woff2'));
  const serif = npmPackage('@fontsource/source-serif-4@5.3.0');
  for (const w of [400, 600]) cpSync(join(serif, 'files', `source-serif-4-latin-${w}-normal.woff2`), join(out, 'blocks', '_studio', `source-serif-${w}.woff2`));
  for (const name of readdirSync(studioRoot).sort()) {
    const dir = join(studioRoot, name);
    if (name.startsWith('_') || !statSync(dir).isDirectory() || !existsSync(join(dir, 'registry-item.json'))) continue;
    items.push(importItem(dir, 'blocks', name, 'studio'));
  }
  // Results of scripts/hyperframes-probe.mjs (headless Chromium) for this commit, when available.
  const probeFile = join(repoRoot, 'motion-library', 'hyperframes', 'PROBE.json');
  const probe = existsSync(probeFile) ? JSON.parse(readFileSync(probeFile, 'utf8')) : undefined;
  if (probe?.commit === HYPERFRAMES_COMMIT) {
    for (const item of items) {
      const r = probe.results.find((x) => x.name === item.name && x.type === item.type);
      if (r && !r.ok) item.unsupported = [r.reason, ...r.errors].filter(Boolean).join(' | ').slice(0, 300);
    }
  }
  const catalog = {
    source: HYPERFRAMES_REPO,
    commit: HYPERFRAMES_COMMIT,
    runtime: HYPERFRAMES_CORE,
    license: 'Apache-2.0 (HyperFrames). GSAP: Standard "no charge" license (not OSI).',
    fonts: [...fontFamilies].sort(),
    items,
  };
  const json = `${JSON.stringify(catalog, null, 1)}\n`;
  writeFileSync(join(out, 'catalog.json'), json);
  writeFileSync(engineCatalog, json);
  const blocks = items.filter((i) => i.type === 'block').length;
  log(`${blocks} blocks, ${items.length - blocks} components, ${mirrored.size} npm files, ${fontFamilies.size} font families`);
  log(`items with embedded media: ${items.filter((i) => i.embeddedMedia.length).length}`);
}

main();
