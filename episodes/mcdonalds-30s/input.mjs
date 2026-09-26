// Builds the editor brain's input for the 30-second McDonald's test episode.
//   node input.mjs > input.json
import { readFileSync } from 'node:fs';

const words = JSON.parse(readFileSync(new URL('./words.json', import.meta.url), 'utf8'));
// Facts for the Apple style (never guessed by the brain): McDonald's Form 10-K 2023.
const TENK = "McDonald's Form 10-K 2023";
const own = { provider: 'own production', license: 'own', commercialUse: true, attributionRequired: false };

const input = {
  title: "McDonald's is a landlord",
  fps: 30,
  width: 1920,
  height: 1080,
  script: [
    { kind: 'chapter', title: 'The real business', question: "How does McDonald's really make money?" },
    { kind: 'text', text: "McDonald's isn't a burger company.", hints: { strike: 'burger' } },
    { kind: 'text', text: 'Behind every counter, there is something else.', hints: { media: 'counter' } },
    { kind: 'text', text: 'Over 60% of its revenue comes from franchisees.', hints: { source: TENK } },
    {
      kind: 'text',
      text: 'The annual report says it plainly: franchisees pay rent and royalties.',
      hints: {
        source: TENK,
        documentCard: {
          header: "McDONALD'S CORPORATION · FORM 10-K · 2023",
          heading: 'Revenues',
          sentence: 'Revenues from franchised restaurants include *rent* and *royalties* based on a percent of sales, with minimum rent payments.',
          rows: [['Rents', '9,840.0'], ['Royalties', '5,530.9']],
        },
      },
    },
    {
      kind: 'text',
      text: 'And rent keeps growing: $9.8 billion in 2023.',
      hints: { chart: { kind: 'barChart', labels: ['2019', '2023'], values: [7.5, 9.8], unit: 'B$', title: 'Rent paid by franchisees', source: "McDonald's Form 10-K 2019, 2023" } },
    },
    { kind: 'chapter', title: 'The real estate empire', question: 'How big is it?' },
    { kind: 'text', text: 'From Chicago to Tokyo, from London to Sydney, the restaurants sit on prime land.' },
    // About 57 % of the land under its restaurants is owned (10-K 2023): the script says "more than half".
    { kind: 'text', text: 'They own the land under more than half of them.', hints: { intent: 'revelation', share: { value: 57, label: 'of the land under its restaurants' }, source: TENK } },
    { kind: 'text', text: "McDonald's makes billions from real estate." },
    { kind: 'text', text: "Behind the burgers, it's a landlord." },
  ],
  assets: {
    narration: {
      id: 'narration', kind: 'audio', src: 'mcd/voice.wav', durationInSeconds: 28.79,
      source: { provider: 'ElevenLabs (voice "Brad – Warm, Trusted Storyteller"), generated for this episode', license: 'ElevenLabs subscription (commercial use)', commercialUse: true, attributionRequired: false },
    },
    music: { id: 'music', kind: 'audio', src: 'mcd/music.wav', durationInSeconds: 34, source: { ...own, provider: 'own production (synthesised, episodes/mcdonalds-30s/music.mjs)' } },
    counter: {
      id: 'counter', kind: 'image', src: 'mcd/counter.png', width: 2560, height: 1440,
      source: { provider: 'ElevenLabs image (Seedream 5 Lite), generated for this episode', license: 'ElevenLabs subscription (commercial use)', commercialUse: true, attributionRequired: false, syntheticMedia: true },
    },
    report: {
      id: 'report', kind: 'image', src: 'mcd/report.png', width: 1000, height: 1400,
      source: { provider: 'own production: reconstruction of the 10-K revenue table', license: 'own', commercialUse: true, attributionRequired: true, attribution: "Figures: McDonald's Corporation, Form 10-K 2023 (SEC)" },
    },
    'sfx-impact': { id: 'sfx-impact', kind: 'audio', src: 'sfx/impact.wav', durationInSeconds: 0.8, source: own },
    'sfx-glitch': { id: 'sfx-glitch', kind: 'audio', src: 'sfx/glitch.wav', durationInSeconds: 0.5, source: own },
  },
  catalog: [
    { assetId: 'counter', description: 'fast-food restaurant counter at night', tags: ['restaurant', 'counter', 'burger', 'store', 'franchise'] },
    {
      assetId: 'report',
      description: "McDonald's Form 10-K 2023, revenue table",
      tags: ['document', 'annual report', 'revenue', 'franchisees', 'rent', 'royalties'],
      regions: [{ text: 'franchisees rent royalties', x: 8, y: 36.5, width: 84, height: 9.3 }],
    },
  ],
  narration: { assetId: 'narration', words },
  music: { assetId: 'music' },
  sfx: { impact: ['sfx-impact'], glitch: ['sfx-glitch'] },
  captions: true,
  pacing: 'standard',
};
process.stdout.write(JSON.stringify(input, null, 2));
