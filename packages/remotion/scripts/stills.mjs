// Control sheet of a plan before any full render: 3 stills per shot (full resolution, assembled),
// taken on the studio / HyperFrames block of each shot, at the exact data the render will use.
//
//   npm run stills -- <plan.json> [--out <sheet.jpg>] [--shots u1,u2] [--at 0.25,0.6,0.97]
//
// Shots without a block (video, engine document…) get a labelled placeholder: check those in a render.
// Needs public/hyperframes (npm run hyperframes:sync -w @studio-engine/remotion) and ffmpeg.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { compileShotPlan, hyperframesPageUrl, hyperframesTimeAt } from '@studio-engine/scene-engine';
import { createRequire } from 'node:module';
import { serveStatic } from './hyperframes-probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, '..', 'public');
const repoRoot = resolve(here, '..', '..', '..');
// npm runs scripts from the package root: resolve the plan from where the command was typed
// (npm's INIT_CWD), then the current directory, then the repo root.
const bases = [...new Set([process.env.INIT_CWD, process.cwd(), repoRoot].filter(Boolean))];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const planArg = args.find((a, i) => !a.startsWith('--') && !['--out', '--shots', '--at', '--browser'].includes(args[i - 1]));
if (!planArg) {
  console.error('usage: npm run stills -- <plan.json> [--out <sheet.jpg>] [--shots u1,u2] [--at 0.25,0.6,0.97]');
  process.exit(2);
}
if (!existsSync(join(pub, 'hyperframes', 'hyperframe.runtime.js'))) {
  console.error('public/hyperframes is missing: run "npm run hyperframes:sync -w @studio-engine/remotion" first');
  process.exit(2);
}
const planPath = bases.map((b) => resolve(b, planArg)).find((p) => existsSync(p)) ?? resolve(bases[0], planArg);
const cwd = bases.find((b) => existsSync(resolve(b, planArg))) ?? bases[0];
const out = opt('--out') ? resolve(cwd, opt('--out')) : join(dirname(planPath), 'out', `${basename(planPath, '.json')}-stills.jpg`);
const only = opt('--shots')?.split(',');
const fractions = (opt('--at') ?? '0.25,0.6,0.97').split(',').map(Number);
const browserPath = opt('--browser') ?? process.env.REMOTION_BROWSER ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const catalog = JSON.parse(readFileSync(join(repoRoot, 'packages', 'engine', 'hyperframes-catalog.json'), 'utf8'));
const compiled = compileShotPlan(plan, { hyperframes: catalog });
if (!compiled.ok) {
  for (const e of compiled.errors) console.error(`${e.path}: ${e.message}`);
  process.exit(1);
}
const tmp = join(repoRoot, '.studio-cache', 'stills', String(process.pid));
mkdirSync(tmp, { recursive: true });
mkdirSync(dirname(out), { recursive: true });

const { server, url } = await serveStatic(pub);
const browser = await chromium.launch({ executablePath: browserPath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const files = [];
const labels = [];
try {
  for (const scene of compiled.project.scenes) {
    if (only && !only.includes(scene.id)) continue;
    const layer = scene.layers.find((l) => l.type === 'graphic' && l.kind === 'hyperframes');
    if (!layer) {
      for (const f of fractions) {
        const file = join(tmp, `${files.length}.jpg`);
        execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1c1c1e:s=1920x1080:d=1', '-frames:v', '1', file]);
        files.push(file);
        labels.push(`${scene.id} · no block (engine composition) · ${Math.round(f * 100)}%`);
      }
      continue;
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`${scene.id}: ${e.message.slice(0, 200)}`));
    await page.goto(`${url}/${hyperframesPageUrl(layer.data)}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__hf && window.__hf.duration > 0, null, { timeout: 30000 });
    for (const f of fractions) {
      const frame = Math.round(f * (scene.durationInFrames - 1));
      const t = hyperframesTimeAt(layer.data, frame, plan.fps);
      await page.evaluate(async (time) => {
        await document.fonts.ready;
        window.__hf.seek(time);
        await window.__hfWaitForSeekCompletion?.();
        await window.__studioSettle?.();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, t);
      const file = join(tmp, `${files.length}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
      files.push(file);
      labels.push(`${scene.id} · ${String(layer.data.item)} · ${Math.round(f * 100)}%`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (!files.length) {
  console.error('no shot matched');
  process.exit(1);
}
// 640×360 tiles, one row per shot, with a label.
const cols = fractions.length;
// Inter from @fontsource (.woff, which FreeType reads), as in the FFmpeg draft.
const font = join(dirname(createRequire(import.meta.url).resolve('@fontsource/inter/package.json')), 'files', 'inter-latin-600-normal.woff');
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019");
const tiles = files.map((_, i) => `[${i}:v]scale=640:360,drawtext=fontfile='${font}':text='${esc(labels[i])}':expansion=none:x=12:y=12:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6[t${i}]`).join(';');
const layout = files.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * 360}`).join('|');
const stack = files.length === 1 ? '[t0]copy' : `${files.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}`;
execFileSync(ffmpeg, ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${tiles};${stack}`, '-frames:v', '1', '-update', '1', out]);
rmSync(tmp, { recursive: true, force: true });
console.log(`${files.length / cols} shot(s) → ${out}`);
