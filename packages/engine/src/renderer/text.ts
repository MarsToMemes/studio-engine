/** Text helpers shared by every text renderer. Splitting lives in core/text. */

/** Visible part of a text for a typewriter progress in [0, 1]. Unicode safe. */
export function visibleText(text: string, progress: number): string {
  const chars = Array.from(text);
  const n = Math.round(Math.max(0, Math.min(1, progress)) * chars.length);
  return chars.slice(0, n).join('');
}
