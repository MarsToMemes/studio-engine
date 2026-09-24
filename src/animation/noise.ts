/**
 * Seeded, deterministic noise. Same (seed, t) always yields the same value on
 * every machine, which is required for frame-accurate, parallel rendering.
 */

/** Integer hash → [0, 1). Mulberry32 finaliser. */
export function hash01(seed: number, n: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(n | 0, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/** Smooth 1D value noise in [-1, 1]. */
export function valueNoise(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash01(seed, i) * 2 - 1;
  const b = hash01(seed, i + 1) * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}
