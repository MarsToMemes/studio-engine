/**
 * Demo: an AI-style blueprint compiled into a project, then edited by hand
 * (adding a Lottie layer), exactly like the editor would do.
 */
import { compileBlueprint, createLayer, sequentialIds, type AssetRegistry, type BlueprintDocument, type VideoProject } from '@studio-engine/scene-engine';

export const demoAssets: AssetRegistry = {
  narration: { id: 'narration', kind: 'audio', src: 'narration.wav', durationInSeconds: 40 },
  music: { id: 'music', kind: 'audio', src: 'music.wav', durationInSeconds: 30 },
  clip: { id: 'clip', kind: 'video', src: 'clip.mp4', durationInSeconds: 6, width: 640, height: 360, fps: 30 },
  landscape: { id: 'landscape', kind: 'image', src: 'landscape.png', width: 1280, height: 720 },
  pulse: { id: 'pulse', kind: 'lottie', src: 'pulse.json', fps: 30 },
};

export const demoBlueprint: BlueprintDocument = {
  version: 1,
  title: 'Scene Engine Demo',
  aspectRatio: '16:9',
  narration: { assetId: 'narration' },
  music: { assetId: 'music', volume: 0.5, duckTo: 0.3 },
  style: { captions: 'caption-bold-pop', transition: 'smooth-crossfade', brollTreatment: 'broll-cinematic', imageTreatment: 'image-ken-burns' },
  scenes: [
    { type: 'title', role: 'hook', startSeconds: 0, endSeconds: 3, script: "McDonald's doesn't make most of its money from burgers.", headline: 'Not a burger company', media: [{ assetId: 'landscape', role: 'background' }], camera: 'cinematic-zoom' },
    { type: 'broll', startSeconds: 3, endSeconds: 6, script: 'It makes it from the land under its restaurants.', headline: 'The real business', media: [{ assetId: 'clip' }], transitionIn: 'whip-fast' },
    { type: 'statistic', startSeconds: 6, endSeconds: 9, script: 'Most of its revenue comes from franchisees.', statistic: { value: 61, suffix: '%', label: 'of revenue from franchisees' }, transitionIn: 'flash-cut', camera: { presetId: 'impact-shake', durationInFrames: 12 } },
    { type: 'chart', startSeconds: 9, endSeconds: 12, script: 'Franchised revenue dwarfs company-operated sales.', chart: { kind: 'barChart', data: { labels: ['Company', 'Franchised'], values: [8.3, 15.4] }, title: 'Revenue 2023 (B$)' }, transitionIn: 'push-slide' },
    { type: 'quote', startSeconds: 12, endSeconds: 15, script: 'We are in the real estate business.', quote: { text: 'We are in the real estate business.', author: 'Harry J. Sonneborn' }, transitionIn: 'dip-to-black' },
    { type: 'endcard', startSeconds: 15, endSeconds: 18, headline: 'Who is your landlord?', subtext: 'Subscribe for more', transitionIn: 'glitch-hit', captions: false },
  ],
};

export function buildDemoProject(): VideoProject {
  const result = compileBlueprint(demoBlueprint, { assets: demoAssets, ids: sequentialIds('demo') });
  if (!result.ok) throw new Error(`Invalid demo blueprint:\n${result.errors.map((e) => `${e.path}: ${e.message}`).join('\n')}`);
  const project = result.project;
  // Manual edit on top of the AI output: a Lottie accent on the end card, fade-in edge transition.
  const endcard = project.scenes[project.scenes.length - 1]!;
  endcard.layers.push(
    createLayer('lottie', {
      source: { kind: 'asset', assetId: 'pulse' },
      loop: true,
      fit: 'contain',
      zIndex: 45,
      position: { anchor: 'top-center', x: 0, y: 8, width: 14, height: 20, units: 'percent' },
      animations: [{ type: 'fade', phase: 'in', durationInFrames: 10 }],
    }),
  );
  // A feathered circular mask on an image behind the quote.
  const quote = project.scenes.find((s) => s.type === 'quote')!;
  quote.layers.push(
    createLayer('image', {
      assetId: 'landscape',
      fit: 'cover',
      zIndex: 5,
      opacity: 0.55,
      position: { anchor: 'center', x: 0, y: -2, width: 36, height: 64, units: 'percent' },
      mask: { type: 'shape', shape: 'circle', feather: 24 },
      animations: [{ type: 'camera', move: 'kenBurns', intensity: 0.8 }],
    }),
  );
  project.scenes[0]!.transitionIn = { type: 'crossfade', durationInFrames: 12 };
  endcard.transitionOut = { type: 'fade', durationInFrames: 18 };
  return project;
}
