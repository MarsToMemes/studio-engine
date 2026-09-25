// Renders one preview image per motion skill and writes the Motion Library catalogue.
//   node scripts/previews.mjs [--browser=/path/to/chrome] [--only=id1,id2]
// Output (repository root): motion-library/previews/<skill>.jpg and motion-library/catalog.json
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMapLibreWorker } from './maplibre-worker.mjs';
import { defaultMotionSkillRegistry, EDITORIAL_TRANSITIONS, getShotStartFrames, skillGalleryPlan, PREVIEW_SECONDS } from '@studio-engine/scene-engine';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const library = join(root, '..', '..', 'motion-library');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const browserExecutable = arg('browser') ?? process.env.REMOTION_BROWSER ?? null;
const only = arg('only')?.split(',');
mkdirSync(join(library, 'previews'), { recursive: true });
ensureMapLibreWorker();

const plan = skillGalleryPlan(defaultMotionSkillRegistry);
const starts = getShotStartFrames(plan);
const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts'), publicDir: join(root, 'public') });
const composition = await selectComposition({ serveUrl, id: 'MotionLibrary', browserExecutable });

// The moment that shows the skill best: once its main animation has played.
const POSTER = { city_zoom: 0.3, redaction_reveal: 0.55, light_reveal: 0.1, impact_reveal: 0.05, flight_route: 0.4, timeline_event: 0.8 };
for (const [i, shot] of plan.shots.entries()) {
  if (only && !only.includes(shot.id)) continue;
  const frame = starts[i] + Math.round(shot.durationInFrames * (POSTER[shot.id] ?? 0.72));
  await renderStill({ composition, serveUrl, frame, scale: 0.25, imageFormat: 'jpeg', jpegQuality: 80, browserExecutable, chromiumOptions: { gl: 'angle' }, output: join(library, 'previews', `${shot.id}.jpg`) });
  process.stdout.write(`\r${i + 1}/${plan.shots.length} ${shot.id}                    `);
}

const skills = defaultMotionSkillRegistry.getAvailableMotionSkills().map((s) => ({ ...s, preview: `previews/${s.id}.jpg` }));
const catalog = {
  generatedBy: 'packages/remotion/scripts/previews.mjs',
  previewSeconds: PREVIEW_SECONDS,
  categories: [...new Set(skills.map((s) => s.category))],
  skills,
  transitions: EDITORIAL_TRANSITIONS,
};
writeFileSync(join(library, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`\nwrote ${skills.length} skills to motion-library/catalog.json`);
