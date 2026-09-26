// Version of the episode with HyperFrames catalog items where they beat the engine's own
// graphics (chosen from motion-library/hyperframes/sheet-*.jpg). Same narration, music, cuts.
//   node hyperframes.mjs            # writes plan-hyperframes.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(readFileSync(join(here, 'plan.json'), 'utf8'));
plan.metadata = { ...plan.metadata, id: `${plan.metadata?.id ?? 'mcdonalds-30s'}-hyperframes` };

const edits = {
  // Chapter card: a Solari board that lands on the title (3.5 s of flaps played at 2.4×).
  'chapter-2': { block: { item: 'split-flap-board', variables: { boardText: 'REAL ESTATE EMPIRE', cellCount: 18 }, speed: 2.4 } },
  // Vox-style annotation on the key word of the sentence.
  'u6-b': { block: { item: 'vox-annotate', variables: { text: 'The restaurants sit on prime land', keyword: 'prime', note: 'location, location, location', accent: 'green' } } },
  // Revelation: the word "land" gets circled on the impact (sfx at frame 18 = 0.6 s).
  u7: { block: { item: 'marker-highlight', variables: { text: 'They own the land under more than half of them', emphasis_word: 'land', style: 'circle', draw_at: 0.6, accent: 'green' } } },
  // The sentence in two beats, "real" underlined.
  u8: { block: { item: 'line-swap', variables: { line_a: "McDonald's makes billions", line_b: 'from real estate.', swap_at: 1.1, underline_word: 'real', accent: 'green' } } },
  // Payoff: the one-word thesis thrown over the last image.
  u9: { overlays: [{ item: 'shutter-slam', variables: { text: 'LANDLORD', accent: 'green' }, startFrame: 12, background: 'transparent' }] },
};

for (const shot of plan.shots) {
  const edit = edits[shot.id];
  if (!edit) continue;
  Object.assign(shot, edit);
  if (edit.block) {
    // The block animates itself: no motion skill on top of it.
    delete shot.motionSkill;
    shot.reasons = { ...shot.reasons, motion: `HyperFrames "${edit.block.item}"` };
  }
}

writeFileSync(join(here, 'plan-hyperframes.json'), `${JSON.stringify(plan, null, 2)}\n`);
console.log('plan-hyperframes.json:', Object.keys(edits).join(', '));
