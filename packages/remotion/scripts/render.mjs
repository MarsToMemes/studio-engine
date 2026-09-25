// Bundles the example and renders it to out/demo.mp4 with @remotion/renderer.
//   node scripts/render.mjs [--composition=EngineDemo|ShotPlanDemo] [--frames=0-89] [--scale=0.5] [--browser=/path/to/chrome-headless-shell]
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { ensureMapLibreWorker } from './maplibre-worker.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const browserExecutable = arg('browser') ?? process.env.REMOTION_BROWSER ?? null;
const scale = Number(arg('scale') ?? 1);
const frames = arg('frames')?.split('-').map(Number);
const stills = arg('stills')?.split(',').map(Number) ?? [];
const compositionId = arg('composition') ?? 'EngineDemo';
mkdirSync(join(root, 'out'), { recursive: true });
ensureMapLibreWorker();

const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts'), publicDir: join(root, 'public') });
const composition = await selectComposition({ serveUrl, id: compositionId, browserExecutable });
console.log(`Composition ${composition.id}: ${composition.width}x${composition.height} @${composition.fps}fps, ${composition.durationInFrames} frames`);

for (const frame of stills) {
  await renderStill({ composition, serveUrl, frame, scale, browserExecutable, output: join(root, 'out', `${compositionId}-${frame}.png`) });
  console.log(`still ${frame} written`);
}

const started = Date.now();
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  scale,
  browserExecutable,
  outputLocation: join(root, 'out', `${compositionId}.mp4`),
  ...(frames ? { frameRange: [frames[0], frames[1]] } : {}),
  onProgress: ({ progress }) => process.stdout.write(`\rrendering ${(progress * 100).toFixed(0)}%   `),
});
console.log(`\nrendered out/${compositionId}.mp4 in ${((Date.now() - started) / 1000).toFixed(1)}s`);
