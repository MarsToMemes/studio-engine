import { describe, expect, it } from 'vitest';
import {
  AnimationProviderRegistry,
  createExternalProvider,
  createRemotionAnimationProvider,
  cubicBezier,
  DEFAULT_SPRING,
  EASING_PRESETS,
  evaluateAnimations,
  evaluateNative,
  getEasingFunction,
  interpolate,
  nativeAnimationProvider,
  resolveAnimationWindow,
  sampleKeyframes,
  springSettleTime,
  springValue,
  type Animation,
  type AnimationState,
} from '../src/index.js';

const box = { width: 1000, height: 500 };
const at = (animation: Animation, frame: number, owner = 100, unit?: { index: number; count: number }) =>
  evaluateNative(animation, { fps: 30, frame, box, window: resolveAnimationWindow(animation, { ownerDurationInFrames: owner, fps: 30, unitCount: unit?.count ?? 1 }), ...(unit ? { unit } : {}) });

describe('easing', () => {
  it('every preset maps 0→0 and 1→1', () => {
    for (const [name, fn] of Object.entries(EASING_PRESETS)) {
      expect(fn(0), name).toBeCloseTo(0, 6);
      expect(fn(1), name).toBeCloseTo(1, 6);
    }
  });
  it('cubic bezier matches CSS ease-in-out at the midpoint and is monotonic', () => {
    const f = cubicBezier(0.42, 0, 0.58, 1);
    expect(f(0.5)).toBeCloseTo(0.5, 5);
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      expect(f(t)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f(t);
    }
    expect(() => cubicBezier(1.2, 0, 0, 1)).toThrow();
  });
  it('resolves and caches easing objects', () => {
    const a = getEasingFunction({ type: 'cubicBezier', points: [0.25, 0.1, 0.25, 1] });
    expect(getEasingFunction({ type: 'cubicBezier', points: [0.25, 0.1, 0.25, 1] })).toBe(a);
    expect(getEasingFunction({ type: 'steps', steps: 4 })(0.3)).toBe(0.25);
    expect(getEasingFunction(undefined)(0.3)).toBe(0.3);
    expect(() => getEasingFunction('nope' as never)).toThrow();
  });
  it('spring starts at 0, overshoots with low damping and settles at 1', () => {
    expect(springValue(0)).toBe(0);
    expect(Math.max(...Array.from({ length: 60 }, (_, i) => springValue(i / 30, DEFAULT_SPRING)))).toBeGreaterThan(1);
    expect(springValue(5)).toBeCloseTo(1, 3);
    expect(springValue(0.2, { damping: 40, stiffness: 100, mass: 1 })).toBeLessThan(1); // overdamped
    expect(springValue(0.35, { overshootClamping: true })).toBeLessThanOrEqual(1);
    const settle = springSettleTime();
    expect(settle).toBeGreaterThan(0.5);
    expect(getEasingFunction({ type: 'spring' })(1)).toBe(1);
  });
});

describe('interpolate (Remotion contract)', () => {
  it('maps ranges, extends by default and clamps on request', () => {
    expect(interpolate(15, [0, 30], [0, 1])).toBe(0.5);
    expect(interpolate(60, [0, 30], [0, 1])).toBe(2);
    expect(interpolate(60, [0, 30], [0, 1], { extrapolateRight: 'clamp' })).toBe(1);
    expect(interpolate(-5, [0, 30], [10, 20], { extrapolateLeft: 'clamp' })).toBe(10);
    expect(interpolate(45, [0, 30, 60], [0, 1, 0])).toBe(0.5);
    expect(interpolate(15, [0, 30], [0, 100], { easing: 'easeIn' })).toBeLessThan(50);
    expect(() => interpolate(0, [0, 0], [0, 1])).toThrow();
  });
  it('samples keyframes with per-segment easing', () => {
    const kf = [{ frame: 0, value: 1 }, { frame: 15, value: 1.08, easing: 'easeInOut' as const }, { frame: 60, value: 1 }];
    expect(sampleKeyframes(kf, -5)).toBe(1);
    expect(sampleKeyframes(kf, 7.5)).toBeCloseTo(1.04);
    expect(sampleKeyframes(kf, 15)).toBe(1.08);
    expect(sampleKeyframes(kf, 37.5)).toBeCloseTo(1.04);
    expect(sampleKeyframes(kf, 100)).toBe(1);
  });
});

describe('native animation evaluation', () => {
  it('fade (spec example)', () => {
    const a: Animation = { type: 'fade', from: 0, to: 1, durationInFrames: 15, easing: 'easeOut' };
    expect(at(a, 0).opacity).toBe(0);
    expect(at(a, 15).opacity).toBe(1);
    expect(at(a, 7).opacity!).toBeGreaterThan(7 / 15); // ease-out is ahead of linear
    expect(at({ type: 'fade', phase: 'out', durationInFrames: 10 }, 85).opacity).toBe(1);
    expect(at({ type: 'fade', phase: 'out', durationInFrames: 10 }, 100).opacity).toBe(0);
  });
  it('slide in comes from the opposite side and ends in place', () => {
    const a: Animation = { type: 'slide', phase: 'in', direction: 'up', distance: 10, units: 'percent', durationInFrames: 10, fade: true };
    const start = at(a, 0);
    expect(start.y).toBe(50);
    expect(start.x).toBeCloseTo(0);
    expect(start.opacity).toBe(0);
    const end = at(a, 10);
    expect(end.y).toBeCloseTo(0);
    expect(end.opacity).toBe(1);
    expect(at({ type: 'slide', phase: 'out', direction: 'right', distance: 100, units: 'px', durationInFrames: 10 }, 100).x).toBe(100);
  });
  it('scale / zoom / rotate / blur use phase defaults', () => {
    expect(at({ type: 'scale', phase: 'in', durationInFrames: 10 }, 0).scaleX).toBe(0.85);
    expect(at({ type: 'zoom', from: 1, to: 2, durationInFrames: 10, origin: { x: 0.2, y: 0.3 } }, 10)).toMatchObject({ scaleX: 2, origin: { x: 0.2, y: 0.3 } });
    expect(at({ type: 'rotate', from: 0, to: 90, durationInFrames: 10, easing: 'linear' }, 5).rotation).toBe(45);
    expect(at({ type: 'blur', phase: 'in', durationInFrames: 10 }, 0).blur).toBe(20);
    expect(at({ type: 'blur', phase: 'in', durationInFrames: 10 }, 10).blur).toBe(0);
  });
  it('bounce lands at rest', () => {
    const a: Animation = { type: 'bounce', height: 40, bounces: 2, durationInFrames: 30 };
    expect(at(a, 0).y).toBeCloseTo(0);
    expect(at(a, 30).y).toBeCloseTo(0);
    expect(at(a, 7).y!).toBeLessThan(0);
  });
  it('spring drives any property', () => {
    const a: Animation = { type: 'spring', property: 'x', from: -100, to: 0 };
    expect(at(a, 0).x).toBe(-100);
    expect(at(a, 90).x!).toBeCloseTo(0, 1);
    const stretched: Animation = { type: 'spring', property: 'opacity', from: 0, to: 1, durationInFrames: 20 };
    expect(at(stretched, 20).opacity).toBe(1);
  });
  it('stagger delays each unit', () => {
    const a: Animation = { type: 'stagger', each: 5, animation: { type: 'fade', durationInFrames: 10 } };
    expect(at(a, 10)).toEqual({}); // no unit context => no whole-layer effect
    expect(at(a, 10, 100, { index: 0, count: 3 }).opacity).toBe(1);
    expect(at(a, 10, 100, { index: 1, count: 3 }).opacity).toBe(0.5);
    expect(at(a, 10, 100, { index: 2, count: 3 }).opacity).toBe(0);
    const fromEnd: Animation = { ...a, from: 'end' };
    expect(at(fromEnd, 10, 100, { index: 2, count: 3 }).opacity).toBe(1);
  });
  it('reveal and mask reveal produce clip states', () => {
    expect(at({ type: 'reveal', direction: 'right', phase: 'in', durationInFrames: 10 }, 0).clip).toEqual({ kind: 'inset', top: 0, right: 100, bottom: 0, left: 0 });
    expect(at({ type: 'reveal', direction: 'right', phase: 'in', durationInFrames: 10 }, 10).clip).toMatchObject({ right: 0 });
    expect(at({ type: 'maskReveal', shape: 'circle', durationInFrames: 10 }, 10).clip).toMatchObject({ kind: 'circle', radius: 71 });
    expect(at({ type: 'maskReveal', shape: 'diagonal', durationInFrames: 10 }, 10).clip).toMatchObject({ kind: 'polygon' });
  });
  it('typewriter reports text progress', () => {
    expect(at({ type: 'typewriter', durationInFrames: 20 }, 10).textProgress).toBe(0.5);
  });
  it('kinetic typography is unit-level only', () => {
    const a: Animation = { type: 'kineticTypography', style: 'rise', split: 'words', each: 4, durationInFrames: 10 };
    expect(at(a, 5)).toEqual({});
    expect(at(a, 10, 100, { index: 0, count: 2 }).opacity).toBe(1);
    expect(at(a, 10, 100, { index: 1, count: 2 }).opacity!).toBeLessThan(1);
    for (const style of ['pop', 'slam', 'wave', 'flip', 'highlight'] as const) {
      const s = at({ type: 'kineticTypography', style, split: 'words', durationInFrames: 10 }, 5, 100, { index: 0, count: 1 });
      expect(Object.keys(s).length, style).toBeGreaterThan(0);
    }
  });
  it('parallax scales with depth', () => {
    const a = (depth: number): Animation => ({ type: 'parallax', depth, direction: 'left', distance: 100, durationInFrames: 10 });
    expect(at(a(1), 10).x).toBe(-100);
    expect(at(a(2), 10).x).toBe(-200);
  });
  it('camera moves', () => {
    expect(at({ type: 'camera', move: 'pushIn', intensity: 1, durationInFrames: 10 }, 10).scaleX).toBeCloseTo(1.12);
    expect(at({ type: 'camera', move: 'pullOut', intensity: 1, durationInFrames: 10 }, 10).scaleX).toBeCloseTo(1);
    const pan = (f: number) => at({ type: 'camera', move: 'panLeft', intensity: 1, durationInFrames: 10 }, f).x!;
    expect(pan(0)).toBeCloseTo(60);
    expect(pan(10)).toBeCloseTo(-60);
    for (const move of ['tiltUp', 'tiltDown', 'kenBurns', 'dolly', 'orbit', 'panRight'] as const) {
      expect(at({ type: 'camera', move, durationInFrames: 10 }, 5).scaleX, move).toBeGreaterThan(1);
    }
  });
  it('shake and glitch are deterministic', () => {
    const shake: Animation = { type: 'shake', amplitude: 10, seed: 42, durationInFrames: 60 };
    const s1 = at(shake, 17);
    expect(at(shake, 17)).toEqual(s1);
    expect(Math.abs(s1.x!)).toBeLessThanOrEqual(10);
    expect(at({ ...shake, seed: 43 }, 17)).not.toEqual(s1);
    const glitch: Animation = { type: 'glitch', seed: 3, durationInFrames: 60 };
    const frames = Array.from({ length: 60 }, (_, f) => at(glitch, f));
    expect(frames).toEqual(Array.from({ length: 60 }, (_, f) => at(glitch, f)));
    expect(frames.some((s) => s.glitch)).toBe(true);
    expect(frames.some((s) => !s.glitch)).toBe(true);
  });
  it('keyframes (spec example)', () => {
    const a: Animation = { type: 'keyframes', tracks: [{ property: 'scale', keyframes: [{ frame: 0, value: 1 }, { frame: 15, value: 1.08 }, { frame: 60, value: 1 }] }] };
    expect(at(a, 0).scaleX).toBe(1);
    expect(at(a, 15).scaleX).toBeCloseTo(1.08);
    expect(at(a, 60).scaleX).toBe(1);
    expect(at(a, 90).scaleX).toBe(1);
  });
  it('custom animations are not handled by the native provider', () => {
    expect(nativeAnimationProvider.supports({ type: 'custom', name: 'x' })).toBe(false);
  });
});

describe('combining animations', () => {
  it('multiplies opacity/scale and adds translations', () => {
    const registry = new AnimationProviderRegistry();
    const items = [
      { type: 'fade', from: 0.5, to: 0.5 },
      { type: 'fade', from: 0.5, to: 0.5 },
      { type: 'slide', direction: 'right', distance: 10, units: 'px', easing: 'linear' },
      { type: 'slide', direction: 'right', distance: 10, units: 'px', easing: 'linear' },
      { type: 'scale', from: 2, to: 2 },
      { type: 'fade', enabled: false, from: 0, to: 0 },
    ] satisfies Animation[];
    const windowed = items.map((animation) => ({ animation, window: resolveAnimationWindow(animation, { ownerDurationInFrames: 10, fps: 30 }) }));
    const s: AnimationState = evaluateAnimations(windowed, { fps: 30, frame: 10, box, registry, mode: 'render' });
    expect(s.opacity).toBe(0.25);
    expect(s.x).toBe(20);
    expect(s.scaleX).toBe(2);
  });
});

describe('animation providers', () => {
  const custom: Animation = { type: 'custom', name: 'wiggle', provider: 'gsap' };
  const gsapLike = createExternalProvider({ id: 'gsap', deterministic: true, supports: (a) => a.type === 'custom' && a.name === 'wiggle', evaluate: () => ({ rotation: 5 }) });
  const motionLike = createExternalProvider({ id: 'motion', deterministic: false, supports: ['fade'], evaluate: () => ({ opacity: 0.123 }) });

  it('uses a registered deterministic external provider in render mode', () => {
    const registry = new AnimationProviderRegistry().register(gsapLike);
    expect(registry.resolve(custom, 'render')).toMatchObject({ provider: gsapLike, fallback: false });
  });

  it('falls back to the default deterministic provider for preview-only providers', () => {
    const registry = new AnimationProviderRegistry().register(motionLike);
    const fade: Animation = { type: 'fade', provider: 'motion' };
    expect(registry.resolve(fade, 'preview')).toMatchObject({ provider: motionLike, fallback: false });
    const render = registry.resolve(fade, 'render');
    expect(render.provider).toBe(nativeAnimationProvider);
    expect(render.fallback).toBe(true);
    expect(render.reason).toMatch(/not deterministic/);
  });

  it('reports animations nobody can evaluate', () => {
    const registry = new AnimationProviderRegistry();
    const reasons: string[] = [];
    const s = evaluateAnimations([{ animation: custom, window: { startFrame: 0, durationInFrames: 10, endFrame: 10, iterations: 1 } }], {
      fps: 30, frame: 5, box, registry, mode: 'render', onFallback: (_a, r) => reasons.push(r),
    });
    expect(s.rotation).toBe(0);
    expect(reasons[0]).toMatch(/not registered/);
  });

  it('refuses a non-deterministic default provider', () => {
    expect(() => new AnimationProviderRegistry().register(motionLike, { default: true })).toThrow();
  });

  it('the Remotion provider delegates springs to the injected Remotion spring()', () => {
    const calls: unknown[] = [];
    const provider = createRemotionAnimationProvider({ spring: (o) => (calls.push(o), 0.5) });
    const a: Animation = { type: 'spring', property: 'x', from: 0, to: 100, damping: 200 };
    const window = resolveAnimationWindow(a, { ownerDurationInFrames: 30, fps: 30 });
    expect(provider.evaluate(a, { fps: 30, frame: 10, box, window })).toEqual({ x: 0.5 });
    expect(calls[0]).toMatchObject({ frame: 10, fps: 30, from: 0, to: 100, config: { damping: 200 } });
    // Everything else goes through the native implementation.
    const fade: Animation = { type: 'fade', durationInFrames: 10 };
    expect(provider.evaluate(fade, { fps: 30, frame: 5, box, window: resolveAnimationWindow(fade, { ownerDurationInFrames: 30, fps: 30 }) })).toEqual({ opacity: 0.5 });
  });
});
