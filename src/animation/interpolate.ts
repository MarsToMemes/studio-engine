import type { Keyframe } from '../model/animation.js';
import type { Easing } from '../model/primitives.js';
import { getEasingFunction, type EasingFunction } from './easing.js';

export type Extrapolation = 'clamp' | 'extend' | 'identity';

export interface InterpolateOptions {
  easing?: Easing | EasingFunction;
  extrapolateLeft?: Extrapolation;
  extrapolateRight?: Extrapolation;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function toFn(easing: InterpolateOptions['easing']): EasingFunction {
  return typeof easing === 'function' ? easing : getEasingFunction(easing);
}

/**
 * Map `input` from `inputRange` to `outputRange` (piecewise linear, then eased per
 * segment). Same contract as Remotion's `interpolate()`, including defaults
 * (`extend` on both sides), so values computed here match Remotion renders.
 */
export function interpolate(input: number, inputRange: readonly number[], outputRange: readonly number[], options: InterpolateOptions = {}): number {
  if (inputRange.length !== outputRange.length) throw new Error('inputRange and outputRange must have the same length');
  if (inputRange.length < 2) throw new Error('inputRange must have at least 2 elements');
  for (let i = 1; i < inputRange.length; i++) {
    if (!(inputRange[i]! > inputRange[i - 1]!)) throw new Error('inputRange must be strictly increasing');
  }
  const easing = toFn(options.easing);
  const left = options.extrapolateLeft ?? 'extend';
  const right = options.extrapolateRight ?? 'extend';

  let seg = 1;
  while (seg < inputRange.length - 1 && input > inputRange[seg]!) seg++;
  const inMin = inputRange[seg - 1]!;
  const inMax = inputRange[seg]!;
  const outMin = outputRange[seg - 1]!;
  const outMax = outputRange[seg]!;

  if (input < inMin) {
    if (left === 'clamp') return outMin;
    if (left === 'identity') return input;
  }
  if (input > inMax) {
    if (right === 'clamp') return outMax;
    if (right === 'identity') return input;
  }
  const t = (input - inMin) / (inMax - inMin);
  const eased = t < 0 || t > 1 ? t : easing(t);
  return lerp(outMin, outMax, eased);
}

/**
 * Sample a keyframe list at `frame`. Keyframes must be sorted by frame (the
 * validator enforces it). Holds the first/last value outside the range.
 * Uses binary search: O(log k) per sample.
 */
export function sampleKeyframes(keyframes: readonly Keyframe[], frame: number, defaultEasing?: Easing): number {
  const n = keyframes.length;
  if (n === 0) throw new Error('Cannot sample an empty keyframe list');
  const first = keyframes[0]!;
  const last = keyframes[n - 1]!;
  if (n === 1 || frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid]!.frame <= frame) lo = mid;
    else hi = mid;
  }
  const a = keyframes[lo]!;
  const b = keyframes[hi]!;
  const span = b.frame - a.frame;
  if (span <= 0) return b.value;
  const t = (frame - a.frame) / span;
  return lerp(a.value, b.value, getEasingFunction(a.easing ?? defaultEasing)(t));
}
