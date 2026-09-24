/** Text helpers shared by every text renderer. Splitting lives in core/text. */

/** Visible part of a text for a typewriter progress in [0, 1]. Unicode safe. */
export function visibleText(text: string, progress: number): string {
  const chars = Array.from(text);
  const n = Math.round(Math.max(0, Math.min(1, progress)) * chars.length);
  return chars.slice(0, n).join('');
}

/** Progress (0..1, eased) of a text decoration at a layer-relative frame. */
export function decorationProgress(decoration: { startFrame: number; durationInFrames: number }, localFrame: number): number {
  const t = (localFrame - decoration.startFrame) / Math.max(1, decoration.durationInFrames);
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}
