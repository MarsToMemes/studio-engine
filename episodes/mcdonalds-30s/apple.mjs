// Apple-keynote edit of the episode: every shot is a Studio block (HyperFrames composition from
// packages/remotion/hyperframes-studio), timed to the words of the narration. Same voice, music,
// sound effects and cut points; hard cuts; no burned-in captions (the type carries the words).
//   node apple.mjs            # writes plan-apple.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(readFileSync(join(here, 'plan.json'), 'utf8'));
const fps = plan.fps;
const words = plan.narration.words;
const segments = plan.narration.segments;
plan.metadata = { ...plan.metadata, id: 'mcdonalds-30s-apple' };
plan.captions = { ...plan.captions, enabled: false };

// Hard cuts everywhere: the shots that were overlapped by a transition lose the overlap, so
// every shot keeps its start frame (and its sync with the narration segments).
const shot = (id) => plan.shots.find((s) => s.id === id);
for (const s of plan.shots) {
  if (s.transition && s.transition !== 'hard_cut') {
    const i = plan.shots.indexOf(s);
    plan.shots[i - 1].durationInFrames -= s.transitionDurationInFrames ?? (s.transition === 'fade' ? 12 : 15);
    s.transition = 'hard_cut';
    delete s.transitionDurationInFrames;
  }
}
const starts = {};
plan.shots.reduce((f, s) => ((starts[s.id] = f), f + s.durationInFrames), 0);

/** Timeline time (s) of word i: its narration segment's start + offset in the voice file. */
function wordTime(i) {
  const ms = words[i].startMs;
  const seg = segments.filter((g) => g.sourceStartMs <= ms).sort((a, b) => b.sourceStartMs - a.sourceStartMs)[0];
  return seg.startFrame / fps + (ms - seg.sourceStartMs) / 1000;
}
/** Word cue relative to a shot (or to the first shot of a continuous block). */
const cue = (origin, i) => Math.max(0.05, Math.round((wordTime(i) - starts[origin] / fps) * 1000) / 1000);
const cues = (origin, ...idx) => idx.map((i) => cue(origin, i)).join(',');
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const secs = (id) => shot(id).durationInFrames / fps;

const SOURCE_10K = "Source: McDonald's Form 10-K 2023";
const blocks = {
  u1: { item: 'studio-title', variables: { text: "McDonald's isn't a|*burger* company.", sizes: '150,150', cues: cues('u1', ...range(0, 4)), strike: 3, strikeAt: cue('u1', 4) + 0.12 } },
  u2: {
    item: 'studio-image',
    variables: {
      src: 'mcd/counter.png', window: 56, revealAt: 0.15, zoom: 0.12,
      dims: `0.9:0.45:0;${cue('u2', 8) - 0.25}:0.86:10`,
      text: 'Behind every counter,|there is *something else.*', sizes: '76,128', soft: '0', cues: cues('u2', ...range(5, 11)),
    },
  },
  u3: {
    item: 'studio-stat',
    variables: { kicker: 'Over', kickerAt: cue('u3', 12), to: 60, suffix: '%', countAt: cue('u3', 13), countDuration: 1.1, ring: 60, label: 'of its revenue comes|from *franchisees.*', labelCues: cues('u3', ...range(15, 20)), source: SOURCE_10K },
  },
  u4: {
    item: 'studio-document',
    variables: {
      header: "McDONALD'S CORPORATION · FORM 10-K · 2023", heading: 'Revenues',
      sentence: 'Revenues from franchised restaurants include *rent* and *royalties* based on a percent of sales, with minimum rent payments.',
      highlightCues: cues('u4', 29, 31), rows: 'Rents: 9,840.0|Royalties: 5,530.9', rowsAt: `${cue('u4', 29) + 0.35},${cue('u4', 31) + 0.35}`,
      pushAt: 0.8, source: SOURCE_10K,
    },
  },
  // One bar chart across u5-a and u5-b (the second picks it up where the first cut).
  'u5-a': 'bars',
  'u5-b': 'bars',
  // One map across the chapter card and u6-a: the land and the title in the pause, pins on the cities.
  'chapter-2': 'map',
  'u6-a': 'map',
  'u6-b': { item: 'studio-title', variables: { text: 'The restaurants sit on|*prime land.*', sizes: '84,200', soft: '0', cues: cues('u6-b', ...range(52, 57)) } },
  u7: {
    item: 'studio-units',
    variables: { text: 'They own the land|under *more than half*|of them.', sizes: '88', cues: cues('u7', ...range(58, 67)), total: 100, lit: 57, litAt: cue('u7', 63), litDuration: 0.8, counter: '%', counterLabel: 'of the land under its restaurants', source: SOURCE_10K },
  },
  u8: { item: 'studio-title', variables: { text: "McDonald's makes *billions*|from *real estate.*", sizes: '118,160', cues: cues('u8', ...range(68, 73)) } },
  u9: {
    item: 'studio-image',
    variables: {
      src: 'mcd/counter.png', window: 56, revealAt: 0.1, zoom: -0.08,
      dims: `0.8:0.5:0;${cue('u9', 74) - 0.2}:0.86:10`,
      text: "Behind the burgers,|it's a *landlord.*", sizes: '76,190', soft: '0', cues: cues('u9', ...range(74, 79)), fadeOutAt: secs('u9') - 0.55,
    },
  },
};
const bars = {
  item: 'studio-bars',
  variables: {
    kicker: 'Rent paid by franchisees', text: 'Rent keeps *growing.*', sizes: '96', cues: cues('u5-a', 33, 34, 35),
    labels: '2019,2023', values: '7.5,9.8', prefix: '$', suffix: 'B', decimals: 1,
    barCues: `${cue('u5-a', 35) + 0.25},${cue('u5-a', 36)}`, delta: '+31%', deltaAt: cue('u5-a', 42),
    source: "Source: McDonald's Form 10-K 2019, 2023",
  },
};
const map = {
  item: 'studio-map',
  variables: {
    kicker: 'Chapter 2', text: 'The real estate *empire.*', sizes: '76', titleAt: 0.15,
    markers: [[45, 'Chicago', -87.63, 41.88], [47, 'Tokyo', 139.69, 35.69], [49, 'London', -0.13, 51.51], [51, 'Sydney', 151.21, -33.87]]
      .map(([i, label, lon, lat]) => `${label}:${lon}:${lat}:${cue('chapter-2', i)}`).join(';'),
    dotsAt: 0, zoom: 0.07,
  },
};

for (const s of plan.shots) {
  let b = blocks[s.id];
  if (b === 'bars') b = { ...bars, startAt: s.id === 'u5-a' ? 0 : starts['u5-b'] / fps - starts['u5-a'] / fps };
  if (b === 'map') b = { ...map, startAt: s.id === 'chapter-2' ? 0 : starts['u6-a'] / fps - starts['chapter-2'] / fps };
  if (!b) throw new Error(`no block for ${s.id}`);
  s.block = b;
  delete s.motionSkill;
  delete s.camera;
  s.reasons = { ...s.reasons, motion: `Studio block "${b.item}" (Apple-keynote style), timed to the voice.` };
}

writeFileSync(join(here, 'plan-apple.json'), `${JSON.stringify(plan, null, 2)}\n`);
console.log('plan-apple.json:', plan.shots.map((s) => `${s.id}=${s.block.item}`).join(' '));
