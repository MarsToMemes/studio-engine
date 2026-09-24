/**
 * Script ↔ transcript alignment. The script says WHAT is said, the transcript
 * says WHEN. A longest-common-subsequence alignment tolerates the usual
 * differences (numbers written "61 %" and spoken "sixty one percent", small
 * rewordings); words that do not match get interpolated times.
 */
import type { TranscriptWord } from '@studio-engine/scene-engine';
import { normalizeWord } from './text.js';

export interface SentenceTiming {
  startMs: number;
  endMs: number;
  wordStartsMs: number[];
  estimated: boolean;
}

/** Speaking rate used when there is no transcript (≈ 156 words per minute). */
export const ESTIMATED_MS_PER_WORD = 385;
const ESTIMATED_PAUSE_MS = 300;

export function estimateTimings(sentences: readonly string[][]): SentenceTiming[] {
  let t = 0;
  return sentences.map((words) => {
    const starts = words.map((_, i) => t + i * ESTIMATED_MS_PER_WORD);
    const timing = { startMs: t, endMs: t + words.length * ESTIMATED_MS_PER_WORD, wordStartsMs: starts, estimated: true };
    t = timing.endMs + ESTIMATED_PAUSE_MS;
    return timing;
  });
}

export function alignSentences(sentences: readonly string[][], transcript: readonly TranscriptWord[]): SentenceTiming[] {
  if (!transcript.length) return estimateTimings(sentences);
  const script = sentences.flatMap((words, s) => words.map((w) => ({ s, key: normalizeWord(w) })));
  const spoken = transcript.map((w) => normalizeWord(w.text));
  const n = script.length;
  const m = spoken.length;
  // LCS table, one row per script word.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = script[i]!.key && script[i]!.key === spoken[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const match = new Array<number | undefined>(n).fill(undefined);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (script[i]!.key && script[i]!.key === spoken[j]) {
      match[i] = j;
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
    else j++;
  }
  // Times of every script word: matched → transcript, unmatched → interpolated.
  const starts = new Array<number>(n);
  const ends = new Array<number>(n);
  let prev = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && match[i] === undefined) continue;
    const fromMs = prev >= 0 ? transcript[match[prev]!]!.endMs : transcript[0]!.startMs;
    const toMs = i < n ? transcript[match[i]!]!.startMs : transcript[m - 1]!.endMs;
    const gap = i - prev - 1;
    for (let k = 1; k <= gap; k++) {
      const a = fromMs + ((toMs - fromMs) * (k - 1)) / gap;
      starts[prev + k] = Math.round(a);
      ends[prev + k] = Math.round(fromMs + ((toMs - fromMs) * k) / gap);
    }
    if (i < n) {
      starts[i] = transcript[match[i]!]!.startMs;
      ends[i] = transcript[match[i]!]!.endMs;
    }
    prev = i;
  }
  const out: SentenceTiming[] = [];
  let k = 0;
  for (const words of sentences) {
    const ws = starts.slice(k, k + words.length);
    const we = ends.slice(k, k + words.length);
    const matched = match.slice(k, k + words.length).filter((x) => x !== undefined).length;
    out.push({ startMs: ws[0] ?? 0, endMs: we[we.length - 1] ?? 0, wordStartsMs: ws, estimated: matched === 0 });
    k += words.length;
  }
  return out;
}
