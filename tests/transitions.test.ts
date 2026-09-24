import { describe, expect, it } from 'vitest';
import { BUILT_IN_TRANSITIONS, defaultTransitionRegistry, TRANSITION_TYPES, TransitionRegistry, toRemotionDirection } from '../src/index.js';

const box = { width: 1920, height: 1080 };
const reg = defaultTransitionRegistry;

describe('transition registry', () => {
  it('defines every built-in transition type', () => {
    expect(BUILT_IN_TRANSITIONS.map((t) => t.type).sort()).toEqual([...TRANSITION_TYPES].sort());
  });

  it('creates transitions with defaults in frames', () => {
    expect(reg.create('crossfade', 30)).toEqual({ type: 'crossfade', durationInFrames: 15, easing: 'linear', intensity: 1 });
    expect(reg.create('flash', 60)).toMatchObject({ durationInFrames: 18, params: { color: '#ffffff' } });
    expect(reg.create('push', 30, { direction: 'up', durationInFrames: 9 })).toMatchObject({ direction: 'up', durationInFrames: 9 });
    expect(reg.create('cut', 30).durationInFrames).toBe(0);
    expect(() => reg.create('teleport', 30)).toThrow();
  });

  it('every transition shows the outgoing scene at 0 and the incoming scene at the end', () => {
    for (const def of BUILT_IN_TRANSITIONS) {
      if (def.type === 'cut') continue;
      const t = reg.create(def.type, 30);
      const start = reg.evaluate(t, 0, { box });
      const end = reg.evaluate(t, t.durationInFrames, { box });
      expect(end.entering.opacity ?? 1, `${def.type} entering opacity at end`).toBeCloseTo(1);
      expect(end.entering.x ?? 0, `${def.type} entering x at end`).toBeCloseTo(0);
      expect(end.entering.blur ?? 0, `${def.type} blur at end`).toBeCloseTo(0);
      if (end.entering.clip?.kind === 'inset') expect(end.entering.clip).toMatchObject({ top: 0, right: 0, bottom: 0, left: 0 });
      expect(start.exiting.opacity ?? 1, `${def.type} exiting opacity at start`).toBeCloseTo(1);
      expect(start.overlay?.opacity ?? 0, `${def.type} overlay at start`).toBeCloseTo(0);
      expect(end.overlay?.opacity ?? 0, `${def.type} overlay at end`).toBeCloseTo(0);
    }
  });

  it('flash and dip peak in the middle', () => {
    const flash = reg.create('flash', 30, { durationInFrames: 10 });
    expect(reg.evaluate(flash, 5, { box }).overlay).toMatchObject({ color: '#ffffff', opacity: 1 });
    const dip = reg.create('fade', 30, { durationInFrames: 20, params: { color: '#ff0000' } });
    expect(reg.evaluate(dip, 10, { box }).overlay).toMatchObject({ color: '#ff0000' });
  });

  it('maps to Remotion built-in presentations when they exist, custom otherwise', () => {
    const mapping = (type: string, extra = {}) => reg.toRemotion(reg.create(type, 30, extra), { box })?.presentation;
    expect(mapping('crossfade')).toEqual({ kind: 'builtin', name: 'fade', props: {} });
    expect(mapping('push', { direction: 'left' })).toEqual({ kind: 'builtin', name: 'slide', props: { direction: 'from-right' } });
    expect(mapping('wipe', { direction: 'down' })).toEqual({ kind: 'builtin', name: 'wipe', props: { direction: 'from-top' } });
    expect(mapping('flip')).toMatchObject({ kind: 'builtin', name: 'flip' });
    expect(mapping('iris')).toEqual({ kind: 'builtin', name: 'iris', props: { width: 1920, height: 1080 } });
    for (const t of ['fade', 'slide', 'zoom', 'zoomBlur', 'whip', 'filmBurn', 'ripple', 'glitch', 'blur', 'flash']) expect(mapping(t)?.kind, t).toBe('custom');
    expect(reg.toRemotion({ type: 'cut', durationInFrames: 0 }, { box })).toBeUndefined();
  });

  it('builds Remotion timings (linear with easing, or spring)', () => {
    expect(reg.toRemotion({ type: 'crossfade', durationInFrames: 12, easing: 'easeInOut' }, { box })?.timing).toEqual({ kind: 'linear', durationInFrames: 12, easing: 'easeInOut' });
    expect(reg.toRemotion({ type: 'crossfade', durationInFrames: 12, easing: { type: 'spring', damping: 200 } }, { box })?.timing).toEqual({ kind: 'spring', durationInFrames: 12, config: { damping: 200 } });
  });

  it('converts directions to Remotion "from-*" names', () => {
    expect(['right', 'left', 'down', 'up'].map((d) => toRemotionDirection(d as never))).toEqual(['from-left', 'from-right', 'from-top', 'from-bottom']);
  });

  it('accepts custom transitions', () => {
    const custom = new TransitionRegistry().register({
      type: 'lightLeak',
      label: 'Light leak',
      description: 'Organic light leak overlay',
      defaultDurationInSeconds: 1,
      defaultEasing: 'easeInOut',
      directional: false,
      defaultIntensity: 1,
      toRemotion: () => ({ kind: 'custom', name: 'lightLeak', props: {} }),
      evaluate: (_t, p) => ({ exiting: {}, entering: { opacity: p }, overlay: { color: '#ffcc88', opacity: Math.sin(Math.PI * p) } }),
    });
    expect(custom.create('lightLeak', 24).durationInFrames).toBe(24);
    expect(custom.evaluate({ type: 'lightLeak', durationInFrames: 24 }, 12, { box }).overlay!.opacity).toBeCloseTo(1);
  });
});
