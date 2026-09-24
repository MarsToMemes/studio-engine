import type { AspectRatio, Dimensions } from '../model/primitives.js';

export function parseAspectRatio(ratio: AspectRatio): { w: number; h: number } | undefined {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : undefined;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Canvas size for an aspect ratio with the SHORT side at `shortSide` px
 * (1080 by default: 16:9 → 1920×1080, 9:16 → 1080×1920, 4:5 → 1080×1350).
 * Sizes are rounded to even numbers, as required by H.264 encoders.
 */
export function dimensionsForAspectRatio(ratio: AspectRatio, shortSide = 1080): Dimensions {
  const r = parseAspectRatio(ratio);
  if (!r) throw new Error(`Invalid aspect ratio "${ratio}"`);
  return r.w >= r.h ? { width: even((shortSide * r.w) / r.h), height: even(shortSide) } : { width: even(shortSide), height: even((shortSide * r.h) / r.w) };
}

/** True when `dimensions` match `ratio` within 1%. */
export function matchesAspectRatio(dimensions: Dimensions, ratio: AspectRatio): boolean {
  const r = parseAspectRatio(ratio);
  if (!r || dimensions.height <= 0) return false;
  return Math.abs(dimensions.width / dimensions.height - r.w / r.h) / (r.w / r.h) < 0.01;
}
