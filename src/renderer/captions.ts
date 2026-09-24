import type { CaptionCue, CaptionTrack, CaptionWord } from '../model/captions.js';
import type { Frames } from '../model/primitives.js';

export interface ActiveCaption {
  cue: CaptionCue;
  cueIndex: number;
  /** Index in `cue.words` of the word being spoken, -1 between words or without word timings. */
  wordIndex: number;
  /** Index of the last word that has started (stays valid in pauses between words), -1 before the first. */
  lastWordIndex: number;
  word?: CaptionWord;
}

/** Caption cue active at a scene frame. Binary search over sorted cues. */
export function getActiveCaption(track: CaptionTrack, sceneFrame: Frames): ActiveCaption | undefined {
  const cues = track.cues;
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.startFrame <= sceneFrame) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return undefined;
  const cue = cues[found]!;
  if (sceneFrame >= cue.endFrame) return undefined;
  let wordIndex = -1;
  let lastWordIndex = -1;
  if (cue.words) {
    for (let i = 0; i < cue.words.length; i++) {
      const w = cue.words[i]!;
      if (w.startFrame > sceneFrame) break;
      lastWordIndex = i;
      if (sceneFrame < w.endFrame) wordIndex = i;
    }
  }
  return { cue, cueIndex: found, wordIndex, lastWordIndex, ...(wordIndex >= 0 ? { word: cue.words![wordIndex]! } : {}) };
}

/**
 * Split a cue into display lines of at most `maxWordsPerLine` words and return
 * the line containing the active word (or the first line).
 */
export function getCaptionLine(active: ActiveCaption, maxWordsPerLine: number): { words: string[]; activeIndex: number } {
  const words = active.cue.words?.map((w) => w.text) ?? active.cue.text.split(/\s+/).filter(Boolean);
  const size = Math.max(1, maxWordsPerLine);
  // Keep showing the line of the last spoken word during pauses instead of jumping back to the first line.
  const anchor = active.wordIndex >= 0 ? active.wordIndex : Math.max(0, active.lastWordIndex);
  const lineIndex = Math.floor(anchor / size);
  return { words: words.slice(lineIndex * size, lineIndex * size + size), activeIndex: active.wordIndex >= 0 ? active.wordIndex % size : -1 };
}
