/**
 * Deterministic easing functions. Every easing maps progress t ∈ [0, 1] to an
 * eased value (which may overshoot for back/elastic/spring). Functions are
 * created once per distinct config and cached, so per-frame evaluation is a
 * plain function call.
 */
import type { CubicBezierEasing, Easing, EasingPreset, SpringEasing, StepsEasing } from '../model/primitives.js';

export type EasingFunction = (t: number) => number;

// ---------------------------------------------------------------------------
// Cubic bezier (same algorithm family as CSS / Remotion's Easing.bezier)
// ---------------------------------------------------------------------------

const NEWTON_ITERATIONS = 8;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 12;
const SAMPLE_SIZE = 11;
const SAMPLE_STEP = 1 / (SAMPLE_SIZE - 1);

const A = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
const B = (a1: number, a2: number) => 3 * a2 - 6 * a1;
const C = (a1: number) => 3 * a1;
const calcBezier = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
const getSlope = (t: number, a1: number, a2: number) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new RangeError('cubicBezier x values must be in [0, 1]');
  if (x1 === y1 && x2 === y2) return (t) => t;

  const samples = new Float64Array(SAMPLE_SIZE);
  for (let i = 0; i < SAMPLE_SIZE; i++) samples[i] = calcBezier(i * SAMPLE_STEP, x1, x2);

  const tForX = (x: number): number => {
    let start = 0;
    let i = 1;
    for (; i !== SAMPLE_SIZE - 1 && samples[i]! <= x; i++) start += SAMPLE_STEP;
    i--;
    const dist = (x - samples[i]!) / (samples[i + 1]! - samples[i]!);
    let guess = start + dist * SAMPLE_STEP;
    const slope = getSlope(guess, x1, x2);
    if (slope >= NEWTON_MIN_SLOPE) {
      for (let n = 0; n < NEWTON_ITERATIONS; n++) {
        const s = getSlope(guess, x1, x2);
        if (s === 0) break;
        guess -= (calcBezier(guess, x1, x2) - x) / s;
      }
      return guess;
    }
    if (slope === 0) return guess;
    let a = start;
    let b = start + SAMPLE_STEP;
    let cur = 0;
    let n = 0;
    do {
      cur = a + (b - a) / 2;
      const v = calcBezier(cur, x1, x2) - x;
      if (v > 0) b = cur;
      else a = cur;
    } while (Math.abs(calcBezier(cur, x1, x2) - x) > SUBDIVISION_PRECISION && ++n < SUBDIVISION_MAX_ITERATIONS);
    return cur;
  };

  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return calcBezier(tForX(t), y1, y2);
  };
}

// ---------------------------------------------------------------------------
// Spring (analytic damped harmonic oscillator, 0 -> 1, zero initial velocity)
// ---------------------------------------------------------------------------

export interface SpringConfig {
  mass: number;
  stiffness: number;
  damping: number;
  overshootClamping: boolean;
}

/** Same defaults as Remotion's `spring()`. */
export const DEFAULT_SPRING: SpringConfig = { mass: 1, stiffness: 100, damping: 10, overshootClamping: false };

export function resolveSpringConfig(config: Partial<SpringConfig> = {}): SpringConfig {
  return {
    mass: config.mass ?? DEFAULT_SPRING.mass,
    stiffness: config.stiffness ?? DEFAULT_SPRING.stiffness,
    damping: config.damping ?? DEFAULT_SPRING.damping,
    overshootClamping: config.overshootClamping ?? DEFAULT_SPRING.overshootClamping,
  };
}

/** Spring position at `timeInSeconds`, going from 0 to 1. */
export function springValue(timeInSeconds: number, config: Partial<SpringConfig> = {}): number {
  const { mass, stiffness, damping, overshootClamping } = resolveSpringConfig(config);
  const t = Math.max(0, timeInSeconds);
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let x: number;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * omega0 * t);
    x = 1 - env * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
  } else if (zeta === 1) {
    x = 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -omega0 * (zeta - s);
    const r2 = -omega0 * (zeta + s);
    x = 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  }
  return overshootClamping ? Math.min(1, x) : x;
}

const settleCache = new Map<string, number>();

/** Seconds until the spring stays within `threshold` of its target. Cached per config. */
export function springSettleTime(config: Partial<SpringConfig> = {}, threshold = 0.001): number {
  const c = resolveSpringConfig(config);
  const key = `${c.mass}|${c.stiffness}|${c.damping}|${c.overshootClamping}|${threshold}`;
  const cached = settleCache.get(key);
  if (cached !== undefined) return cached;
  const step = 1 / 600;
  const max = 30;
  let lastOutside = 0;
  for (let t = 0; t <= max; t += step) {
    if (Math.abs(springValue(t, c) - 1) >= threshold) lastOutside = t;
  }
  const settle = Math.min(max, lastOutside + step);
  settleCache.set(key, settle);
  return settle;
}

/** Spring stretched over progress: t=0 → 0, t=1 → settled (exactly 1). */
export function springEasing(config: Partial<SpringConfig> = {}): EasingFunction {
  const settle = springSettleTime(config);
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : springValue(t * settle, config));
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export const EASING_PRESETS: Readonly<Record<EasingPreset, EasingFunction>> = {
  linear: (t) => t,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  easeIn: cubicBezier(0.42, 0, 1, 1),
  easeOut: cubicBezier(0, 0, 0.58, 1),
  easeInOut: cubicBezier(0.42, 0, 0.58, 1),
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeInCubic: (t) => t ** 3,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  easeInQuart: (t) => t ** 4,
  easeOutQuart: (t) => 1 - (1 - t) ** 4,
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  easeInExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  easeInOutExpo: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  easeInBack: (t) => c3 * t ** 3 - c1 * t * t,
  easeOutBack: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  easeInOutBack: (t) =>
    t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  easeOutBounce: bounceOut,
  easeOutElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 3) + 1),
};

export function isEasingPreset(value: unknown): value is EasingPreset {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EASING_PRESETS, value);
}

function steps({ steps: n, position = 'end' }: StepsEasing): EasingFunction {
  const count = Math.max(1, Math.floor(n));
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return position === 'start' ? Math.ceil(t * count) / count : Math.floor(t * count) / count;
  };
}

const easingCache = new Map<string, EasingFunction>();

function cacheKey(easing: CubicBezierEasing | SpringEasing | StepsEasing): string {
  switch (easing.type) {
    case 'cubicBezier':
      return `b:${easing.points.join(',')}`;
    case 'spring':
      return `s:${easing.mass}|${easing.stiffness}|${easing.damping}|${easing.overshootClamping}`;
    case 'steps':
      return `st:${easing.steps}|${easing.position}`;
  }
}

/** Resolve an `Easing` description into a (cached) function. Defaults to linear. */
export function getEasingFunction(easing: Easing | undefined): EasingFunction {
  if (easing === undefined) return EASING_PRESETS.linear;
  if (typeof easing === 'string') {
    const fn = EASING_PRESETS[easing];
    if (!fn) throw new Error(`Unknown easing preset "${easing}"`);
    return fn;
  }
  const key = cacheKey(easing);
  let fn = easingCache.get(key);
  if (!fn) {
    switch (easing.type) {
      case 'cubicBezier':
        fn = cubicBezier(...easing.points);
        break;
      case 'spring':
        fn = springEasing(easing);
        break;
      case 'steps':
        fn = steps(easing);
        break;
    }
    easingCache.set(key, fn);
  }
  return fn;
}
