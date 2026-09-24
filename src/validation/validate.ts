/**
 * Runtime validation of projects and scenes.
 *
 * Input is `unknown` on purpose: scenes come from the editor, from saved JSON
 * and from AI agents, so nothing is trusted. Validation is in two layers:
 * - structural: types, ranges, enums (would crash or corrupt the render)
 * - semantic: references, timing coherence, scene-type contracts
 *
 * Errors make the project unrenderable. Warnings flag things that render but
 * are probably mistakes (a layer that is never visible, a clipped voiceover…).
 */
import { AnimationProviderRegistry } from '../animation/providers/registry.js';
import { parseAspectRatio, matchesAspectRatio } from '../core/aspectRatio.js';
import { defaultSceneTypeRegistry, type SceneTypeRegistry } from '../core/sceneTypes.js';
import type { Animation } from '../model/animation.js';
import type { AssetKind, AssetRegistry } from '../model/assets.js';
import {
  ANCHORS,
  ANIMATABLE_PROPERTIES,
  ANIMATION_PHASES,
  ANIMATION_TYPES,
  ASSET_KINDS,
  AUDIO_ROLES,
  BLEND_MODES,
  CAMERA_MOVES,
  DIRECTIONS,
  EASING_PRESET_NAMES,
  EFFECT_TYPES,
  FITS,
  GRAPHIC_KINDS,
  KINETIC_STYLES,
  LAYER_TYPES,
  MASK_SHAPES,
  OVERLAY_KINDS,
  SHAPE_KINDS,
  TEXT_SPLITS,
  UNITS,
} from '../model/constants.js';
import type { Layer } from '../model/layer.js';
import type { Scene, VideoProject } from '../model/scene.js';
import { SCHEMA_VERSION } from '../core/factories.js';
import { getSceneStartFrames, getTransitionBetween, getTransitionOverlap } from '../timing/timeline.js';
import { defaultTransitionRegistry, type TransitionRegistry } from '../transitions/registry.js';
import { isFiniteNumber, isInteger, isNonEmptyString, isNonNegativeInteger, isObject, isOneOf, isPositiveInteger, isString } from './guards.js';
import { IssueCollector, SceneValidationError, type ValidationResult } from './issues.js';

export interface ValidationOptions {
  sceneTypes?: SceneTypeRegistry;
  transitions?: TransitionRegistry;
  /** When given, animation `provider` ids are checked against it. */
  providers?: AnimationProviderRegistry;
  /** Max fps accepted. Defaults to 240. */
  maxFps?: number;
}

interface Ctx {
  issues: IssueCollector;
  opts: Required<Pick<ValidationOptions, 'sceneTypes' | 'transitions'>> & ValidationOptions;
  fps: number;
  assets?: AssetRegistry;
}

const MEDIA_KINDS: Record<'video' | 'image' | 'audio' | 'lottie', readonly AssetKind[]> = {
  video: ['video'],
  image: ['image', 'svg'],
  audio: ['audio', 'video'],
  lottie: ['lottie', 'dotlottie', 'json'],
};

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function checkFrameField(ctx: Ctx, obj: Record<string, unknown>, key: string, path: string, opts: { required?: boolean; positive?: boolean } = {}): boolean {
  const v = obj[key];
  if (v === undefined) {
    if (opts.required) ctx.issues.error(`${path}.${key}`, 'frame.required', `${key} is required`);
    return !opts.required;
  }
  const ok = opts.positive ? isPositiveInteger(v) : isNonNegativeInteger(v);
  if (!ok) ctx.issues.error(`${path}.${key}`, 'frame.invalid', `${key} must be ${opts.positive ? 'a positive' : 'a non-negative'} integer number of frames (got ${JSON.stringify(v)})`);
  return ok;
}

function checkEnum(ctx: Ctx, value: unknown, values: readonly string[], path: string, code: string, required = true): boolean {
  if (value === undefined && !required) return true;
  if (!isOneOf(value, values)) {
    ctx.issues.error(path, code, `expected one of ${values.join(', ')} (got ${JSON.stringify(value)})`);
    return false;
  }
  return true;
}

function checkEasing(ctx: Ctx, easing: unknown, path: string): void {
  if (easing === undefined) return;
  if (isString(easing)) {
    checkEnum(ctx, easing, EASING_PRESET_NAMES, path, 'easing.unknown');
    return;
  }
  if (!isObject(easing)) {
    ctx.issues.error(path, 'easing.invalid', 'easing must be a preset name or an easing object');
    return;
  }
  switch (easing.type) {
    case 'cubicBezier': {
      const p = easing.points;
      if (!Array.isArray(p) || p.length !== 4 || !p.every(isFiniteNumber)) ctx.issues.error(`${path}.points`, 'easing.bezier.invalid', 'points must be 4 numbers');
      else if (p[0]! < 0 || p[0]! > 1 || p[2]! < 0 || p[2]! > 1) ctx.issues.error(`${path}.points`, 'easing.bezier.range', 'x1 and x2 must be in [0, 1]');
      break;
    }
    case 'spring':
      for (const k of ['mass', 'stiffness', 'damping'] as const) {
        if (easing[k] !== undefined && !(isFiniteNumber(easing[k]) && (easing[k] as number) > 0)) ctx.issues.error(`${path}.${k}`, 'easing.spring.invalid', `${k} must be > 0`);
      }
      break;
    case 'steps':
      if (!isPositiveInteger(easing.steps)) ctx.issues.error(`${path}.steps`, 'easing.steps.invalid', 'steps must be a positive integer');
      break;
    default:
      ctx.issues.error(`${path}.type`, 'easing.unknown', `unknown easing type ${JSON.stringify(easing.type)}`);
  }
}

function checkAssetRef(ctx: Ctx, assetId: unknown, path: string, kinds?: readonly AssetKind[]): void {
  if (!isNonEmptyString(assetId)) {
    ctx.issues.error(path, 'asset.id.invalid', 'assetId must be a non-empty string');
    return;
  }
  if (!ctx.assets) return;
  const asset = ctx.assets[assetId];
  if (!asset) {
    ctx.issues.error(path, 'asset.missing', `asset "${assetId}" is not in the project asset registry`);
    return;
  }
  if (kinds && !kinds.includes(asset.kind)) ctx.issues.error(path, 'asset.kind.mismatch', `asset "${assetId}" is a ${asset.kind}, expected ${kinds.join(' or ')}`);
}

function checkBackground(ctx: Ctx, bg: unknown, path: string): void {
  if (!isObject(bg)) {
    ctx.issues.error(path, 'background.invalid', 'background must be an object');
    return;
  }
  switch (bg.type) {
    case 'none':
      break;
    case 'color':
      if (!isNonEmptyString(bg.color)) ctx.issues.error(`${path}.color`, 'background.color.invalid', 'color must be a CSS color string');
      break;
    case 'gradient':
      checkGradient(ctx, bg.gradient, `${path}.gradient`);
      break;
    case 'image':
    case 'video':
      checkAssetRef(ctx, bg.assetId, `${path}.assetId`, MEDIA_KINDS[bg.type]);
      checkEnum(ctx, bg.fit, FITS, `${path}.fit`, 'background.fit.invalid', false);
      break;
    default:
      ctx.issues.error(`${path}.type`, 'background.type.unknown', `unknown background type ${JSON.stringify(bg.type)}`);
  }
}

function checkGradient(ctx: Ctx, g: unknown, path: string): void {
  if (!isObject(g) || !isOneOf(g.kind, ['linear', 'radial', 'conic'] as const) || !Array.isArray(g.stops) || g.stops.length < 2) {
    ctx.issues.error(path, 'gradient.invalid', 'gradient needs a kind (linear|radial|conic) and at least 2 stops');
    return;
  }
  g.stops.forEach((s, i) => {
    if (!isObject(s) || !isNonEmptyString(s.color) || !isFiniteNumber(s.offset) || s.offset < 0 || s.offset > 1) {
      ctx.issues.error(`${path}.stops[${i}]`, 'gradient.stop.invalid', 'stop needs a color and an offset in [0, 1]');
    }
  });
}

// ---------------------------------------------------------------------------
// Animations & effects
// ---------------------------------------------------------------------------

function checkAnimation(ctx: Ctx, a: unknown, path: string, ownerDuration: number | undefined, nested = false): void {
  if (!isObject(a)) {
    ctx.issues.error(path, 'animation.invalid', 'animation must be an object');
    return;
  }
  if (!checkEnum(ctx, a.type, ANIMATION_TYPES, `${path}.type`, 'animation.type.unknown')) return;
  checkEnum(ctx, a.phase, ANIMATION_PHASES, `${path}.phase`, 'animation.phase.invalid', false);
  checkFrameField(ctx, a, 'startFrame', path);
  checkFrameField(ctx, a, 'durationInFrames', path);
  checkEasing(ctx, a.easing, `${path}.easing`);
  if (a.repeat !== undefined && !isNonNegativeInteger(a.repeat)) ctx.issues.error(`${path}.repeat`, 'animation.repeat.invalid', 'repeat must be a non-negative integer (use loop: true to loop)');

  if (ownerDuration !== undefined && isNonNegativeInteger(a.startFrame) && a.startFrame >= ownerDuration) {
    ctx.issues.warn(`${path}.startFrame`, 'animation.window.outside', `animation starts at frame ${a.startFrame}, after its owner ends (${ownerDuration})`);
  }

  if (isString(a.provider) && ctx.opts.providers) {
    const p = ctx.opts.providers.get(a.provider);
    if (!p) ctx.issues.warn(`${path}.provider`, 'animation.provider.unknown', `provider "${a.provider}" is not registered; the default provider will be used`);
    else if (!p.deterministic) ctx.issues.warn(`${path}.provider`, 'animation.provider.nondeterministic', `provider "${a.provider}" is preview-only; the final render falls back to the default provider`);
  }

  const type = a.type as Animation['type'];
  switch (type) {
    case 'slide':
    case 'reveal':
    case 'parallax':
      checkEnum(ctx, a.direction, DIRECTIONS, `${path}.direction`, 'animation.direction.invalid');
      if (type === 'slide') checkEnum(ctx, a.units, UNITS, `${path}.units`, 'animation.units.invalid', false);
      if (type === 'parallax' && !isFiniteNumber(a.depth)) ctx.issues.error(`${path}.depth`, 'animation.parallax.depth', 'depth must be a number');
      break;
    case 'spring':
      checkEnum(ctx, a.property, ANIMATABLE_PROPERTIES, `${path}.property`, 'animation.property.invalid');
      if (!isFiniteNumber(a.from) || !isFiniteNumber(a.to)) ctx.issues.error(path, 'animation.spring.range', 'spring needs numeric from and to');
      break;
    case 'stagger':
      if (nested) ctx.issues.error(path, 'animation.stagger.nested', 'stagger cannot contain another stagger');
      if (!isNonNegativeInteger(a.each)) ctx.issues.error(`${path}.each`, 'animation.stagger.each', 'each must be a non-negative integer');
      checkEnum(ctx, a.unit, TEXT_SPLITS, `${path}.unit`, 'animation.split.invalid', false);
      checkAnimation(ctx, a.animation, `${path}.animation`, undefined, true);
      break;
    case 'typewriter':
      if (a.charactersPerSecond !== undefined && !(isFiniteNumber(a.charactersPerSecond) && a.charactersPerSecond > 0)) {
        ctx.issues.error(`${path}.charactersPerSecond`, 'animation.typewriter.speed', 'charactersPerSecond must be > 0');
      }
      break;
    case 'kineticTypography':
      checkEnum(ctx, a.style, KINETIC_STYLES, `${path}.style`, 'animation.kinetic.style');
      checkEnum(ctx, a.split, TEXT_SPLITS, `${path}.split`, 'animation.split.invalid');
      break;
    case 'camera':
      checkEnum(ctx, a.move, CAMERA_MOVES, `${path}.move`, 'animation.camera.move');
      break;
    case 'maskReveal':
      checkEnum(ctx, a.shape, MASK_SHAPES, `${path}.shape`, 'animation.mask.shape');
      checkEnum(ctx, a.direction, DIRECTIONS, `${path}.direction`, 'animation.direction.invalid', false);
      break;
    case 'keyframes':
      if (!Array.isArray(a.tracks) || a.tracks.length === 0) {
        ctx.issues.error(`${path}.tracks`, 'animation.keyframes.empty', 'keyframes animation needs at least one track');
        break;
      }
      a.tracks.forEach((track, ti) => {
        const tp = `${path}.tracks[${ti}]`;
        if (!isObject(track)) return ctx.issues.error(tp, 'animation.track.invalid', 'track must be an object');
        checkEnum(ctx, track.property, ANIMATABLE_PROPERTIES, `${tp}.property`, 'animation.property.invalid');
        if (!Array.isArray(track.keyframes) || track.keyframes.length === 0) return ctx.issues.error(`${tp}.keyframes`, 'animation.keyframes.empty', 'track needs at least one keyframe');
        let prev = -1;
        track.keyframes.forEach((k, ki) => {
          const kp = `${tp}.keyframes[${ki}]`;
          if (!isObject(k) || !isNonNegativeInteger(k.frame) || !isFiniteNumber(k.value)) return ctx.issues.error(kp, 'animation.keyframe.invalid', 'keyframe needs an integer frame >= 0 and a numeric value');
          if (k.frame <= prev) ctx.issues.error(`${kp}.frame`, 'animation.keyframe.order', 'keyframes must be sorted by strictly increasing frame');
          prev = k.frame;
          checkEasing(ctx, k.easing, `${kp}.easing`);
        });
      });
      break;
    case 'custom':
      if (!isNonEmptyString(a.name)) ctx.issues.error(`${path}.name`, 'animation.custom.name', 'custom animations need a name');
      if (!isString(a.provider)) ctx.issues.warn(`${path}.provider`, 'animation.custom.provider', 'custom animations need a provider; without one they have no effect');
      break;
    default:
      break;
  }
}

function checkAnimations(ctx: Ctx, list: unknown, path: string, ownerDuration: number | undefined): void {
  if (list === undefined) return;
  if (!Array.isArray(list)) return ctx.issues.error(path, 'animations.invalid', 'animations must be an array');
  list.forEach((a, i) => checkAnimation(ctx, a, `${path}[${i}]`, ownerDuration));
}

function checkEffects(ctx: Ctx, list: unknown, path: string): void {
  if (list === undefined) return;
  if (!Array.isArray(list)) return ctx.issues.error(path, 'effects.invalid', 'effects must be an array');
  list.forEach((e, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(e)) return ctx.issues.error(p, 'effect.invalid', 'effect must be an object');
    if (!checkEnum(ctx, e.type, EFFECT_TYPES, `${p}.type`, 'effect.type.unknown')) return;
    if (e.type === 'lut') checkAssetRef(ctx, e.assetId, `${p}.assetId`, ['image', 'json']);
    if (['blur', 'brightness', 'contrast', 'saturate', 'grayscale', 'sepia', 'hueRotate', 'invert', 'pixelate'].includes(e.type as string) && !isFiniteNumber(e.amount)) {
      ctx.issues.error(`${p}.amount`, 'effect.amount.invalid', 'amount must be a number');
    }
  });
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

function checkTransition(ctx: Ctx, t: unknown, path: string): boolean {
  if (t === undefined) return true;
  if (!isObject(t)) {
    ctx.issues.error(path, 'transition.invalid', 'transition must be an object');
    return false;
  }
  if (!isNonEmptyString(t.type) || !ctx.opts.transitions.has(t.type)) {
    ctx.issues.error(`${path}.type`, 'transition.type.unknown', `unknown transition type ${JSON.stringify(t.type)}`);
    return false;
  }
  const ok = checkFrameField(ctx, t, 'durationInFrames', path, { required: true });
  if (t.type === 'cut' && isPositiveInteger(t.durationInFrames)) ctx.issues.warn(`${path}.durationInFrames`, 'transition.cut.duration', 'a cut has no duration; the value is ignored');
  if (t.type !== 'cut' && t.durationInFrames === 0) ctx.issues.warn(`${path}.durationInFrames`, 'transition.zero', 'a 0-frame transition behaves like a cut');
  checkEnum(ctx, t.direction, DIRECTIONS, `${path}.direction`, 'transition.direction.invalid', false);
  checkEasing(ctx, t.easing, `${path}.easing`);
  if (t.intensity !== undefined && !(isFiniteNumber(t.intensity) && t.intensity >= 0)) ctx.issues.error(`${path}.intensity`, 'transition.intensity.invalid', 'intensity must be >= 0');
  if (t.params !== undefined && !isObject(t.params)) ctx.issues.error(`${path}.params`, 'transition.params.invalid', 'params must be an object');
  return ok;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

function checkLayer(ctx: Ctx, l: unknown, path: string, sceneDuration: number | undefined, captionTrackId: string | undefined): void {
  if (!isObject(l)) return ctx.issues.error(path, 'layer.invalid', 'layer must be an object');
  if (!isNonEmptyString(l.id)) ctx.issues.error(`${path}.id`, 'layer.id.invalid', 'layer id must be a non-empty string');
  if (!checkEnum(ctx, l.type, LAYER_TYPES, `${path}.type`, 'layer.type.unknown')) return;
  if (!isFiniteNumber(l.zIndex)) ctx.issues.error(`${path}.zIndex`, 'layer.zIndex.invalid', 'zIndex must be a number');

  const startOk = checkFrameField(ctx, l, 'startFrame', path);
  const durOk = checkFrameField(ctx, l, 'durationInFrames', path, { positive: true });
  const start = startOk && isInteger(l.startFrame) ? l.startFrame : 0;
  if (sceneDuration !== undefined) {
    if (start >= sceneDuration) ctx.issues.warn(`${path}.startFrame`, 'layer.never.visible', `layer starts at ${start}, after the scene ends (${sceneDuration})`);
    else if (durOk && isInteger(l.durationInFrames) && start + l.durationInFrames > sceneDuration) {
      ctx.issues.warn(`${path}.durationInFrames`, 'layer.clipped', `layer ends at ${start + l.durationInFrames}, after the scene ends (${sceneDuration}); it will be clipped`);
    }
  }

  // Position & transform
  const pos = l.position;
  if (!isObject(pos)) ctx.issues.error(`${path}.position`, 'layer.position.invalid', 'position must be a layer box object');
  else {
    checkEnum(ctx, pos.anchor, ANCHORS, `${path}.position.anchor`, 'layer.anchor.invalid');
    checkEnum(ctx, pos.units, UNITS, `${path}.position.units`, 'layer.units.invalid');
    if (!isFiniteNumber(pos.x) || !isFiniteNumber(pos.y)) ctx.issues.error(`${path}.position`, 'layer.position.xy', 'position.x and position.y must be numbers');
    for (const k of ['width', 'height'] as const) {
      if (pos[k] !== undefined && !(isFiniteNumber(pos[k]) && (pos[k] as number) > 0)) ctx.issues.error(`${path}.position.${k}`, 'layer.size.invalid', `${k} must be > 0`);
    }
  }
  const scale = l.scale;
  const scaleOk = isFiniteNumber(scale) || (isObject(scale) && isFiniteNumber(scale.x) && isFiniteNumber(scale.y));
  if (!scaleOk) ctx.issues.error(`${path}.scale`, 'layer.scale.invalid', 'scale must be a number or { x, y }');
  if (!isFiniteNumber(l.rotation)) ctx.issues.error(`${path}.rotation`, 'layer.rotation.invalid', 'rotation must be a number (degrees)');
  if (!isFiniteNumber(l.opacity) || l.opacity < 0 || l.opacity > 1) ctx.issues.error(`${path}.opacity`, 'layer.opacity.invalid', 'opacity must be in [0, 1]');
  if (l.opacity === 0 && Array.isArray(l.animations) && l.animations.length === 0) ctx.issues.warn(`${path}.opacity`, 'layer.invisible', 'layer has opacity 0 and no animation');
  checkEnum(ctx, l.blendMode, BLEND_MODES, `${path}.blendMode`, 'layer.blendMode.invalid', false);

  if (l.crop !== undefined) {
    const c = l.crop;
    if (!isObject(c) || !['top', 'right', 'bottom', 'left'].every((k) => isFiniteNumber(c[k]) && (c[k] as number) >= 0) || !isOneOf(c.units, UNITS)) {
      ctx.issues.error(`${path}.crop`, 'layer.crop.invalid', 'crop needs non-negative top/right/bottom/left and units');
    } else if (c.units === 'percent' && ((c.left as number) + (c.right as number) >= 100 || (c.top as number) + (c.bottom as number) >= 100)) {
      ctx.issues.error(`${path}.crop`, 'layer.crop.empty', 'crop removes the whole layer');
    }
  }
  if (l.mask !== undefined) {
    const m = l.mask;
    if (!isObject(m)) ctx.issues.error(`${path}.mask`, 'layer.mask.invalid', 'mask must be an object');
    else if (m.type === 'asset') checkAssetRef(ctx, m.assetId, `${path}.mask.assetId`, ['image', 'svg', 'video']);
    else if (m.type === 'gradient') checkGradient(ctx, m.gradient, `${path}.mask.gradient`);
    else if (m.type === 'polygon' && (!Array.isArray(m.points) || m.points.length < 3)) ctx.issues.error(`${path}.mask.points`, 'layer.mask.polygon', 'polygon mask needs at least 3 points');
    else if (!['shape', 'polygon', 'gradient', 'asset'].includes(m.type as string)) ctx.issues.error(`${path}.mask.type`, 'layer.mask.type', `unknown mask type ${JSON.stringify(m.type)}`);
  }

  const layerDuration = sceneDuration === undefined ? undefined : isPositiveInteger(l.durationInFrames) ? Math.min(l.durationInFrames, Math.max(0, sceneDuration - start)) : Math.max(0, sceneDuration - start);
  if (!Array.isArray(l.animations)) ctx.issues.error(`${path}.animations`, 'animations.invalid', 'animations must be an array');
  else checkAnimations(ctx, l.animations, `${path}.animations`, layerDuration);
  if (!Array.isArray(l.effects)) ctx.issues.error(`${path}.effects`, 'effects.invalid', 'effects must be an array');
  else checkEffects(ctx, l.effects, `${path}.effects`);

  // Type specific payloads
  const type = l.type as Layer['type'];
  switch (type) {
    case 'background':
      checkBackground(ctx, l.background, `${path}.background`);
      break;
    case 'video':
    case 'image':
      checkAssetRef(ctx, l.assetId, `${path}.assetId`, MEDIA_KINDS[type]);
      checkEnum(ctx, l.fit, FITS, `${path}.fit`, 'layer.fit.invalid');
      if (type === 'video') {
        if (l.playbackRate !== undefined && !(isFiniteNumber(l.playbackRate) && l.playbackRate > 0)) ctx.issues.error(`${path}.playbackRate`, 'layer.playbackRate.invalid', 'playbackRate must be > 0');
        if (l.volume !== undefined && !(isFiniteNumber(l.volume) && l.volume >= 0 && l.volume <= 1)) ctx.issues.error(`${path}.volume`, 'layer.volume.invalid', 'volume must be in [0, 1]');
      }
      break;
    case 'text':
      if (!isString(l.text)) ctx.issues.error(`${path}.text`, 'layer.text.invalid', 'text must be a string');
      else if (l.text.trim() === '') ctx.issues.warn(`${path}.text`, 'layer.text.empty', 'text layer is empty');
      if (!isObject(l.style)) ctx.issues.error(`${path}.style`, 'layer.style.invalid', 'style must be an object');
      break;
    case 'caption':
      if (!isObject(l.style) || !isOneOf(l.style.mode, ['word', 'line', 'block'] as const) || !isObject(l.style.text)) {
        ctx.issues.error(`${path}.style`, 'layer.caption.style', 'caption style needs a text style and a mode (word|line|block)');
      }
      if (l.trackId !== undefined && l.trackId !== captionTrackId) ctx.issues.error(`${path}.trackId`, 'layer.caption.track', `caption track "${String(l.trackId)}" does not exist in this scene`);
      else if (captionTrackId === undefined) ctx.issues.warn(path, 'layer.caption.noTrack', 'caption layer but the scene has no caption track');
      break;
    case 'shape':
      checkEnum(ctx, l.shape, SHAPE_KINDS, `${path}.shape`, 'layer.shape.invalid');
      if (l.shape === 'path' && !isNonEmptyString(l.path)) ctx.issues.error(`${path}.path`, 'layer.shape.path', 'path shapes need SVG path data');
      if ((l.shape === 'polygon' || l.shape === 'line') && (!Array.isArray(l.points) || l.points.length < 2)) ctx.issues.error(`${path}.points`, 'layer.shape.points', `${String(l.shape)} shapes need points`);
      break;
    case 'lottie': {
      const s = l.source;
      if (!isObject(s)) ctx.issues.error(`${path}.source`, 'layer.lottie.source', 'lottie source must be an object');
      else if (s.kind === 'asset') checkAssetRef(ctx, s.assetId, `${path}.source.assetId`, MEDIA_KINDS.lottie);
      else if (s.kind === 'url') {
        if (!isNonEmptyString(s.url)) ctx.issues.error(`${path}.source.url`, 'layer.lottie.url', 'url is required');
        checkEnum(ctx, s.format, ['json', 'dotlottie'], `${path}.source.format`, 'layer.lottie.format');
      } else if (s.kind === 'inline') {
        if (!isObject(s.data)) ctx.issues.error(`${path}.source.data`, 'layer.lottie.data', 'inline lottie data must be an object');
      } else ctx.issues.error(`${path}.source.kind`, 'layer.lottie.source', 'source.kind must be asset, url or inline');
      if (l.playbackRate !== undefined && !(isFiniteNumber(l.playbackRate) && l.playbackRate > 0)) ctx.issues.error(`${path}.playbackRate`, 'layer.playbackRate.invalid', 'playbackRate must be > 0');
      if (isFiniteNumber(l.lottieStartFrame) && isFiniteNumber(l.lottieEndFrame) && l.lottieStartFrame > l.lottieEndFrame) {
        ctx.issues.error(`${path}.lottieEndFrame`, 'layer.lottie.range', 'lottieEndFrame must be >= lottieStartFrame');
      }
      checkEnum(ctx, l.direction, ['forward', 'reverse'], `${path}.direction`, 'layer.lottie.direction', false);
      break;
    }
    case 'graphic':
      checkEnum(ctx, l.kind, GRAPHIC_KINDS, `${path}.kind`, 'layer.graphic.kind');
      if (!isObject(l.data)) ctx.issues.error(`${path}.data`, 'layer.graphic.data', 'graphic data must be an object');
      break;
    case 'overlay':
      checkEnum(ctx, l.kind, OVERLAY_KINDS, `${path}.kind`, 'layer.overlay.kind');
      if (l.kind === 'asset' || l.kind === 'texture' || l.kind === 'lightLeak') {
        if (l.assetId !== undefined || l.kind === 'asset') checkAssetRef(ctx, l.assetId, `${path}.assetId`, ['image', 'video']);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Audio & captions
// ---------------------------------------------------------------------------

function checkAudioTrack(ctx: Ctx, t: unknown, path: string, ownerDuration: number | undefined): void {
  if (!isObject(t)) return ctx.issues.error(path, 'audio.invalid', 'audio track must be an object');
  if (!isNonEmptyString(t.id)) ctx.issues.error(`${path}.id`, 'audio.id.invalid', 'audio id must be a non-empty string');
  checkAssetRef(ctx, t.assetId, `${path}.assetId`, MEDIA_KINDS.audio);
  checkEnum(ctx, t.role, AUDIO_ROLES, `${path}.role`, 'audio.role.invalid');
  checkFrameField(ctx, t, 'startFrame', path);
  checkFrameField(ctx, t, 'durationInFrames', path, { positive: true });
  checkFrameField(ctx, t, 'fadeInFrames', path);
  checkFrameField(ctx, t, 'fadeOutFrames', path);
  if (t.volume !== undefined && !(isFiniteNumber(t.volume) && t.volume >= 0 && t.volume <= 1)) ctx.issues.error(`${path}.volume`, 'audio.volume.invalid', 'volume must be in [0, 1]');
  if (ownerDuration !== undefined && isNonNegativeInteger(t.startFrame) && t.startFrame >= ownerDuration) ctx.issues.warn(`${path}.startFrame`, 'audio.never.plays', 'audio starts after its owner ends');
}

function checkVoiceover(ctx: Ctx, v: unknown, path: string, sceneDuration: number | undefined): void {
  if (v === undefined) return;
  if (!isObject(v)) return ctx.issues.error(path, 'voiceover.invalid', 'voiceover must be an object');
  if (!isNonEmptyString(v.id)) ctx.issues.error(`${path}.id`, 'voiceover.id.invalid', 'voiceover id must be a non-empty string');
  checkAssetRef(ctx, v.assetId, `${path}.assetId`, MEDIA_KINDS.audio);
  checkFrameField(ctx, v, 'startFrame', path);
  const ok = checkFrameField(ctx, v, 'durationInFrames', path, { required: true, positive: true });
  if (ok && sceneDuration !== undefined) {
    const end = (isNonNegativeInteger(v.startFrame) ? v.startFrame : 0) + (v.durationInFrames as number);
    if (end > sceneDuration) ctx.issues.warn(`${path}.durationInFrames`, 'voiceover.clipped', `voiceover ends at ${end}, after the scene ends (${sceneDuration}); narration will be cut`);
  }
}

function checkCaptions(ctx: Ctx, c: unknown, path: string, sceneDuration: number | undefined): string | undefined {
  if (c === undefined) return undefined;
  if (!isObject(c) || !isNonEmptyString(c.id) || !Array.isArray(c.cues)) {
    ctx.issues.error(path, 'captions.invalid', 'captions need an id and a cues array');
    return undefined;
  }
  const ids = new Set<string>();
  let prevStart = -1;
  c.cues.forEach((cue, i) => {
    const p = `${path}.cues[${i}]`;
    if (!isObject(cue) || !isNonEmptyString(cue.id) || !isString(cue.text) || !isNonNegativeInteger(cue.startFrame) || !isNonNegativeInteger(cue.endFrame)) {
      return ctx.issues.error(p, 'caption.cue.invalid', 'cue needs id, text, startFrame and endFrame (integers)');
    }
    if (ids.has(cue.id)) ctx.issues.error(`${p}.id`, 'caption.cue.duplicate', `duplicate cue id "${cue.id}"`);
    ids.add(cue.id);
    if (cue.endFrame <= cue.startFrame) ctx.issues.error(p, 'caption.cue.empty', 'endFrame must be > startFrame');
    if (cue.startFrame < prevStart) ctx.issues.error(`${p}.startFrame`, 'caption.cue.order', 'cues must be sorted by startFrame');
    prevStart = cue.startFrame;
    if (sceneDuration !== undefined && cue.endFrame > sceneDuration) ctx.issues.warn(p, 'caption.cue.outside', 'cue ends after the scene ends');
    if (Array.isArray(cue.words)) {
      cue.words.forEach((w, wi) => {
        if (!isObject(w) || !isNonNegativeInteger(w.startFrame) || !isNonNegativeInteger(w.endFrame) || !isString(w.text)) {
          return ctx.issues.error(`${p}.words[${wi}]`, 'caption.word.invalid', 'word needs text, startFrame and endFrame');
        }
        if (w.startFrame < (cue.startFrame as number) || w.endFrame > (cue.endFrame as number)) ctx.issues.warn(`${p}.words[${wi}]`, 'caption.word.outside', 'word timing is outside its cue');
      });
    }
  });
  return c.id;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function checkScene(ctx: Ctx, s: unknown, path: string): s is Scene {
  if (!isObject(s)) {
    ctx.issues.error(path, 'scene.invalid', 'scene must be an object');
    return false;
  }
  if (!isNonEmptyString(s.id)) ctx.issues.error(`${path}.id`, 'scene.id.invalid', 'scene id must be a non-empty string');
  let typeDef = undefined as ReturnType<SceneTypeRegistry['get']>;
  if (!isNonEmptyString(s.type)) ctx.issues.error(`${path}.type`, 'scene.type.invalid', 'scene type must be a string');
  else {
    typeDef = ctx.opts.sceneTypes.get(s.type);
    if (!typeDef) ctx.issues.error(`${path}.type`, 'scene.type.unknown', `scene type "${s.type}" is not registered`);
  }
  const durOk = checkFrameField(ctx, s, 'durationInFrames', path, { required: true, positive: true });
  const duration = durOk ? (s.durationInFrames as number) : undefined;
  checkFrameField(ctx, s, 'startFrame', path);
  if (s.fps !== undefined && s.fps !== ctx.fps) ctx.issues.error(`${path}.fps`, 'scene.fps.mismatch', `scene fps ${String(s.fps)} differs from project fps ${ctx.fps}`);
  if (s.aspectRatio !== undefined && (!isString(s.aspectRatio) || !parseAspectRatio(s.aspectRatio))) ctx.issues.error(`${path}.aspectRatio`, 'scene.aspectRatio.invalid', 'invalid aspect ratio');

  checkBackground(ctx, s.background, `${path}.background`);
  const captionTrackId = checkCaptions(ctx, s.captions, `${path}.captions`, duration);

  if (!Array.isArray(s.layers)) ctx.issues.error(`${path}.layers`, 'scene.layers.invalid', 'layers must be an array');
  else {
    const ids = new Set<string>();
    s.layers.forEach((l, i) => {
      const lp = `${path}.layers[${i}]`;
      checkLayer(ctx, l, lp, duration, captionTrackId);
      if (isObject(l) && isNonEmptyString(l.id)) {
        if (ids.has(l.id)) ctx.issues.error(`${lp}.id`, 'layer.id.duplicate', `duplicate layer id "${l.id}" in scene`);
        ids.add(l.id);
      }
      if (typeDef && typeDef.allowedLayerTypes !== 'any' && isObject(l) && isString(l.type) && !typeDef.allowedLayerTypes.includes(l.type as Layer['type'])) {
        ctx.issues.error(`${lp}.type`, 'scene.layer.notAllowed', `layer type "${l.type}" is not allowed in a "${typeDef.type}" scene`);
      }
    });
  }

  if (!Array.isArray(s.audio)) ctx.issues.error(`${path}.audio`, 'scene.audio.invalid', 'audio must be an array');
  else s.audio.forEach((t, i) => checkAudioTrack(ctx, t, `${path}.audio[${i}]`, duration));
  checkVoiceover(ctx, s.voiceover, `${path}.voiceover`, duration);
  if (!Array.isArray(s.animations)) ctx.issues.error(`${path}.animations`, 'animations.invalid', 'animations must be an array');
  else checkAnimations(ctx, s.animations, `${path}.animations`, duration);
  if (!Array.isArray(s.effects)) ctx.issues.error(`${path}.effects`, 'effects.invalid', 'effects must be an array');
  else checkEffects(ctx, s.effects, `${path}.effects`);
  checkTransition(ctx, s.transitionIn, `${path}.transitionIn`);
  checkTransition(ctx, s.transitionOut, `${path}.transitionOut`);
  if (s.metadata !== undefined && !isObject(s.metadata)) ctx.issues.error(`${path}.metadata`, 'scene.metadata.invalid', 'metadata must be an object');

  // Scene type contract: only meaningful once the structure is sound.
  const structurallyOk = !ctx.issues.issues.some((i) => i.severity === 'error' && i.path.startsWith(path));
  if (typeDef?.check && structurallyOk) {
    const msg = typeDef.check(s as unknown as Scene);
    if (msg) ctx.issues.error(path, 'scene.type.contract', msg);
  }
  if (typeDef && duration !== undefined) {
    const seconds = duration / ctx.fps;
    if (typeDef.minDurationInSeconds !== undefined && seconds < typeDef.minDurationInSeconds) ctx.issues.warn(`${path}.durationInFrames`, 'scene.duration.short', `${seconds.toFixed(2)}s is shorter than the ${typeDef.minDurationInSeconds}s minimum for "${typeDef.type}"`);
    if (typeDef.maxDurationInSeconds !== undefined && seconds > typeDef.maxDurationInSeconds) ctx.issues.warn(`${path}.durationInFrames`, 'scene.duration.long', `${seconds.toFixed(2)}s is longer than the ${typeDef.maxDurationInSeconds}s maximum for "${typeDef.type}"`);
  }
  return structurallyOk;
}

function makeCtx(fps: number, assets: AssetRegistry | undefined, options: ValidationOptions): Ctx {
  return {
    issues: new IssueCollector(),
    opts: { ...options, sceneTypes: options.sceneTypes ?? defaultSceneTypeRegistry, transitions: options.transitions ?? defaultTransitionRegistry },
    fps,
    ...(assets ? { assets } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a single scene in isolation. Asset references are only checked
 * when `assets` is given. Neighbour-dependent rules (transition overlaps,
 * derived start frames) need `validateProject`.
 */
export function validateScene(scene: unknown, context: { fps: number; assets?: AssetRegistry }, options: ValidationOptions = {}): ValidationResult {
  const ctx = makeCtx(context.fps, context.assets, options);
  checkScene(ctx, scene, 'scene');
  return ctx.issues.result();
}

export function validateProject(project: unknown, options: ValidationOptions = {}): ValidationResult {
  const issues = new IssueCollector();
  if (!isObject(project)) {
    issues.error('', 'project.invalid', 'project must be an object');
    return issues.result();
  }
  const maxFps = options.maxFps ?? 240;
  const fpsOk = isFiniteNumber(project.fps) && project.fps > 0 && project.fps <= maxFps;
  if (!fpsOk) issues.error('fps', 'project.fps.invalid', `fps must be a number in (0, ${maxFps}]`);
  const assets = isObject(project.assets) ? (project.assets as AssetRegistry) : undefined;
  const ctx = makeCtx(fpsOk ? (project.fps as number) : 30, assets, options);
  ctx.issues.issues.push(...issues.issues);

  if (!isNonEmptyString(project.id)) ctx.issues.error('id', 'project.id.invalid', 'project id must be a non-empty string');
  if (!isPositiveInteger(project.schemaVersion)) ctx.issues.error('schemaVersion', 'project.schema.invalid', 'schemaVersion must be a positive integer');
  else if (project.schemaVersion > SCHEMA_VERSION) ctx.issues.error('schemaVersion', 'project.schema.future', `schemaVersion ${project.schemaVersion} is newer than supported (${SCHEMA_VERSION})`);

  const dims = project.dimensions;
  const dimsOk = isObject(dims) && isPositiveInteger(dims.width) && isPositiveInteger(dims.height);
  if (!dimsOk) ctx.issues.error('dimensions', 'project.dimensions.invalid', 'dimensions need positive integer width and height');
  else if ((dims.width as number) % 2 !== 0 || (dims.height as number) % 2 !== 0) ctx.issues.warn('dimensions', 'project.dimensions.odd', 'odd dimensions are rejected by H.264 encoders');
  if (!isString(project.aspectRatio) || !parseAspectRatio(project.aspectRatio)) ctx.issues.error('aspectRatio', 'project.aspectRatio.invalid', 'aspectRatio must look like "16:9"');
  else if (dimsOk && !matchesAspectRatio(dims as { width: number; height: number }, project.aspectRatio)) {
    ctx.issues.warn('aspectRatio', 'project.aspectRatio.mismatch', `dimensions ${String(dims.width)}x${String(dims.height)} do not match ${project.aspectRatio}`);
  }
  checkBackground(ctx, project.background, 'background');

  if (!assets) ctx.issues.error('assets', 'project.assets.invalid', 'assets must be an object keyed by asset id');
  else {
    for (const [key, a] of Object.entries(assets)) {
      const p = `assets.${key}`;
      if (!isObject(a)) {
        ctx.issues.error(p, 'asset.invalid', 'asset must be an object');
        continue;
      }
      if (a.id !== key) ctx.issues.error(`${p}.id`, 'asset.id.mismatch', `asset id "${String(a.id)}" does not match its registry key "${key}"`);
      checkEnum(ctx, a.kind, ASSET_KINDS, `${p}.kind`, 'asset.kind.invalid');
      if (!isNonEmptyString(a.src)) ctx.issues.error(`${p}.src`, 'asset.src.invalid', 'src must be a non-empty string');
      if (a.durationInSeconds !== undefined && !(isFiniteNumber(a.durationInSeconds) && a.durationInSeconds > 0)) ctx.issues.error(`${p}.durationInSeconds`, 'asset.duration.invalid', 'durationInSeconds must be > 0');
    }
  }

  if (!Array.isArray(project.audio)) ctx.issues.error('audio', 'project.audio.invalid', 'audio must be an array');

  if (!Array.isArray(project.scenes)) {
    ctx.issues.error('scenes', 'project.scenes.invalid', 'scenes must be an array');
    return ctx.issues.result();
  }
  if (project.scenes.length === 0) ctx.issues.warn('scenes', 'project.scenes.empty', 'project has no scenes');

  const sceneIds = new Set<string>();
  let allScenesOk = true;
  project.scenes.forEach((s, i) => {
    const ok = checkScene(ctx, s, `scenes[${i}]`);
    allScenesOk &&= ok;
    if (isObject(s) && isNonEmptyString(s.id)) {
      if (sceneIds.has(s.id)) ctx.issues.error(`scenes[${i}].id`, 'scene.id.duplicate', `duplicate scene id "${s.id}"`);
      sceneIds.add(s.id);
    }
  });

  // Cross-scene timing rules. Require structurally valid scenes.
  if (allScenesOk) {
    const scenes = project.scenes as Scene[];
    const starts = getSceneStartFrames(scenes);
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i]!;
      const p = `scenes[${i}]`;
      const prev = scenes[i - 1];
      const next = scenes[i + 1];
      if (prev && s.transitionIn && prev.transitionOut && JSON.stringify(s.transitionIn) !== JSON.stringify(prev.transitionOut)) {
        ctx.issues.warn(`${p}.transitionIn`, 'transition.conflict', `both scenes[${i - 1}].transitionOut and ${p}.transitionIn are set; transitionIn wins`);
      }
      const overlapIn = prev ? getTransitionOverlap(prev, s) : 0;
      const overlapOut = next ? getTransitionOverlap(s, next) : 0;
      if (prev && overlapIn > Math.min(prev.durationInFrames, s.durationInFrames)) {
        ctx.issues.error(`${p}.transitionIn`, 'transition.tooLong', `transition (${overlapIn}f) is longer than one of the scenes it joins (${prev.durationInFrames}f / ${s.durationInFrames}f)`);
      }
      if (overlapIn + overlapOut > s.durationInFrames) {
        ctx.issues.error(p, 'transition.overlap.exceeds', `incoming (${overlapIn}f) + outgoing (${overlapOut}f) transitions exceed the scene duration (${s.durationInFrames}f)`);
      }
      const edgeIn = !prev ? s.transitionIn : undefined;
      const edgeOut = !next ? s.transitionOut : undefined;
      for (const [edge, key] of [[edgeIn, 'transitionIn'], [edgeOut, 'transitionOut']] as const) {
        if (edge && edge.type !== 'cut' && edge.durationInFrames > s.durationInFrames) ctx.issues.error(`${p}.${key}`, 'transition.tooLong', 'edge transition is longer than the scene');
      }
      if (s.startFrame !== undefined && s.startFrame !== starts[i]) {
        ctx.issues.warn(`${p}.startFrame`, 'scene.startFrame.stale', `declared startFrame ${s.startFrame} differs from the derived start ${starts[i]}; the derived value is used`);
      }
      if (prev) {
        const between = getTransitionBetween(prev, s);
        if (between && !ctx.opts.transitions.has(between.type)) ctx.issues.error(`${p}.transitionIn`, 'transition.type.unknown', `unknown transition "${between.type}"`);
      }
    }
    const projectAudio = project.audio as unknown[];
    if (Array.isArray(projectAudio)) projectAudio.forEach((t, i) => checkAudioTrack(ctx, t, `audio[${i}]`, undefined));
  }

  return ctx.issues.result();
}

export function assertValidProject(project: unknown, options?: ValidationOptions): asserts project is VideoProject {
  const result = validateProject(project, options);
  if (!result.valid) throw new SceneValidationError(result);
}

export function assertValidScene(scene: unknown, context: { fps: number; assets?: AssetRegistry }, options?: ValidationOptions): asserts scene is Scene {
  const result = validateScene(scene, context, options);
  if (!result.valid) throw new SceneValidationError(result);
}
