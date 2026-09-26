// Loads every HyperFrames catalog item in headless Chromium through the same
// path Remotion uses (page + injected runtime + __hf.seek), captures a poster,
// and writes a pass/fail report plus contact sheets.
//
//   node scripts/hyperframes-probe.mjs [--only name,name] [--browser <path>]
//
// Output: motion-library/hyperframes/PROBE.json, motion-library/hyperframes/sheet-*.jpg
// (thumbnails go to .studio-cache/hyperframes/thumbs).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { hyperframesLayerData, hyperframesPageUrl } from '@studio-engine/scene-engine';

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, '..', 'public');
const repoRoot = resolve(here, '..', '..', '..');
const thumbs = join(repoRoot, '.studio-cache', 'hyperframes', 'thumbs');
const outDir = join(repoRoot, 'motion-library', 'hyperframes');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--only')?.split(',');
const browserPath = opt('--browser') ?? process.env.REMOTION_BROWSER ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.txt': 'text/plain',
};

export function serveStatic(root) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

/** URL of an item, built by the engine exactly as for the Remotion component. Snippets get a dark host background. */
export function itemUrl(base, catalog, item, variables = {}) {
  const use = { item: item.name, type: item.type, variables, ...(item.mount === 'host' ? { background: '#0b0c0e' } : {}) };
  return `${base}/${hyperframesPageUrl(hyperframesLayerData(use, catalog))}`;
}

async function probe(page, base, catalog, item) {
  const errors = [];
  const onError = (e) => errors.push(String(e.message ?? e).slice(0, 300));
  const onConsole = (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text().slice(0, 300)); };
  const onResponse = (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().replace(base, '')}`); };
  page.on('pageerror', onError); page.on('console', onConsole); page.on('response', onResponse);
  const t0 = Date.now();
  let ok = false; let duration = 0; let reason = '';
  try {
    await page.goto(itemUrl(base, catalog, item), { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => !!(window.__hf && typeof window.__hf.seek === 'function' && window.__hf.duration > 0 && window.__renderReady !== false), null, { timeout: 30000, polling: 100 });
    duration = await page.evaluate(() => window.__hf.duration);
    const t = Math.max(0, Math.min(duration * 0.6, duration - 0.1));
    await page.evaluate(async (time) => {
      await document.fonts.ready;
      window.__hf.seek(time);
      await window.__hfWaitForSeekCompletion?.();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, t);
    await page.screenshot({ path: join(thumbs, `${item.type}-${item.name}.jpg`), type: 'jpeg', quality: 72 });
    ok = true;
  } catch (e) {
    reason = String(e.message ?? e).split('\n')[0].slice(0, 200);
  }
  page.off('pageerror', onError); page.off('console', onConsole); page.off('response', onResponse);
  return { name: item.name, type: item.type, ok, reason, duration, ms: Date.now() - t0, errors: [...new Set(errors)].slice(0, 5) };
}

async function contactSheets(page, base, results) {
  const passed = results.filter((r) => existsSync(join(thumbs, `${r.type}-${r.name}.jpg`)));
  const perSheet = 48;
  const sheets = [];
  for (let s = 0; s * perSheet < passed.length; s++) {
    const chunk = passed.slice(s * perSheet, (s + 1) * perSheet);
    const cells = chunk.map((r) => {
      const img = `data:image/jpeg;base64,${readFileSync(join(thumbs, `${r.type}-${r.name}.jpg`)).toString('base64')}`;
      return `<figure><img src="${img}"><figcaption>${r.type === 'block' ? '■' : '◆'} ${r.name}</figcaption></figure>`;
    }).join('');
    await page.setContent(`<style>body{margin:0;background:#111;font:13px Inter,sans-serif;color:#ddd;display:grid;grid-template-columns:repeat(6,320px);gap:6px;padding:6px;width:1962px}
      figure{margin:0}img{width:320px;height:180px;display:block;object-fit:cover;background:#000}figcaption{padding:3px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style>${cells}`);
    const file = join(outDir, `sheet-${String(s + 1).padStart(2, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 70, fullPage: true });
    sheets.push(file);
  }
  return sheets;
}

async function main() {
  const catalog = JSON.parse(readFileSync(join(pub, 'hyperframes', 'catalog.json'), 'utf8'));
  const items = catalog.items.filter((i) => !only || only.includes(i.name));
  mkdirSync(thumbs, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await serveStatic(pub);
  const browser = await chromium.launch({ executablePath: browserPath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 / 6 });
  const results = [];
  let page = await context.newPage();
  for (const item of items) {
    const r = await probe(page, url, catalog, item);
    results.push(r);
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${item.type.padEnd(9)} ${item.name.padEnd(34)} ${String(r.ms).padStart(6)}ms ${r.reason} ${r.errors[0] ?? ''}`);
    if (!r.ok) { await page.close(); page = await context.newPage(); }
  }
  const failed = results.filter((r) => !r.ok);
  if (!only) {
    writeFileSync(join(outDir, 'PROBE.json'), `${JSON.stringify({ commit: catalog.commit, total: results.length, passed: results.length - failed.length, results }, null, 1)}\n`);
    const sheetPage = await (await browser.newContext({ viewport: { width: 1962, height: 800 } })).newPage();
    const sheets = await contactSheets(sheetPage, url, results);
    console.log(`contact sheets: ${sheets.length}`);
  }
  console.log(`${results.length - failed.length}/${results.length} items render`);
  await browser.close();
  server.close();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
