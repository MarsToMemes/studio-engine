/**
 * Runtime lists of every closed string union in the model. `exhaustive<T>()`
 * makes the compiler fail if a member is added to a type but not to its list,
 * so validation can never silently fall behind the types.
 */
import type { AnimatableProperty, AnimationPhase, AnimationType, CameraMove, KineticStyle, MaskShape, TextSplit } from './animation.js';
import type { AssetKind } from './assets.js';
import type { AudioRole } from './audio.js';
import type { EffectType } from './effects.js';
import type { BlendMode, GraphicKind, LayerType, OverlayKind, ShapeKind } from './layer.js';
import type { Anchor, Direction, EasingPreset, Fit, Units } from './primitives.js';
import type { BuiltInSceneType } from './scene.js';
import type { BuiltInTransitionType } from './transition.js';

type Missing<T, A extends readonly unknown[]> = Exclude<T, A[number]>;

export const exhaustive =
  <T extends string>() =>
  <const A extends readonly T[]>(values: A & ([Missing<T, A>] extends [never] ? unknown : { __missing__: Missing<T, A> })): readonly T[] =>
    values;

export const LAYER_TYPES = exhaustive<LayerType>()(['background', 'video', 'image', 'text', 'caption', 'shape', 'lottie', 'graphic', 'overlay']);
export const SCENE_TYPES = exhaustive<BuiltInSceneType>()([
  'video', 'image', 'title', 'text', 'broll', 'talking_head', 'quote', 'statistic', 'chart', 'map', 'screenshot', 'montage', 'endcard', 'custom',
]);
export const TRANSITION_TYPES = exhaustive<BuiltInTransitionType>()([
  'cut', 'fade', 'crossfade', 'slide', 'wipe', 'zoom', 'zoomBlur', 'whip', 'filmBurn', 'ripple', 'glitch', 'blur', 'flash', 'push', 'flip', 'iris',
]);
export const ANIMATION_TYPES = exhaustive<AnimationType>()([
  'fade', 'slide', 'scale', 'zoom', 'rotate', 'blur', 'bounce', 'spring', 'stagger', 'reveal', 'typewriter', 'kineticTypography',
  'parallax', 'camera', 'shake', 'glitch', 'maskReveal', 'keyframes', 'custom',
]);
export const ANIMATABLE_PROPERTIES = exhaustive<AnimatableProperty>()([
  'opacity', 'x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'blur', 'skewX', 'skewY', 'clipInset', 'brightness', 'saturation',
]);
export const ANIMATION_PHASES = exhaustive<AnimationPhase>()(['in', 'out', 'during']);
export const CAMERA_MOVES = exhaustive<CameraMove>()(['pushIn', 'pullOut', 'panLeft', 'panRight', 'tiltUp', 'tiltDown', 'kenBurns', 'dolly', 'orbit']);
export const KINETIC_STYLES = exhaustive<KineticStyle>()(['pop', 'slam', 'wave', 'rise', 'flip', 'highlight']);
export const TEXT_SPLITS = exhaustive<TextSplit>()(['characters', 'words', 'lines']);
export const MASK_SHAPES = exhaustive<MaskShape>()(['rect', 'circle', 'diagonal']);
export const EFFECT_TYPES = exhaustive<EffectType>()([
  'blur', 'brightness', 'contrast', 'saturate', 'grayscale', 'sepia', 'hueRotate', 'invert', 'dropShadow', 'vignette', 'grain',
  'chromaticAberration', 'glow', 'colorGrade', 'lut', 'pixelate', 'custom',
]);
export const BLEND_MODES = exhaustive<BlendMode>()([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);
export const SHAPE_KINDS = exhaustive<ShapeKind>()(['rect', 'ellipse', 'line', 'polygon', 'path']);
export const GRAPHIC_KINDS = exhaustive<GraphicKind>()(['counter', 'barChart', 'lineChart', 'pieChart', 'map', 'progress', 'icon', 'svg', 'lowerThird', 'custom']);
export const OVERLAY_KINDS = exhaustive<OverlayKind>()(['color', 'gradient', 'vignette', 'grain', 'lightLeak', 'texture', 'letterbox', 'asset']);
export const ASSET_KINDS = exhaustive<AssetKind>()(['video', 'image', 'audio', 'lottie', 'dotlottie', 'font', 'svg', 'json']);
export const AUDIO_ROLES = exhaustive<AudioRole>()(['music', 'sfx', 'ambience', 'voiceover', 'source']);
export const ANCHORS = exhaustive<Anchor>()([
  'top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right',
]);
export const DIRECTIONS = exhaustive<Direction>()(['left', 'right', 'up', 'down']);
export const FITS = exhaustive<Fit>()(['cover', 'contain', 'fill', 'none']);
export const UNITS = exhaustive<Units>()(['px', 'percent']);
export const EASING_PRESET_NAMES = exhaustive<EasingPreset>()([
  'linear', 'ease', 'easeIn', 'easeOut', 'easeInOut', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad', 'easeInCubic', 'easeOutCubic',
  'easeInOutCubic', 'easeInQuart', 'easeOutQuart', 'easeInOutQuart', 'easeInExpo', 'easeOutExpo', 'easeInOutExpo', 'easeInBack',
  'easeOutBack', 'easeInOutBack', 'easeOutBounce', 'easeOutElastic',
]);
