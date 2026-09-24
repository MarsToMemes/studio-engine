/**
 * RHYTHM EDITOR. Durations come from the voice: every sentence keeps its
 * natural pause (capped by the pacing), long sentences are split into several
 * shots at word boundaries (never inside a word, RHY-08), and the key visual
 * of a sentence starts when its key word is spoken (a figure, a place).
 */
import type { EditorialIntent } from '@studio-engine/scene-engine';
import type { EditorialUnit, Pacing } from './types.js';

/** Longest natural pause kept after a sentence, per pacing (ms). */
export const PAUSE_CAP_MS: Record<Pacing, number> = { calm: 700, standard: 450, dynamic: 200 };
const MIN_PAUSE_MS = 120;
const LAST_PAUSE_MS = 400;

/** Max shot length before a cut (s). Longer = intentional hold with a reason (bible RHY-04). */
const MAX_SECONDS: Partial<Record<EditorialIntent, { max: number; hold: string }>> = {
  proof: { max: 6.5, hold: 'let the viewer read the highlighted line' },
  statistic: { max: 5.5, hold: 'let the chart build with the voice' },
  comparison: { max: 5.5, hold: 'let the comparison build with the voice' },
  location: { max: 5, hold: 'let the map travel to the place' },
  quote: { max: 6, hold: 'let the viewer read the quote' },
  conclusion: { max: 7, hold: 'controlled slowdown of the conclusion' },
};
const BODY_MAX = 4;
const HOOK = { min: 1.5, max: 2.5 };
const MIN_CHUNK = 1.1;
/** A key word spoken later than this gets its own shot starting on it (s). */
const KEY_WORD_DELAY = 0.8;

export interface Chunk {
  /** Word range of the sentence, end exclusive. */
  from: number;
  to: number;
  /** Frames relative to the start of the sentence's block. */
  startFrame: number;
  endFrame: number;
  role: 'key' | 'support';
  hold?: string;
}

export interface UnitTiming {
  unitId: string;
  /** Range of the narration file played for this sentence (ms). */
  sourceStartMs: number;
  sourceEndMs: number;
  /** Length of the sentence's block on the timeline, pause included. */
  frames: number;
  /** Frame (relative) where the last word ends. */
  speechEndFrame: number;
  /** Frame (relative) where each word starts. */
  wordFrames: number[];
  chunks: Chunk[];
}

export function planRhythm(units: EditorialUnit[], fps: number, pacing: Pacing): UnitTiming[] {
  const f = (ms: number) => Math.round((ms / 1000) * fps);
  return units.map((u, i) => {
    const next = units[i + 1];
    const naturalPause = next ? next.startMs - u.endMs : LAST_PAUSE_MS;
    const pause = Math.max(MIN_PAUSE_MS, Math.min(PAUSE_CAP_MS[pacing], naturalPause));
    const sourceEndMs = u.endMs + pause;
    // Same rounding as the engine (each bound rounded on its own), so voice ranges never overlap.
    const frames = Math.max(1, f(sourceEndMs) - f(u.startMs));
    const wordFrames = u.wordStartsMs.map((ms) => Math.max(0, f(ms) - f(u.startMs)));
    const speechEndFrame = f(u.endMs) - f(u.startMs);
    return { unitId: u.id, sourceStartMs: u.startMs, sourceEndMs, frames, speechEndFrame, wordFrames, chunks: chunkUnit(u, frames, wordFrames, fps) };
  });
}

/** Key word of a sentence: where its main visual should start. */
function keyWordIndex(u: EditorialUnit): number | undefined {
  if (u.intent === 'number' || u.intent === 'statistic' || u.intent === 'comparison') return u.entities.numbers[0]?.wordIndex;
  if (u.intent === 'location') return u.entities.places[0]?.wordIndex;
  return undefined;
}

function chunkUnit(u: EditorialUnit, frames: number, wordFrames: number[], fps: number): Chunk[] {
  const isHook = u.index === 0;
  const limits = MAX_SECONDS[u.intent];
  const maxFrames = Math.round((limits?.max ?? BODY_MAX) * fps);
  const minFrames = Math.round(MIN_CHUNK * fps);
  const cuts = new Set<number>(); // word indexes where a new shot starts

  // The key visual starts on its word.
  const key = keyWordIndex(u);
  if (key !== undefined && key > 0 && wordFrames[key]! >= KEY_WORD_DELAY * fps && frames - wordFrames[key]! >= minFrames) cuts.add(key);

  // The hook's first shot lasts 1.5–2.5 s (RHY-01).
  if (isHook && frames > HOOK.max * fps) {
    const target = HOOK.max * fps;
    const candidates = wordFrames.map((fr, w) => ({ fr, w })).filter(({ fr, w }) => w > 0 && fr >= HOOK.min * fps && fr <= target && frames - fr >= minFrames);
    const best = candidates[candidates.length - 1];
    if (best) cuts.add(best.w);
  }

  // Split what is still too long, preferring a pause after punctuation.
  const split = (fromWord: number, startFrame: number, endFrame: number) => {
    let start = startFrame;
    let from = fromWord;
    while (endFrame - start > maxFrames) {
      const window = wordFrames.map((fr, w) => ({ fr, w })).filter(({ fr, w }) => w > from && fr - start >= minFrames && fr - start <= maxFrames && endFrame - fr >= minFrames);
      if (!window.length) break;
      const punctuated = window.filter(({ w }) => /[,;:—–]$/.test(u.words[w - 1] ?? ''));
      const pick = (punctuated.length ? punctuated : window).reduce((best, c) => (Math.abs(c.fr - start - maxFrames * 0.8) < Math.abs(best.fr - start - maxFrames * 0.8) ? c : best));
      cuts.add(pick.w);
      start = pick.fr;
      from = pick.w;
    }
  };
  const ordered = () => [0, ...[...cuts].sort((a, b) => a - b)];
  const bounds = ordered();
  bounds.forEach((w, i) => split(w, wordFrames[w]!, i + 1 < bounds.length ? wordFrames[bounds[i + 1]!]! : frames));

  const starts = ordered();
  const chunks: Chunk[] = starts.map((w, i) => {
    const to = starts[i + 1] ?? u.words.length;
    const startFrame = i === 0 ? 0 : wordFrames[w]!;
    const endFrame = i + 1 < starts.length ? wordFrames[starts[i + 1]!]! : frames;
    return { from: w, to, startFrame, endFrame, role: 'support' };
  });
  // Which chunk carries the sentence's main visual.
  const keyChunk = key !== undefined ? chunks.findIndex((c) => key >= c.from && key < c.to) : 0;
  chunks[Math.max(0, keyChunk)]!.role = 'key';
  for (const c of chunks) {
    if (c.endFrame - c.startFrame > BODY_MAX * fps && !(isHook && c.startFrame === 0)) c.hold = limits?.hold ?? 'the sentence cannot be cut without splitting a word';
  }
  return chunks;
}
