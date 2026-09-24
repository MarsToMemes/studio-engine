/**
 * The native provider: pure TypeScript, zero dependencies, deterministic.
 * It is the reference implementation of every built-in animation type and
 * the default provider for the final render.
 */
import type {
  AnimatableProperty,
  Animation,
  AnimationPhase,
  CameraAnimation,
  KineticTypographyAnimation,
  LeafAnimation,
} from '../../model/animation.js';
import type { Direction, Easing, Vec2 } from '../../model/primitives.js';
import { animationProgressAt, DEFAULT_KINETIC_EACH } from '../../timing/windows.js';
import { getEasingFunction, springEasing, springValue } from '../easing.js';
import { lerp, sampleKeyframes } from '../interpolate.js';
import { hash01, valueNoise } from '../noise.js';
import type { AnimationState } from '../state.js';
import type { AnimationEvaluationContext, AnimationProvider } from './types.js';

const DIRECTION_VECTORS: Readonly<Record<Direction, Vec2>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const CENTER: Vec2 = { x: 0.5, y: 0.5 };

interface LeafContext extends AnimationEvaluationContext {
  phase: AnimationPhase;
  /** Frames elapsed since this animation (or unit) started, >= 0. */
  elapsed: number;
}

function range(phase: AnimationPhase, from: number | undefined, to: number | undefined, inRange: [number, number], outRange: [number, number], duringRange = inRange): [number, number] {
  const d = phase === 'out' ? outRange : phase === 'in' ? inRange : duringRange;
  return [from ?? d[0], to ?? d[1]];
}

function ease(easing: Easing | undefined, p: number, fallback: Easing = 'linear'): number {
  return getEasingFunction(easing ?? fallback)(p);
}

/** Map a single property value onto a state delta. */
export function propertyDelta(property: AnimatableProperty, value: number): Partial<AnimationState> {
  switch (property) {
    case 'opacity':
      return { opacity: value };
    case 'x':
      return { x: value };
    case 'y':
      return { y: value };
    case 'scale':
      return { scaleX: value, scaleY: value };
    case 'scaleX':
      return { scaleX: value };
    case 'scaleY':
      return { scaleY: value };
    case 'rotation':
      return { rotation: value };
    case 'blur':
      return { blur: value };
    case 'skewX':
      return { skewX: value };
    case 'skewY':
      return { skewY: value };
    case 'clipInset':
      return { clip: { kind: 'inset', top: value, right: value, bottom: value, left: value } };
    case 'brightness':
      return { brightness: value };
    case 'saturation':
      return { saturation: value };
  }
}

function mergeInto(target: Partial<AnimationState>, delta: Partial<AnimationState>): void {
  for (const key of Object.keys(delta) as Array<keyof AnimationState>) {
    const v = delta[key];
    const cur = target[key];
    if (typeof v === 'number' && typeof cur === 'number') {
      const multiplicative = key === 'opacity' || key === 'scaleX' || key === 'scaleY' || key === 'brightness' || key === 'saturation';
      (target as Record<string, unknown>)[key] = multiplicative ? cur * v : cur + v;
    } else {
      (target as Record<string, unknown>)[key] = v;
    }
  }
}

function camera(a: CameraAnimation, e: number, ctx: LeafContext): Partial<AnimationState> {
  const m = 0.12 * (a.intensity ?? 1);
  const { width: W, height: H } = ctx.box;
  const origin = a.focus ?? CENTER;
  switch (a.move) {
    case 'pushIn': {
      const s = 1 + m * e;
      return { scaleX: s, scaleY: s, origin };
    }
    case 'pullOut': {
      const s = 1 + m * (1 - e);
      return { scaleX: s, scaleY: s, origin };
    }
    case 'panLeft':
    case 'panRight': {
      const sign = a.move === 'panLeft' ? 1 : -1;
      return { scaleX: 1 + m, scaleY: 1 + m, x: sign * ((m * W) / 2) * (1 - 2 * e) };
    }
    case 'tiltUp':
    case 'tiltDown': {
      const sign = a.move === 'tiltUp' ? 1 : -1;
      return { scaleX: 1 + m, scaleY: 1 + m, y: sign * ((m * H) / 2) * (1 - 2 * e) };
    }
    case 'kenBurns': {
      const s = 1 + m * e;
      return { scaleX: s, scaleY: s, origin };
    }
    case 'dolly': {
      const s = 1 + 1.5 * m * e;
      return { scaleX: s, scaleY: s, y: -m * H * 0.1 * e, origin };
    }
    case 'orbit': {
      const s = 1 + m * 0.5;
      return { scaleX: s, scaleY: s, x: m * W * 0.25 * Math.sin(2 * Math.PI * e), rotation: 2 * (a.intensity ?? 1) * Math.sin(2 * Math.PI * e) };
    }
  }
}

function kinetic(a: KineticTypographyAnimation, p: number, phase: AnimationPhase): Partial<AnimationState> {
  const k = a.intensity ?? 1;
  const q = phase === 'out' ? 1 - p : p;
  switch (a.style) {
    case 'pop': {
      const e = ease(a.easing, q, 'easeOutBack');
      const s = lerp(0.4, 1, e);
      return { scaleX: s, scaleY: s, opacity: Math.min(1, q * 3) };
    }
    case 'slam': {
      const e = ease(a.easing, q, 'easeOutCubic');
      const s = lerp(1 + 1.5 * k, 1, e);
      return { scaleX: s, scaleY: s, opacity: Math.min(1, q * 4) };
    }
    case 'rise': {
      const e = ease(a.easing, q, 'easeOutCubic');
      return { y: (1 - e) * 40 * k, opacity: e };
    }
    case 'wave':
      return { y: -Math.sin(Math.PI * q) * 20 * k };
    case 'flip': {
      const e = ease(a.easing, q, 'easeOutBack');
      return { scaleY: e, opacity: Math.min(1, q * 2) };
    }
    case 'highlight': {
      const e = ease(a.easing, q, 'easeOutCubic');
      const s = 1 + 0.08 * k * Math.sin(Math.PI * q);
      return { highlight: e, scaleX: s, scaleY: s };
    }
  }
}

function leaf(a: LeafAnimation, p: number, ctx: LeafContext): Partial<AnimationState> {
  const phase = ctx.phase;
  switch (a.type) {
    case 'fade': {
      const [f, t] = range(phase, a.from, a.to, [0, 1], [1, 0]);
      return { opacity: lerp(f, t, ease(a.easing, p)) };
    }
    case 'slide': {
      const e = ease(a.easing, p, 'easeOutCubic');
      const dir = DIRECTION_VECTORS[a.direction];
      const units = a.units ?? 'percent';
      const dist = a.distance ?? 100;
      const dx = units === 'percent' ? (dist / 100) * ctx.box.width : dist;
      const dy = units === 'percent' ? (dist / 100) * ctx.box.height : dist;
      const k = phase === 'in' ? -(1 - e) : e;
      const out: Partial<AnimationState> = { x: dir.x * dx * k, y: dir.y * dy * k };
      if (a.fade) out.opacity = phase === 'out' ? 1 - e : phase === 'in' ? e : 1;
      return out;
    }
    case 'scale': {
      const [f, t] = range(phase, a.from, a.to, [0.85, 1], [1, 0.85], [1, 1.1]);
      const s = lerp(f, t, ease(a.easing, p, 'easeOutCubic'));
      return { scaleX: s, scaleY: s };
    }
    case 'zoom': {
      const s = lerp(a.from ?? 1, a.to ?? 1.15, ease(a.easing, p, 'easeInOut'));
      return { scaleX: s, scaleY: s, origin: a.origin ?? CENTER };
    }
    case 'rotate': {
      const [f, t] = range(phase, a.from, a.to, [-8, 0], [0, 8], [0, 360]);
      return { rotation: lerp(f, t, ease(a.easing, p, 'easeOutCubic')) };
    }
    case 'blur': {
      const [f, t] = range(phase, a.from, a.to, [20, 0], [0, 20], [0, 10]);
      return { blur: Math.max(0, lerp(f, t, ease(a.easing, p, 'easeOutCubic'))) };
    }
    case 'bounce': {
      const e = ease(a.easing, p);
      const h = a.height ?? 40;
      const n = a.bounces ?? 3;
      return { y: -h * Math.abs(Math.sin(Math.PI * n * e)) * (1 - e) };
    }
    case 'spring': {
      const cfg = { mass: a.mass, stiffness: a.stiffness, damping: a.damping, overshootClamping: a.overshootClamping };
      const clean = Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined));
      // Stretched to the explicit duration when one is given, natural physics otherwise.
      const s = a.durationInFrames !== undefined ? springEasing(clean)(p) : springValue(ctx.elapsed / ctx.fps, clean);
      return propertyDelta(a.property, lerp(a.from, a.to, s));
    }
    case 'reveal': {
      const e = ease(a.easing, p, 'easeInOutCubic');
      const hidden = (phase === 'out' ? e : 1 - e) * 100;
      const inset = { kind: 'inset' as const, top: 0, right: 0, bottom: 0, left: 0 };
      if (a.direction === 'right') inset.right = hidden;
      else if (a.direction === 'left') inset.left = hidden;
      else if (a.direction === 'down') inset.bottom = hidden;
      else inset.top = hidden;
      return { clip: inset };
    }
    case 'maskReveal': {
      const e = ease(a.easing, p, 'easeInOutCubic');
      const r = phase === 'out' ? 1 - e : e;
      if (a.shape === 'circle') return { clip: { kind: 'circle', radius: r * 71, center: a.center ?? CENTER } };
      if (a.shape === 'diagonal') {
        const d = r * 200;
        return { clip: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: d, y: 0 }, { x: 0, y: d }] } };
      }
      return leaf({ type: 'reveal', direction: a.direction ?? 'right', easing: 'linear' }, e, ctx);
    }
    case 'typewriter': {
      const e = ease(a.easing, p);
      return { textProgress: phase === 'out' ? 1 - e : e };
    }
    case 'kineticTypography':
      // Unit-level only; the text renderer calls the provider once per unit.
      return ctx.unit ? kinetic(a, p, phase) : {};
    case 'parallax': {
      const e = ease(a.easing, p);
      const dir = DIRECTION_VECTORS[a.direction];
      const d = (a.distance ?? 100) * a.depth * e;
      return { x: dir.x * d, y: dir.y * d };
    }
    case 'camera':
      return camera(a, ease(a.easing, p, 'easeInOut'), ctx);
    case 'shake': {
      const t = ctx.elapsed / ctx.fps;
      const f = a.frequency ?? 12;
      const seed = a.seed ?? 1;
      const envelope = phase === 'in' ? 1 - p : phase === 'out' ? p : p >= 1 ? 0 : 1;
      const amp = (a.amplitude ?? 8) * envelope;
      const out: Partial<AnimationState> = { x: amp * valueNoise(seed, t * f), y: amp * valueNoise(seed + 101, t * f) };
      if (a.rotation) out.rotation = a.rotation * envelope * valueNoise(seed + 202, t * f);
      return out;
    }
    case 'glitch': {
      if (p <= 0 || p >= 1) return {};
      const t = ctx.elapsed / ctx.fps;
      const seed = a.seed ?? 7;
      const k = a.intensity ?? 1;
      const slot = Math.floor(t * (a.frequency ?? 8) * 2);
      if (hash01(seed, slot) >= 0.5) return {};
      const offsetX = (hash01(seed + 1, slot) * 2 - 1) * 20 * k;
      return {
        x: offsetX * 0.3,
        glitch: { offsetX, rgbSplit: (2 + hash01(seed + 2, slot) * 6) * k, sliceSeed: Math.floor(hash01(seed + 3, Math.round(ctx.elapsed)) * 1e6) },
      };
    }
    case 'keyframes': {
      const frame = ease(a.easing, p) * ctx.window.durationInFrames;
      const out: Partial<AnimationState> = {};
      for (const track of a.tracks) {
        if (track.keyframes.length === 0) continue;
        mergeInto(out, propertyDelta(track.property, sampleKeyframes(track.keyframes, frame)));
      }
      return out;
    }
    case 'custom':
      return {};
  }
}

function unitOrder(index: number, count: number, from: 'start' | 'end' | 'center' = 'start'): number {
  if (from === 'end') return count - 1 - index;
  if (from === 'center') return Math.abs(index - (count - 1) / 2);
  return index;
}

export function evaluateNative(animation: Animation, ctx: AnimationEvaluationContext): Partial<AnimationState> {
  const phase = animation.phase ?? 'during';
  const { window } = ctx;

  if (animation.type === 'stagger') {
    if (!ctx.unit) return {};
    const delay = animation.each * unitOrder(ctx.unit.index, ctx.unit.count, animation.from);
    const p = animationProgressAt(animation, window, ctx.frame, delay);
    const elapsed = Math.max(0, ctx.frame - window.startFrame - delay);
    const inner = animation.animation.easing || !animation.easing ? animation.animation : { ...animation.animation, easing: animation.easing };
    return leaf(inner, p, { ...ctx, phase: animation.animation.phase ?? phase, elapsed });
  }

  let delay = 0;
  if (animation.type === 'kineticTypography') {
    if (!ctx.unit) return {};
    delay = (animation.each ?? DEFAULT_KINETIC_EACH) * ctx.unit.index;
  }
  const p = animationProgressAt(animation, window, ctx.frame, delay);
  const elapsed = Math.min(Math.max(0, ctx.frame - window.startFrame - delay), Math.max(0, window.endFrame - window.startFrame));
  return leaf(animation, p, { ...ctx, phase, elapsed });
}

export const nativeAnimationProvider: AnimationProvider = {
  id: 'native',
  deterministic: true,
  description: 'Reference implementation, zero dependencies. Default for editor preview and final render.',
  supports: (animation) => animation.type !== 'custom',
  evaluate: evaluateNative,
};
