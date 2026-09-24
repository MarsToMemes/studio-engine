/** Text splitting shared by timing (unit counts) and renderers (unit layout). */
import type { Animation, TextSplit } from '../model/animation.js';

/** Split text into animation units. For words, trailing whitespace stays attached to its word. */
export function splitText(text: string, split: TextSplit): string[] {
  if (split === 'characters') return Array.from(text);
  if (split === 'lines') return text.split('\n');
  return text.trim() === '' ? [] : text.trim().split(/(?<=\s)(?=\S)/);
}

export function countTextUnits(text: string, split: TextSplit): number {
  return splitText(text, split).length;
}

/** How a unit-level animation splits its text. `undefined` for whole-layer animations. */
export function getAnimationSplit(animation: Animation): TextSplit | undefined {
  if (animation.type === 'kineticTypography') return animation.split;
  if (animation.type === 'stagger') return animation.unit ?? 'words';
  return undefined;
}

/** Split used by the first enabled unit-level animation of a layer, if any. */
export function getLayerTextSplit(animations: readonly Animation[]): TextSplit | undefined {
  for (const a of animations) {
    if (a.enabled === false) continue;
    const split = getAnimationSplit(a);
    if (split) return split;
  }
  return undefined;
}
