/**
 * Built-in transition definitions.
 *
 * Direction convention: `direction` is where the INCOMING scene travels to.
 * `slide` + `right` => the new scene enters from the left edge moving right.
 *
 * Where Remotion ships a presentation (fade, slide, wipe, flip, iris) the
 * definition maps to it. The `evaluate` functions of those types exist for
 * editor previews and for edge transitions played inside a single scene.
 */
import { hash01 } from '../animation/noise.js';
import type { Direction, Vec2 } from '../model/primitives.js';
import type { NormalizedTransition, RemotionMappingContext, RemotionPresentationSpec, RemotionShaderPresentation, TransitionDefinition, TransitionFrameState } from './types.js';

const VEC: Readonly<Record<Direction, Vec2>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const OPPOSITE: Readonly<Record<Direction, string>> = { right: 'left', left: 'right', down: 'top', up: 'bottom' };

/** Remotion expresses where the new scene comes FROM. */
export function toRemotionDirection(direction: Direction): string {
  return `from-${OPPOSITE[direction]}`;
}

/** Remotion shader presentation when HTML-in-Canvas is available, engine fallback otherwise. */
function shaderOr(name: RemotionShaderPresentation, fallback: string, props: RemotionPresentationSpec['props'], ctx: RemotionMappingContext, fallbackProps: RemotionPresentationSpec['props'] = {}): RemotionPresentationSpec {
  return ctx.capabilities.htmlInCanvas ? { kind: 'builtin', name, props, requires: 'htmlInCanvas' } : { kind: 'custom', name: fallback, props: fallbackProps };
}

const num = (t: NormalizedTransition, key: string): number | undefined => (typeof t.params[key] === 'number' ? (t.params[key] as number) : undefined);

const dir = (t: NormalizedTransition, fallback: Direction = 'right'): Direction => t.direction ?? fallback;
const bump = (p: number) => Math.sin(Math.PI * p);
const color = (t: NormalizedTransition, fallback: string) => (typeof t.params.color === 'string' ? t.params.color : fallback);

function crossfade(p: number): TransitionFrameState {
  return { exiting: {}, entering: { opacity: p } };
}

function insetFor(direction: Direction, hidden: number) {
  const inset = { kind: 'inset' as const, top: 0, right: 0, bottom: 0, left: 0 };
  // The visible region grows in the travel direction, so the hidden part sits on that side.
  if (direction === 'right') inset.right = hidden;
  else if (direction === 'left') inset.left = hidden;
  else if (direction === 'down') inset.bottom = hidden;
  else inset.top = hidden;
  return inset;
}

export const BUILT_IN_TRANSITIONS: readonly TransitionDefinition[] = [
  {
    type: 'cut',
    label: 'Cut',
    description: 'Hard cut, no overlap.',
    defaultDurationInSeconds: 0,
    defaultEasing: 'linear',
    directional: false,
    defaultIntensity: 1,
    evaluate: () => ({ exiting: { opacity: 0 }, entering: {} }),
  },
  {
    type: 'crossfade',
    label: 'Crossfade',
    description: 'Incoming scene fades in over the outgoing one.',
    defaultDurationInSeconds: 0.5,
    defaultEasing: 'linear',
    directional: false,
    defaultIntensity: 1,
    toRemotion: () => ({ kind: 'builtin', name: 'fade', props: {} }),
    evaluate: (_t, p) => crossfade(p),
  },
  {
    type: 'fade',
    label: 'Fade through color',
    description: 'Outgoing scene fades to a color (default black), then the incoming scene fades in.',
    defaultDurationInSeconds: 0.6,
    defaultEasing: 'easeInOut',
    directional: false,
    defaultIntensity: 1,
    defaultParams: { color: '#000000' },
    toRemotion: (t) => ({ kind: 'custom', name: 'fade', props: { color: color(t, '#000000') } }),
    evaluate: (t, p) => ({
      exiting: { opacity: p < 0.5 ? 1 : 0 },
      entering: { opacity: p < 0.5 ? 0 : 1 },
      overlay: { color: color(t, '#000000'), opacity: (1 - Math.abs(2 * p - 1)) * t.intensity },
    }),
  },
  {
    type: 'slide',
    label: 'Slide over',
    description: 'Incoming scene slides over the static outgoing scene.',
    defaultDurationInSeconds: 0.5,
    defaultEasing: 'easeInOutCubic',
    directional: true,
    defaultDirection: 'left',
    defaultIntensity: 1,
    toRemotion: (t) => ({ kind: 'custom', name: 'slide', props: { direction: dir(t, 'left') } }),
    evaluate: (t, p, { box }) => {
      const v = VEC[dir(t, 'left')];
      return { exiting: {}, entering: { x: -v.x * (1 - p) * box.width, y: -v.y * (1 - p) * box.height } };
    },
  },
  {
    type: 'push',
    label: 'Push',
    description: 'Incoming scene pushes the outgoing scene out of frame.',
    defaultDurationInSeconds: 0.5,
    defaultEasing: 'easeInOutCubic',
    directional: true,
    defaultDirection: 'left',
    defaultIntensity: 1,
    toRemotion: (t) => ({ kind: 'builtin', name: 'slide', props: { direction: toRemotionDirection(dir(t, 'left')) } }),
    evaluate: (t, p, { box }) => {
      const v = VEC[dir(t, 'left')];
      return {
        exiting: { x: v.x * p * box.width, y: v.y * p * box.height },
        entering: { x: -v.x * (1 - p) * box.width, y: -v.y * (1 - p) * box.height },
      };
    },
  },
  {
    type: 'wipe',
    label: 'Wipe',
    description: 'Hard edge wipe revealing the incoming scene.',
    defaultDurationInSeconds: 0.6,
    defaultEasing: 'easeInOutCubic',
    directional: true,
    defaultDirection: 'right',
    defaultIntensity: 1,
    toRemotion: (t) => ({ kind: 'builtin', name: 'wipe', props: { direction: toRemotionDirection(dir(t)) } }),
    evaluate: (t, p) => ({ exiting: {}, entering: { clip: insetFor(dir(t), (1 - p) * 100) } }),
  },
  {
    type: 'zoom',
    label: 'Zoom through',
    description: 'Outgoing scene zooms towards the camera while the incoming scene settles in.',
    defaultDurationInSeconds: 0.5,
    defaultEasing: 'easeInOutCubic',
    directional: false,
    defaultIntensity: 1,
    toRemotion: (_t, ctx) => shaderOr('zoomInOut', 'zoom', {}, ctx),
    evaluate: (t, p) => {
      const k = t.intensity;
      return {
        exiting: { scaleX: 1 + 0.5 * k * p, scaleY: 1 + 0.5 * k * p, opacity: 1 - p },
        entering: { scaleX: 1 - 0.15 * k * (1 - p), scaleY: 1 - 0.15 * k * (1 - p), opacity: p },
      };
    },
  },
  {
    type: 'zoomBlur',
    label: 'Zoom blur',
    description: 'Fast zoom with motion blur, peaking in the middle.',
    defaultDurationInSeconds: 0.4,
    defaultEasing: 'easeInOutQuad',
    directional: false,
    defaultIntensity: 1,
    toRemotion: (t, ctx) => shaderOr('zoomBlur', 'zoomBlur', num(t, 'rotation') !== undefined ? { rotation: num(t, 'rotation')! } : {}, ctx),
    evaluate: (t, p) => {
      const k = t.intensity;
      return {
        exiting: { scaleX: 1 + 0.3 * k * p, scaleY: 1 + 0.3 * k * p, blur: 20 * k * p, opacity: 1 - p },
        entering: { scaleX: 1 + 0.3 * k * (1 - p), scaleY: 1 + 0.3 * k * (1 - p), blur: 20 * k * (1 - p), opacity: p },
      };
    },
  },
  {
    type: 'whip',
    label: 'Whip pan',
    description: 'Very fast push with directional motion blur.',
    defaultDurationInSeconds: 0.3,
    defaultEasing: 'easeInOutCubic',
    directional: true,
    defaultDirection: 'left',
    defaultIntensity: 1,
    toRemotion: (t) => ({ kind: 'custom', name: 'whip', props: { direction: dir(t, 'left') } }),
    evaluate: (t, p, { box }) => {
      const v = VEC[dir(t, 'left')];
      const blur = 30 * t.intensity * bump(p);
      return {
        exiting: { x: v.x * p * box.width, y: v.y * p * box.height, blur },
        entering: { x: -v.x * (1 - p) * box.width, y: -v.y * (1 - p) * box.height, blur },
      };
    },
  },
  {
    type: 'filmBurn',
    label: 'Film burn',
    description: 'Warm light burst over a crossfade.',
    defaultDurationInSeconds: 0.8,
    defaultEasing: 'easeInOut',
    directional: false,
    defaultIntensity: 1,
    defaultParams: { color: '#ff8a3d' },
    toRemotion: (t, ctx) => shaderOr('filmBurn', 'filmBurn', num(t, 'seed') !== undefined ? { seed: num(t, 'seed')! } : {}, ctx, { color: color(t, '#ff8a3d') }),
    evaluate: (t, p) => {
      const b = bump(p) * t.intensity;
      return {
        exiting: { brightness: 1 + 0.8 * b },
        entering: { opacity: p, brightness: 1 + 0.8 * b },
        overlay: { color: color(t, '#ff8a3d'), opacity: b * 0.85, blendMode: 'screen', kind: 'burn' },
      };
    },
  },
  {
    type: 'ripple',
    label: 'Ripple',
    description: 'Liquid distortion. Falls back to a wobbly crossfade without shader support.',
    defaultDurationInSeconds: 0.8,
    defaultEasing: 'easeInOut',
    directional: false,
    defaultIntensity: 1,
    toRemotion: (t, ctx) =>
      shaderOr('ripple', 'ripple', { ...(num(t, 'amplitude') !== undefined ? { amplitude: num(t, 'amplitude')! } : {}), ...(num(t, 'speed') !== undefined ? { speed: num(t, 'speed')! } : {}) }, ctx),
    evaluate: (t, p) => {
      const s = 1 + 0.03 * t.intensity * Math.sin(4 * Math.PI * p) * (1 - p);
      return {
        exiting: {},
        entering: { opacity: p, scaleX: s, scaleY: s },
        distortion: { kind: 'ripple', amount: bump(p) * t.intensity, seed: 0 },
      };
    },
  },
  {
    type: 'glitch',
    label: 'Glitch',
    description: 'Digital glitch cut with RGB split and slice offsets.',
    defaultDurationInSeconds: 0.4,
    defaultEasing: 'linear',
    directional: false,
    defaultIntensity: 1,
    defaultParams: { seed: 7 },
    toRemotion: (t) => ({ kind: 'custom', name: 'glitch', props: { seed: typeof t.params.seed === 'number' ? t.params.seed : 7 } }),
    evaluate: (t, p) => {
      const seed = typeof t.params.seed === 'number' ? t.params.seed : 7;
      const slot = Math.floor(p * 20);
      const k = t.intensity * bump(p);
      const glitch = { offsetX: (hash01(seed, slot) - 0.5) * 40 * k, rgbSplit: 8 * k, sliceSeed: Math.floor(hash01(seed + 1, slot) * 1e6) };
      const showEntering = p >= 0.5;
      return {
        exiting: { opacity: showEntering ? 0 : 1, glitch },
        entering: { opacity: showEntering ? 1 : 0, glitch },
        distortion: { kind: 'glitch', amount: k, seed: glitch.sliceSeed },
      };
    },
  },
  {
    type: 'blur',
    label: 'Blur dissolve',
    description: 'Outgoing scene blurs out while the incoming scene comes into focus.',
    defaultDurationInSeconds: 0.5,
    defaultEasing: 'easeInOut',
    directional: false,
    defaultIntensity: 1,
    toRemotion: () => ({ kind: 'custom', name: 'blur', props: {} }),
    evaluate: (t, p) => ({
      exiting: { blur: 20 * t.intensity * p, opacity: 1 - p },
      entering: { blur: 20 * t.intensity * (1 - p), opacity: p },
    }),
  },
  {
    type: 'flash',
    label: 'Flash',
    description: 'White (or colored) flash hiding the cut.',
    defaultDurationInSeconds: 0.3,
    defaultEasing: 'linear',
    directional: false,
    defaultIntensity: 1,
    defaultParams: { color: '#ffffff' },
    toRemotion: (t) => ({ kind: 'custom', name: 'flash', props: { color: color(t, '#ffffff') } }),
    evaluate: (t, p) => ({
      exiting: { opacity: p < 0.5 ? 1 : 0 },
      entering: { opacity: p < 0.5 ? 0 : 1 },
      overlay: { color: color(t, '#ffffff'), opacity: (1 - Math.abs(2 * p - 1)) * t.intensity },
    }),
  },
  {
    type: 'flip',
    label: 'Flip',
    description: '3D card flip.',
    defaultDurationInSeconds: 0.6,
    defaultEasing: 'easeInOutCubic',
    directional: true,
    defaultDirection: 'left',
    defaultIntensity: 1,
    toRemotion: (t) => ({ kind: 'builtin', name: 'flip', props: { direction: toRemotionDirection(dir(t, 'left')) } }),
    // 2D preview approximation (scaleX). The Remotion render uses the real 3D flip.
    evaluate: (_t, p) => ({
      exiting: { scaleX: p < 0.5 ? 1 - 2 * p : 0, opacity: p < 0.5 ? 1 : 0 },
      entering: { scaleX: p < 0.5 ? 0 : 2 * p - 1, opacity: p < 0.5 ? 0 : 1 },
      top: p < 0.5 ? 'exiting' : 'entering',
    }),
  },
  {
    type: 'iris',
    label: 'Iris',
    description: 'Circular reveal from the center.',
    defaultDurationInSeconds: 0.7,
    defaultEasing: 'easeInOutCubic',
    directional: false,
    defaultIntensity: 1,
    toRemotion: (_t, { box }) => ({ kind: 'builtin', name: 'iris', props: { width: box.width, height: box.height } }),
    evaluate: (_t, p) => ({ exiting: {}, entering: { clip: { kind: 'circle', radius: p * 71, center: { x: 0.5, y: 0.5 } } } }),
  },
];
