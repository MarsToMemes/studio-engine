/**
 * `AnimationState` is the renderer-agnostic result of evaluating animations at
 * a frame. It is combined with the layer's static transform by the renderer.
 *
 * Composition rules (so the order of animations does not matter):
 * - multiplicative: opacity, scaleX, scaleY, brightness, saturation
 * - additive: x, y, rotation, skewX, skewY, blur
 * - last-writer-wins: clip, textProgress, glitch, highlight
 */
import type { Vec2 } from '../model/primitives.js';

export type ClipState =
  /** Percent insets of the layer box (CSS `inset()`). */
  | { kind: 'inset'; top: number; right: number; bottom: number; left: number }
  /** Radius in percent (CSS `circle()`), centered at `center` (0..1). */
  | { kind: 'circle'; radius: number; center: Vec2 }
  /** Points in percent of the layer box. */
  | { kind: 'polygon'; points: Vec2[] };

export interface GlitchState {
  /** Horizontal slice offset in px. */
  offsetX: number;
  /** RGB split in px. */
  rgbSplit: number;
  /** Seed for the slice pattern of this frame. */
  sliceSeed: number;
}

export interface AnimationState {
  opacity: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
  skewY: number;
  blur: number;
  brightness: number;
  saturation: number;
  /** 0..1, share of the text revealed (typewriter). */
  textProgress?: number;
  clip?: ClipState;
  glitch?: GlitchState;
  /** 0..1, intensity of the emphasis style (kinetic `highlight`). */
  highlight?: number;
  /** Transform origin requested by zoom / camera animations (0..1). */
  origin?: Vec2;
}

export const IDENTITY_STATE: Readonly<AnimationState> = Object.freeze({
  opacity: 1,
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  skewX: 0,
  skewY: 0,
  blur: 0,
  brightness: 1,
  saturation: 1,
});

export function createState(): AnimationState {
  return { ...IDENTITY_STATE };
}

/** Merge `delta` into `target` in place (hot path, avoids allocations). */
export function mergeState(target: AnimationState, delta: Partial<AnimationState>): AnimationState {
  if (delta.opacity !== undefined) target.opacity *= delta.opacity;
  if (delta.x !== undefined) target.x += delta.x;
  if (delta.y !== undefined) target.y += delta.y;
  if (delta.scaleX !== undefined) target.scaleX *= delta.scaleX;
  if (delta.scaleY !== undefined) target.scaleY *= delta.scaleY;
  if (delta.rotation !== undefined) target.rotation += delta.rotation;
  if (delta.skewX !== undefined) target.skewX += delta.skewX;
  if (delta.skewY !== undefined) target.skewY += delta.skewY;
  if (delta.blur !== undefined) target.blur += delta.blur;
  if (delta.brightness !== undefined) target.brightness *= delta.brightness;
  if (delta.saturation !== undefined) target.saturation *= delta.saturation;
  if (delta.textProgress !== undefined) target.textProgress = delta.textProgress;
  if (delta.clip !== undefined) target.clip = delta.clip;
  if (delta.glitch !== undefined) target.glitch = delta.glitch;
  if (delta.highlight !== undefined) target.highlight = delta.highlight;
  if (delta.origin !== undefined) target.origin = delta.origin;
  return target;
}
