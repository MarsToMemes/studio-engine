/**
 * Turns (layer, animation state) into a flat, framework-neutral style map.
 * Keys use React / CSSOM camelCase so a React renderer can pass it straight to
 * `style`, and any other renderer can map it trivially.
 */
import type { AnimationState, ClipState } from '../animation/state.js';
import { sampleKeyframes } from '../animation/interpolate.js';
import type { Effect } from '../model/effects.js';
import type { Crop, Layer } from '../model/layer.js';
import type { Rect } from '../core/layout.js';

export type StyleMap = Record<string, string | number>;

const r = (n: number, digits = 3) => Number(n.toFixed(digits));

export function clipToCss(clip: ClipState): string {
  switch (clip.kind) {
    case 'inset':
      return `inset(${r(clip.top)}% ${r(clip.right)}% ${r(clip.bottom)}% ${r(clip.left)}%)`;
    case 'circle':
      return `circle(${r(clip.radius)}% at ${r(clip.center.x * 100)}% ${r(clip.center.y * 100)}%)`;
    case 'polygon':
      return `polygon(${clip.points.map((p) => `${r(p.x)}% ${r(p.y)}%`).join(', ')})`;
  }
}

function cropToInset(crop: Crop, rect: Rect): Extract<ClipState, { kind: 'inset' }> {
  if (crop.units === 'percent') return { kind: 'inset', top: crop.top, right: crop.right, bottom: crop.bottom, left: crop.left };
  const w = rect.width || 1;
  const h = rect.height || 1;
  return { kind: 'inset', top: (crop.top / h) * 100, right: (crop.right / w) * 100, bottom: (crop.bottom / h) * 100, left: (crop.left / w) * 100 };
}

/** Crop and animated clip combine: two insets keep the larger inset per side; otherwise the animation wins. */
export function combineClip(crop: Crop | undefined, clip: ClipState | undefined, rect: Rect): ClipState | undefined {
  if (!crop) return clip;
  const c = cropToInset(crop, rect);
  if (!clip) return c;
  if (clip.kind !== 'inset') return clip;
  return { kind: 'inset', top: Math.max(c.top, clip.top), right: Math.max(c.right, clip.right), bottom: Math.max(c.bottom, clip.bottom), left: Math.max(c.left, clip.left) };
}

const CSS_FILTER_EFFECTS = new Set<Effect['type']>(['blur', 'brightness', 'contrast', 'saturate', 'grayscale', 'sepia', 'hueRotate', 'invert', 'dropShadow', 'glow']);

export function isCssFilterEffect(effect: Effect): boolean {
  return CSS_FILTER_EFFECTS.has(effect.type);
}

function param(effect: Effect, name: string, value: number, localFrame: number): number {
  const track = effect.animatedParams?.[name];
  return track && track.length > 0 ? sampleKeyframes(track, localFrame) : value;
}

/**
 * CSS `filter` for the effects that CSS can express. Effects that need a
 * shader or an overlay (grain, vignette, LUT, chromatic aberration…) are
 * returned by `getNonCssEffects` for renderer-specific implementations.
 */
export function effectsToCssFilter(effects: readonly Effect[], localFrame = 0): string {
  const parts: string[] = [];
  for (const e of effects) {
    if (e.enabled === false || !isCssFilterEffect(e)) continue;
    switch (e.type) {
      case 'blur':
        parts.push(`blur(${r(param(e, 'amount', e.amount, localFrame))}px)`);
        break;
      case 'hueRotate':
        parts.push(`hue-rotate(${r(param(e, 'amount', e.amount, localFrame))}deg)`);
        break;
      case 'brightness':
      case 'contrast':
      case 'saturate':
      case 'grayscale':
      case 'sepia':
      case 'invert':
        parts.push(`${e.type}(${r(param(e, 'amount', e.amount, localFrame))})`);
        break;
      case 'dropShadow':
        parts.push(`drop-shadow(${r(e.x)}px ${r(e.y)}px ${r(param(e, 'blur', e.blur, localFrame))}px ${e.color})`);
        break;
      case 'glow':
        parts.push(`drop-shadow(0px 0px ${r(param(e, 'radius', e.radius, localFrame))}px ${e.color})`);
        break;
      default:
        break;
    }
  }
  return parts.join(' ');
}

export function getNonCssEffects(effects: readonly Effect[]): Effect[] {
  return effects.filter((e) => e.enabled !== false && !isCssFilterEffect(e));
}

export function hasAnimatedEffects(effects: readonly Effect[]): boolean {
  return effects.some((e) => e.enabled !== false && e.animatedParams && Object.keys(e.animatedParams).length > 0);
}

/** `transform` string for an animation state applied on top of a static transform. */
export function composeTransform(state: Partial<AnimationState>, base: { scale?: Layer['scale']; rotation?: number; transform?: Layer['transform'] } = {}): string {
  const bs = base.scale ?? 1;
  const bsx = typeof bs === 'number' ? bs : bs.x;
  const bsy = typeof bs === 'number' ? bs : bs.y;
  const t = base.transform;
  const sx = bsx * (state.scaleX ?? 1) * (t?.flipX ? -1 : 1);
  const sy = bsy * (state.scaleY ?? 1) * (t?.flipY ? -1 : 1);
  const rot = (base.rotation ?? 0) + (state.rotation ?? 0);
  const skewX = (t?.skewX ?? 0) + (state.skewX ?? 0);
  const skewY = (t?.skewY ?? 0) + (state.skewY ?? 0);
  const parts: string[] = [];
  if (t?.perspective) parts.push(`perspective(${r(t.perspective)}px)`);
  if (state.x || state.y) parts.push(`translate(${r(state.x ?? 0)}px, ${r(state.y ?? 0)}px)`);
  if (t?.rotateX) parts.push(`rotateX(${r(t.rotateX)}deg)`);
  if (t?.rotateY) parts.push(`rotateY(${r(t.rotateY)}deg)`);
  if (rot) parts.push(`rotate(${r(rot)}deg)`);
  if (sx !== 1 || sy !== 1) parts.push(`scale(${r(sx, 4)}, ${r(sy, 4)})`);
  if (skewX || skewY) parts.push(`skew(${r(skewX)}deg, ${r(skewY)}deg)`);
  return parts.length ? parts.join(' ') : 'none';
}

function stateFilter(state: Partial<AnimationState>): string {
  const parts: string[] = [];
  if (state.blur && state.blur > 0) parts.push(`blur(${r(state.blur)}px)`);
  if (state.brightness !== undefined && state.brightness !== 1) parts.push(`brightness(${r(state.brightness)})`);
  if (state.saturation !== undefined && state.saturation !== 1) parts.push(`saturate(${r(state.saturation)})`);
  return parts.join(' ');
}

/** Style of a whole-frame container (scene camera, transition states). */
export function stateToStyle(state: Partial<AnimationState>): StyleMap {
  const style: StyleMap = { transform: composeTransform(state) };
  if (state.opacity !== undefined && state.opacity !== 1) style.opacity = r(Math.max(0, Math.min(1, state.opacity)), 4);
  const filter = stateFilter(state);
  if (filter) style.filter = filter;
  if (state.clip) style.clipPath = clipToCss(state.clip);
  if (state.origin) style.transformOrigin = `${r(state.origin.x * 100)}% ${r(state.origin.y * 100)}%`;
  return style;
}

export function buildLayerStyle(layer: Layer, rect: Rect, state: AnimationState, effectsFilter: string): StyleMap {
  const origin = state.origin ?? layer.transform?.origin;
  const style: StyleMap = {
    position: 'absolute',
    left: r(rect.x),
    top: r(rect.y),
    width: r(rect.width),
    height: r(rect.height),
    zIndex: layer.zIndex,
    opacity: r(Math.max(0, Math.min(1, layer.opacity * state.opacity)), 4),
    transform: composeTransform(state, layer),
  };
  if (origin) style.transformOrigin = `${r(origin.x * 100)}% ${r(origin.y * 100)}%`;
  const filter = [stateFilter(state), effectsFilter].filter(Boolean).join(' ');
  if (filter) style.filter = filter;
  const clip = combineClip(layer.crop, state.clip, rect);
  if (clip) style.clipPath = clipToCss(clip);
  if (layer.blendMode && layer.blendMode !== 'normal') style.mixBlendMode = layer.blendMode;
  return style;
}
