/**
 * Visual effects applied to a layer or a whole scene. Effects are data; the
 * renderer maps the CSS-representable ones to `filter` and delegates the rest
 * (grain, chromatic aberration, LUTs…) to registered effect implementations.
 */
import type { Color, JsonObject } from './primitives.js';
import type { Keyframe } from './animation.js';

export type EffectType =
  | 'blur'
  | 'brightness'
  | 'contrast'
  | 'saturate'
  | 'grayscale'
  | 'sepia'
  | 'hueRotate'
  | 'invert'
  | 'dropShadow'
  | 'vignette'
  | 'grain'
  | 'chromaticAberration'
  | 'glow'
  | 'colorGrade'
  | 'lut'
  | 'pixelate'
  | 'custom';

export interface EffectBase {
  id?: string;
  type: EffectType;
  enabled?: boolean;
  /** Keyframed overrides for numeric params, keyed by param name (e.g. `amount`). */
  animatedParams?: Record<string, Keyframe[]>;
}

export interface AmountEffect extends EffectBase {
  type: 'blur' | 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'hueRotate' | 'invert' | 'pixelate';
  /** blur: px; hueRotate: deg; others: multiplier where 1 = unchanged (grayscale/sepia/invert: 0..1). */
  amount: number;
}

export interface DropShadowEffect extends EffectBase {
  type: 'dropShadow';
  x: number;
  y: number;
  blur: number;
  color: Color;
}

export interface VignetteEffect extends EffectBase {
  type: 'vignette';
  /** 0..1 */
  intensity: number;
  /** 0..1, size of the clear center. */
  radius?: number;
  color?: Color;
}

export interface GrainEffect extends EffectBase {
  type: 'grain';
  intensity: number;
  size?: number;
  seed?: number;
}

export interface ChromaticAberrationEffect extends EffectBase {
  type: 'chromaticAberration';
  /** Pixels of channel offset. */
  offset: number;
}

export interface GlowEffect extends EffectBase {
  type: 'glow';
  radius: number;
  color: Color;
  intensity?: number;
}

export interface ColorGradeEffect extends EffectBase {
  type: 'colorGrade';
  temperature?: number;
  tint?: number;
  exposure?: number;
  contrast?: number;
  saturation?: number;
  shadows?: Color;
  highlights?: Color;
}

export interface LutEffect extends EffectBase {
  type: 'lut';
  assetId: string;
  intensity?: number;
}

export interface CustomEffect extends EffectBase {
  type: 'custom';
  name: string;
  params?: JsonObject;
}

export type Effect =
  | AmountEffect
  | DropShadowEffect
  | VignetteEffect
  | GrainEffect
  | ChromaticAberrationEffect
  | GlowEffect
  | ColorGradeEffect
  | LutEffect
  | CustomEffect;
