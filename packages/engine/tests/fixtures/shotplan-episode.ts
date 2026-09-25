/**
 * Mini documentary episode as a ShotPlan: every shot type, SFX, highlights,
 * a transcribed narration and a music bed. Reused by later phases.
 */
import type { AssetRegistry, ShotPlan, TranscriptWord } from '../../src/index.js';

export const FPS = 30;

export const episodeAssets: AssetRegistry = {
  narration: { id: 'narration', kind: 'audio', src: 'narration.wav', durationInSeconds: 40 },
  music: { id: 'music', kind: 'audio', src: 'music.wav', durationInSeconds: 60 },
  landscape: { id: 'landscape', kind: 'image', src: 'landscape.png', width: 1920, height: 1080 },
  clip: { id: 'clip', kind: 'video', src: 'clip.mp4', durationInSeconds: 6, width: 1920, height: 1080, fps: 30 },
  report: { id: 'report', kind: 'image', src: 'report.png', width: 1000, height: 1400 },
  'sfx-impact': { id: 'sfx-impact', kind: 'audio', src: 'sfx/impact.wav', durationInSeconds: 1 },
  'sfx-glitch': { id: 'sfx-glitch', kind: 'audio', src: 'sfx/glitch.wav', durationInSeconds: 0.6 },
};

const SCRIPT =
  "McDonald's isn't a burger company. Behind every counter there is something else. " +
  'Over sixty one percent of its revenue comes from franchisees. The annual report says it plainly. ' +
  'Rent keeps growing year after year. The real estate empire. They own the land. ' +
  "We discovered that McDonald's makes BILLIONS from real estate.";

/** Synthetic word timings spread over `seconds`, like a transcription would give. */
export function transcript(text: string, seconds: number): TranscriptWord[] {
  const words = text.split(/\s+/);
  const step = (seconds * 1000) / words.length;
  return words.map((w, i) => ({ text: w, startMs: Math.round(i * step), endMs: Math.round((i + 0.9) * step) }));
}

export function buildEpisodePlan(): ShotPlan {
  return {
    version: 1,
    fps: FPS,
    width: 1920,
    height: 1080,
    assets: { ...episodeAssets },
    narration: { assetId: 'narration', words: transcript(SCRIPT, 30) },
    music: { assetId: 'music', gainDb: -18, duckDb: -6 },
    captions: { enabled: true, style: 'caption-bold-pop', wordsPerCue: 3 },
    metadata: { id: 'episode-test', title: 'McDonald’s real estate' },
    shots: [
      { id: 'hook', type: 'text', durationInFrames: 60, text: "McDonald's isn't a burger company", highlightedWords: ['burger'], intensity: 'strong', sfx: [{ sfx: 'sfx-impact' }], metadata: { role: 'hook' } },
      { id: 'counter', type: 'image', durationInFrames: 105, media: 'landscape', text: 'Behind every counter', motionSkill: 'slow_zoom', intensity: 'subtle' },
      { id: 'kitchen', type: 'video', durationInFrames: 90, media: 'clip', transition: 'dissolve' },
      { id: 'stat', type: 'number', durationInFrames: 75, number: { value: 61, suffix: '%', label: 'of revenue from franchisees' }, motionSkill: 'number_pop', intensity: 'medium', transition: 'flash', sfx: [{ sfx: 'sfx-impact', at: 10 }] },
      { id: 'report', type: 'document', durationInFrames: 120, media: 'report', motionSkill: 'document_zoom', document: { source: 'Annual report 2023', highlights: [{ x: 10, y: 30, width: 70, height: 6, at: 30 }] } },
      { id: 'rent', type: 'chart', durationInFrames: 105, chart: { kind: 'barChart', labels: ['2019', '2021', '2023'], values: [7.6, 8.9, 9.9], unit: 'B$', title: 'Rent income' }, motionSkill: 'bar_animation' },
      { id: 'world', type: 'map', durationInFrames: 90, map: { center: [-87.63, 41.88], zoom: 3, markers: [{ label: 'Chicago HQ', coordinates: [-87.63, 41.88] }] }, motionSkill: 'map_zoom' },
      { id: 'chapter-2', type: 'chapter', durationInFrames: 60, text: 'The real estate empire', subtext: 'CHAPTER 2', transition: 'fade', motionSkill: 'chapter_card', intensity: 'medium' },
      { id: 'reveal', type: 'revelation', durationInFrames: 90, text: 'They own the land', highlightedWords: ['land'], transition: 'glitch', intensity: 'strong', motionSkill: 'glitch_reveal', sfx: [{ sfx: 'sfx-glitch' }, { sfx: 'sfx-impact', at: 6, gainDb: -3 }] },
      { id: 'billions', type: 'text', durationInFrames: 75, text: "McDonald's makes BILLIONS from real estate", highlightedWords: ['BILLIONS'], motionSkill: 'keyword_pop', intensity: 'medium' },
    ],
  };
}
