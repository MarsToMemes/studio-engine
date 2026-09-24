/**
 * A ShotPlan as the AI director would write it, compiled by the engine with
 * the built-in Motion Skill Registry (one skill per shot).
 */
import { compileShotPlan, type ShotPlan, type TranscriptWord, type VideoProject } from '@studio-engine/scene-engine';

const SCRIPT =
  "McDonald's isn't a burger company. Behind every counter there is something else. " +
  'Sixty one percent of its revenue comes from franchisees. The annual report says it plainly. ' +
  'Rent keeps growing year after year, on every continent, from Chicago to Tokyo. ' +
  'The real estate empire. They own the land. ' +
  "We discovered that McDonald's makes BILLIONS from real estate. Most of it from franchise rent.";

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
    clip: { id: 'clip', kind: 'video', src: 'clip.webm', durationInSeconds: 6, width: 640, height: 360, fps: 30 },
    report: { id: 'report', kind: 'image', src: 'report.png', width: 1000, height: 1400 },
    'sfx-impact': { id: 'sfx-impact', kind: 'audio', src: 'sfx/impact.wav', durationInSeconds: 0.8 },
    'sfx-glitch': { id: 'sfx-glitch', kind: 'audio', src: 'sfx/glitch.wav', durationInSeconds: 0.5 },
  },
  narration: { assetId: 'narration', words: transcript(SCRIPT, 36) },
  music: { assetId: 'music', gainDb: -18, duckDb: -6 },
  captions: { enabled: true, style: 'caption-bold-pop', wordsPerCue: 3 },
  metadata: { id: 'shot-plan-demo' },
  shots: [
    { id: 'hook', type: 'text', durationInFrames: 66, text: "McDonald's isn't a burger company", highlightedWords: ['burger'], motionSkill: 'keyword_pop', intensity: 'strong', sfx: [{ sfx: 'sfx-impact' }], metadata: { role: 'hook' } },
    { id: 'counter', type: 'image', durationInFrames: 105, media: 'landscape', text: 'Behind every counter', motionSkill: 'slow_zoom', intensity: 'medium' },
    { id: 'kitchen', type: 'video', durationInFrames: 90, media: 'clip', transition: 'dissolve', motionSkill: 'slow_push' },
    { id: 'stat', type: 'number', durationInFrames: 90, number: { value: 61, suffix: '%', label: 'of revenue from franchisees' }, motionSkill: 'number_pop', intensity: 'medium', transition: 'flash', sfx: [{ sfx: 'sfx-impact', at: 10 }] },
    { id: 'report', type: 'document', durationInFrames: 150, media: 'report', motionSkill: 'document_highlight', document: { source: 'Annual report 2023', highlights: [{ x: 9, y: 26, width: 72, height: 4, at: 30 }, { x: 9, y: 32, width: 55, height: 4, at: 75 }] } },
    { id: 'rent', type: 'chart', durationInFrames: 105, chart: { kind: 'barChart', labels: ['2019', '2021', '2023'], values: [7.6, 8.9, 9.9], unit: 'B$', title: 'Rent income (B$)' }, motionSkill: 'bar_animation' },
    {
      id: 'world',
      type: 'map',
      durationInFrames: 135,
      text: 'On every continent',
      map: {
        center: [20, 12],
        zoom: 0.25,
        markers: [
          { label: 'Chicago', coordinates: [-87.63, 41.88] },
          { label: 'São Paulo', coordinates: [-46.63, -23.55] },
          { label: 'London', coordinates: [-0.13, 51.51] },
          { label: 'Paris', coordinates: [2.35, 48.86] },
          { label: 'Tokyo', coordinates: [139.69, 35.69] },
          { label: 'Sydney', coordinates: [151.21, -33.87] },
        ],
        highlightCountries: ['United States of America', 'Brazil', 'United Kingdom', 'France', 'Japan', 'Australia'],
      },
      motionSkill: 'business_expansion',
      transition: 'push',
    },
    { id: 'chapter-2', type: 'chapter', durationInFrames: 75, text: 'The real estate empire', subtext: 'CHAPTER 2', transition: 'fade', motionSkill: 'chapter_card', intensity: 'medium' },
    { id: 'reveal', type: 'revelation', durationInFrames: 75, text: 'They own the land', highlightedWords: ['land'], transition: 'glitch', intensity: 'strong', motionSkill: 'glitch_reveal', sfx: [{ sfx: 'sfx-glitch' }, { sfx: 'sfx-impact', at: 6, gainDb: -3 }] },
    { id: 'billions', type: 'text', durationInFrames: 90, text: "McDonald's makes BILLIONS from real estate", highlightedWords: ['BILLIONS'], motionSkill: 'highlight_word', intensity: 'medium' },
    { id: 'share', type: 'number', durationInFrames: 90, number: { value: 61, suffix: '%', label: 'of revenue from franchise rent' }, motionSkill: 'percentage_reveal' },
    { id: 'split', type: 'chart', durationInFrames: 105, chart: { kind: 'pieChart', labels: ['Franchised', 'Company-operated'], values: [61, 39], title: 'Where the money comes from' }, motionSkill: 'pie_reveal', transition: 'dissolve' },
  ],
};

export function buildShotPlanDemoProject(): VideoProject {
  const result = compileShotPlan(shotPlanDemo, { projectId: 'shot-plan-demo', name: 'ShotPlanDemo' });
  if (result.ok) for (const note of result.notes) console.warn(`[ShotPlanDemo] ${note}`);
  if (!result.ok) throw new Error(`Invalid demo shot plan:\n${result.errors.map((e) => `${e.path}: ${e.message}`).join('\n')}`);
  return result.project;
}
