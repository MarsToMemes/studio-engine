import type { Animation } from '../model/animation.js';
import type { GraphicLayer, Layer, TextLayer } from '../model/layer.js';
import type { ComposedShot } from '../shotplan/compile.js';
import type { Intensity } from '../shotplan/types.js';
import { normalizeWord } from '../shotplan/validate.js';
import type { SkillApplyContext } from './types.js';

/** Pick a value by intensity. */
export const byIntensity = <T>(intensity: Intensity, subtle: T, medium: T, strong: T): T => (intensity === 'subtle' ? subtle : intensity === 'strong' ? strong : medium);

export const sec = (ctx: Pick<SkillApplyContext, 'fps'>, seconds: number): number => Math.max(1, Math.round(seconds * ctx.fps));

/** Stable 31-bit hash, used to seed shakes / glitches per shot. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

export function textLayerOf(target: ComposedShot): TextLayer | undefined {
  const l = target.roles.text;
  return l?.type === 'text' ? l : undefined;
}

export function graphicOf(target: ComposedShot, role: 'number' | 'chart' | 'map'): GraphicLayer | undefined {
  const l = target.roles[role];
  return l?.type === 'graphic' ? l : undefined;
}

/** The main visual a camera-style skill should move. */
export function mainVisual(target: ComposedShot): Layer | undefined {
  const r = target.roles;
  return r.media ?? r.document ?? r.map ?? r.chart ?? r.number ?? r.text;
}

export function addAnimations(layer: Layer, ...animations: Animation[]): void {
  layer.animations = [...layer.animations, ...animations];
}

/** Frame at which the word at `wordIndex` of `text` is spoken, if the transcript contains it. */
export function spokenFrame(ctx: Pick<SkillApplyContext, 'words'>, text: string, wordIndex: number): number | undefined {
  const words = text.trim().split(/\s+/);
  const wanted = normalizeWord(words[wordIndex] ?? '');
  if (!wanted) return undefined;
  // Count earlier occurrences of the same word so repeated words map to the right utterance.
  let occurrence = 0;
  for (let i = 0; i < wordIndex; i++) if (normalizeWord(words[i]!) === wanted) occurrence++;
  for (const w of ctx.words) {
    if (normalizeWord(w.text) !== wanted) continue;
    if (occurrence === 0) return w.startFrame;
    occurrence--;
  }
  return undefined;
}

/**
 * Frames at which keywords land: the spoken time when available, otherwise
 * spread from 25 % of the shot. Never later than 0.5 s before the cut, so the
 * effect is actually seen (slightly early beats invisible).
 */
export function keywordFrames(ctx: SkillApplyContext, layer: TextLayer, indices: readonly number[]): number[] {
  const last = Math.max(0, ctx.durationInFrames - sec(ctx, 0.5));
  return indices.map((index, j) => Math.min(last, spokenFrame(ctx, layer.text, index) ?? Math.round(ctx.durationInFrames * 0.25) + j * sec(ctx, 0.25)));
}
