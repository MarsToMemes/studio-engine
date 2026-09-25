/**
 * Example input: the McDonald’s episode as the brain receives it: a script with chapters, a
 * transcribed voice-over (spoken, so numbers are words), catalogued assets
 * with their rights, a music bed and a small sound library.
 */
import type { AssetRegistry, AssetSource, TranscriptWord } from '@studio-engine/scene-engine';
import type { BrainInput, ScriptBlock } from '../types.js';

const own: AssetSource = { provider: 'own production', license: 'own', commercialUse: true, attributionRequired: false };

export const assets: AssetRegistry = {
  narration: { id: 'narration', kind: 'audio', src: 'narration.wav', durationInSeconds: 40, source: own },
  music: { id: 'music', kind: 'audio', src: 'music.wav', durationInSeconds: 60, source: { provider: 'Example Music', license: 'royalty-free', commercialUse: true, attributionRequired: false } },
  restaurant: { id: 'restaurant', kind: 'image', src: 'landscape.png', width: 1920, height: 1080, source: own },
  kitchen: { id: 'kitchen', kind: 'video', src: 'clip.webm', durationInSeconds: 6, width: 1920, height: 1080, source: own },
  report: { id: 'report', kind: 'image', src: 'report.png', width: 1000, height: 1400, source: { provider: "McDonald's investor relations", license: 'press use', commercialUse: true, attributionRequired: true, attribution: "McDonald's Annual Report 2023" } },
  'sfx-impact': { id: 'sfx-impact', kind: 'audio', src: 'sfx/impact.wav', durationInSeconds: 0.8, source: own },
  'sfx-glitch': { id: 'sfx-glitch', kind: 'audio', src: 'sfx/glitch.wav', durationInSeconds: 0.5, source: own },
};

export const catalog: BrainInput['catalog'] = [
  { assetId: 'restaurant', description: 'McDonald’s restaurant at sunset', tags: ['restaurant', 'counter', 'burger', 'store'] },
  { assetId: 'kitchen', description: 'kitchen of a fast-food restaurant', tags: ['kitchen', 'burger', 'fries', 'franchise'] },
  {
    assetId: 'report',
    description: "McDonald's Annual Report 2023",
    tags: ['document', 'annual report', 'revenue', 'franchisees'],
    regions: [{ text: 'revenues from franchised restaurants rent and royalties', x: 9, y: 26, width: 72, height: 4 }],
  },
];

export const script: ScriptBlock[] = [
  { kind: 'chapter', title: 'The real business', question: "How does McDonald's really make money?" },
  { kind: 'text', text: "McDonald's isn't a burger company." },
  { kind: 'text', text: 'Behind every counter there is something else.', hints: { media: 'restaurant' } },
  { kind: 'text', text: 'Over 61% of its revenue comes from franchisees.' },
  { kind: 'text', text: 'The annual report says it plainly: franchised restaurants pay rent and royalties.' },
  { kind: 'text', text: 'Rent keeps growing year after year.', hints: { chart: { kind: 'barChart', labels: ['2019', '2021', '2023'], values: [7.6, 8.9, 9.9], unit: 'B$', title: 'Rent income', source: "McDonald's annual reports" } } },
  { kind: 'chapter', title: 'The real estate empire', question: 'How big is it?' },
  { kind: 'text', text: 'From Chicago to Tokyo, from London to Sydney, the restaurants sit on prime land.' },
  { kind: 'text', text: 'They own the land.', hints: { intent: 'revelation' } },
  { kind: 'text', text: "We discovered that McDonald's makes BILLIONS from real estate." },
  { kind: 'text', text: 'Every restaurant you walk past is a landlord.' },
];

/** What a transcription of the voice-over returns: spoken words ("sixty one percent"), timed, with pauses. */
export function transcript(): TranscriptWord[] {
  const spoken = [
    "McDonald's isn't a burger company.",
    'Behind every counter there is something else.',
    'Over sixty one percent of its revenue comes from franchisees.',
    'The annual report says it plainly: franchised restaurants pay rent and royalties.',
    'Rent keeps growing year after year.',
    'From Chicago to Tokyo, from London to Sydney, the restaurants sit on prime land.',
    'They own the land.',
    "We discovered that McDonald's makes BILLIONS from real estate.",
    'Every restaurant you walk past is a landlord.',
  ];
  const words: TranscriptWord[] = [];
  let t = 200;
  spoken.forEach((sentence, i) => {
    for (const w of sentence.split(/\s+/)) {
      const len = 180 + w.length * 28;
      words.push({ text: w, startMs: t, endMs: t + len });
      t += len + 40;
    }
    // Natural breathing pauses; a longer one where the chapter changes.
    t += i === 4 ? 900 : 380;
  });
  return words;
}

export function mcdonaldsExample(overrides: Partial<BrainInput> = {}): BrainInput {
  return {
    title: 'McDonald’s real estate',
    script,
    assets,
    catalog,
    narration: { assetId: 'narration', words: transcript() },
    music: { assetId: 'music' },
    sfx: { impact: ['sfx-impact'], glitch: ['sfx-glitch'] },
    ...overrides,
  };
}
