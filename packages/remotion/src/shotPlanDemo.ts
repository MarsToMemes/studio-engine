/**
 * A ShotPlan as the AI director would write it, compiled by the engine.
 * Map shots are left out until the map motion skills exist (Phase 3).
 */
import { compileShotPlan, type ShotPlan, type TranscriptWord, type VideoProject } from '@studio-engine/scene-engine';

const SCRIPT =
  "McDonald's isn't a burger company. Behind every counter there is something else. " +
  'Sixty one percent of its revenue comes from franchisees. The annual report says it plainly. ' +
  'Rent keeps growing year after year. The real estate empire. They own the land. ' +
  "We discovered that McDonald's makes BILLIONS from real estate.";

function transcript(text: string, seconds: number): TranscriptWord[] {
  const words = text.split(/\s+/);
  const step = (seconds * 1000) / words.length;
  return words.map((w, i) => ({ text: w, startMs: Math.round(i * step), endMs: Math.round((i + 0.9) * step) }));
}

export const shotPlanDemo: ShotPlan = {
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  assets: {
    narration: { id: 'narration', kind: 'audio', src: 'narration.wav', durationInSeconds: 40 },
    music: { id: 'music', kind: 'audio', src: 'music.wav', durationInSeconds: 30 },
    landscape: { id: 'landscape', kind: 'image', src: 'landscape.png', width: 1280, height: 720 },
    clip: { id: 'clip', kind: 'video', src: 'clip.mp4', durationInSeconds: 6, width: 640, height: 360, fps: 30 },
    report: { id: 'report', kind: 'image', src: 'report.png', width: 1000, height: 1400 },
    'sfx-impact': { id: 'sfx-impact', kind: 'audio', src: 'sfx/impact.wav', durationInSeconds: 0.8 },
    'sfx-glitch': { id: 'sfx-glitch', kind: 'audio', src: 'sfx/glitch.wav', durationInSeconds: 0.5 },
  },
  narration: { assetId: 'narration', words: transcript(SCRIPT, 26) },
  music: { assetId: 'music', gainDb: -18, duckDb: -6 },
  captions: { enabled: true, style: 'caption-bold-pop', wordsPerCue: 3 },
  metadata: { id: 'shot-plan-demo' },
  shots: [
    { id: 'hook', type: 'text', durationInFrames: 66, text: "McDonald's isn't a burger company", highlightedWords: ['burger'], intensity: 'strong', sfx: [{ sfx: 'sfx-impact' }], metadata: { role: 'hook' } },
    { id: 'counter', type: 'image', durationInFrames: 105, media: 'landscape', text: 'Behind every counter', intensity: 'subtle' },
    { id: 'kitchen', type: 'video', durationInFrames: 90, media: 'clip', transition: 'dissolve' },
    { id: 'stat', type: 'number', durationInFrames: 90, number: { value: 61, suffix: '%', label: 'of revenue from franchisees' }, intensity: 'medium', transition: 'flash', sfx: [{ sfx: 'sfx-impact', at: 10 }] },
    { id: 'report', type: 'document', durationInFrames: 120, media: 'report', document: { source: 'Annual report 2023', highlights: [{ x: 9, y: 26, width: 72, height: 4, at: 30 }, { x: 9, y: 32, width: 55, height: 4, at: 60 }] } },
    { id: 'rent', type: 'chart', durationInFrames: 105, chart: { kind: 'barChart', labels: ['2019', '2021', '2023'], values: [7.6, 8.9, 9.9], unit: 'B$', title: 'Rent income (B$)' } },
    { id: 'chapter-2', type: 'chapter', durationInFrames: 60, text: 'The real estate empire', subtext: 'CHAPTER 2', transition: 'fade', intensity: 'medium' },
    { id: 'reveal', type: 'revelation', durationInFrames: 75, text: 'They own the land', highlightedWords: ['land'], transition: 'glitch', intensity: 'strong', sfx: [{ sfx: 'sfx-glitch' }, { sfx: 'sfx-impact', at: 6, gainDb: -3 }] },
    { id: 'billions', type: 'text', durationInFrames: 90, text: "McDonald's makes BILLIONS from real estate", highlightedWords: ['BILLIONS'], intensity: 'medium' },
  ],
};

export function buildShotPlanDemoProject(): VideoProject {
  const result = compileShotPlan(shotPlanDemo, { projectId: 'shot-plan-demo', name: 'ShotPlanDemo' });
  if (!result.ok) throw new Error(`Invalid demo shot plan:\n${result.errors.map((e) => `${e.path}: ${e.message}`).join('\n')}`);
  return result.project;
}
