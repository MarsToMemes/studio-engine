/** Text helpers shared by every text renderer. */
import type { TextSplit } from '../model/animation.js';

/** Split text into animation units. Whitespace is kept attached to the previous unit for words. */
export function splitText(text: string, split: TextSplit): string[] {
  if (split === 'characters') return Array.from(text);
  if (split === 'lines') return text.split('\n');
  return text.split(/(?<=\s)(?=\S)/);
}

/** Visible part of a text for a typewriter progress in [0, 1]. Unicode safe. */
export function visibleText(text: string, progress: number): string {
  const chars = Array.from(text);
  const n = Math.round(Math.max(0, Math.min(1, progress)) * chars.length);
  return chars.slice(0, n).join('');
}
