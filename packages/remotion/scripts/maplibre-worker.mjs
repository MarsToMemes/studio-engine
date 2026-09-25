// Copies MapLibre's worker (and the chunk it imports) into public/maplibre/:
// bundled, MapLibre cannot find its worker next to itself, so the MapTiles
// component points it there with setWorkerUrl(staticFile(...)).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function ensureMapLibreWorker() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dist = dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json'));
  const out = join(root, 'public', 'maplibre');
  mkdirSync(out, { recursive: true });
  for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
    const target = join(out, f);
    if (!existsSync(target)) copyFileSync(join(dist, 'dist', f), target);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) ensureMapLibreWorker();
