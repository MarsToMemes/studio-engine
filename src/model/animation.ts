/**
 * Animations are plain data. They never reference a library; an
 * `AnimationProvider` turns them into values at a given frame.
 *
 * Frame fields on an animation are RELATIVE to the owner (layer or scene)
 * start. `startFrame` defaults to 0 and `durationInFrames` defaults to the
 * remaining duration of the owner.
 */
import type { Direction, Easing, Frames, JsonObject, Units, Vec2 } from './primitives.js';

export type AnimationType =
  | 'fade'
  | 'slide'
  | 'scale'
  | 'zoom'
  | 'rotate'
  | 'blur'
  | 'bounce'
  | 'spring'
  | 'stagger'
  | 'reveal'
  | 'typewriter'
  | 'kineticTypography'
  | 'parallax'
  | 'camera'
  | 'shake'
  | 'glitch'
  | 'maskReveal'
  | 'keyframes'
  | 'custom';

/**
 * Properties an animation can drive. Every provider must map these to the same
 * meaning so switching providers never changes the look of a render.
 */
export type AnimatableProperty =
  | 'opacity'
  | 'x'
  | 'y'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'blur'
  | 'skewX'
  | 'skewY'
  | 'clipInset'
  | 'brightness'
  | 'saturation';

/**
 * Where the animation sits relative to its owner.
 * - `in`: plays from the owner start (default for entrance presets)
 * - `out`: anchored to the owner end; `startFrame` counts back from the end
 * - `during`: absolute window inside the owner (default)
 */
export type AnimationPhase = 'in' | 'out' | 'during';

export interface AnimationBase {
  id?: string;
  type: AnimationType;
  phase?: AnimationPhase;
  startFrame?: Frames;
  durationInFrames?: Frames;
  easing?: Easing;
  /** Extra plays after the first one (finite, JSON-safe). */
  repeat?: number;
  /** Repeat for the whole lifetime of the owner. Wins over `repeat`. */
  loop?: boolean;
  /** Alternate direction on each repeat. */
  yoyo?: boolean;
  enabled?: boolean;
  /**
   * Provider override. Defaults to the deterministic `native` provider.
   * Anything that must appear in the final MP4 must use a deterministic provider.
   */
  provider?: string;
  /** Preset this animation was expanded from, kept for round-tripping in the editor. */
  presetId?: string;
}

export interface FadeAnimation extends AnimationBase {
  type: 'fade';
  from?: number;
  to?: number;
}

export interface SlideAnimation extends AnimationBase {
  type: 'slide';
  /** Direction the element travels TOWARDS. `in` phase slides in from the opposite side. */
  direction: Direction;
  distance?: number;
  units?: Units;
  /** Also fade while sliding. */
  fade?: boolean;
}

export interface ScaleAnimation extends AnimationBase {
  type: 'scale';
  from?: number;
  to?: number;
}

/** Content zoom. Semantically a camera-style scale that is centered on `origin`. */
export interface ZoomAnimation extends AnimationBase {
  type: 'zoom';
  from?: number;
  to?: number;
  /** 0..1 in the layer box. Defaults to the center. */
  origin?: Vec2;
}

export interface RotateAnimation extends AnimationBase {
  type: 'rotate';
  /** Degrees. */
  from?: number;
  to?: number;
}

export interface BlurAnimation extends AnimationBase {
  type: 'blur';
  /** Pixels. */
  from?: number;
  to?: number;
}

export interface BounceAnimation extends AnimationBase {
  type: 'bounce';
  /** Pixels of vertical travel. */
  height?: number;
  bounces?: number;
}

/** Spring-driven transition of one property from `from` to `to`. */
export interface SpringAnimation extends AnimationBase {
  type: 'spring';
  property: AnimatableProperty;
  from: number;
  to: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
  overshootClamping?: boolean;
}

/**
 * Applies `animation` to each child unit (characters, words, lines or list
 * items) with an incremental delay. The layer renderer decides what a "unit" is.
 */
export interface StaggerAnimation extends AnimationBase {
  type: 'stagger';
  animation: LeafAnimation;
  /** Frames between two consecutive units. */
  each: Frames;
  from?: 'start' | 'end' | 'center';
  unit?: TextSplit;
}

export interface RevealAnimation extends AnimationBase {
  type: 'reveal';
  /** Edge the reveal moves towards. */
  direction: Direction;
}

export interface TypewriterAnimation extends AnimationBase {
  type: 'typewriter';
  /** Characters per second. When set, it wins over `durationInFrames`. */
  charactersPerSecond?: number;
  cursor?: boolean;
}

export type TextSplit = 'characters' | 'words' | 'lines';

export type KineticStyle = 'pop' | 'slam' | 'wave' | 'rise' | 'flip' | 'highlight';

/** Word/character level typography animation driven by a named style. */
export interface KineticTypographyAnimation extends AnimationBase {
  type: 'kineticTypography';
  style: KineticStyle;
  split: TextSplit;
  /** Frames between units. */
  each?: Frames;
  intensity?: number;
}

/** Depth-based drift. Layers with a higher `depth` move more. */
export interface ParallaxAnimation extends AnimationBase {
  type: 'parallax';
  depth: number;
  direction: Direction;
  /** Pixels travelled at depth 1 over the whole animation. */
  distance?: number;
}

export type CameraMove = 'pushIn' | 'pullOut' | 'panLeft' | 'panRight' | 'tiltUp' | 'tiltDown' | 'kenBurns' | 'dolly' | 'orbit';

/** Virtual camera move. Usually attached to a scene; can target a single layer. */
export interface CameraAnimation extends AnimationBase {
  type: 'camera';
  move: CameraMove;
  /** 0..1, scales the magnitude of the move. */
  intensity?: number;
  /** Focal point in 0..1 box coordinates. */
  focus?: Vec2;
}

export interface ShakeAnimation extends AnimationBase {
  type: 'shake';
  /** Pixels. */
  amplitude?: number;
  /** Oscillations per second. */
  frequency?: number;
  /** Deterministic noise seed. Same seed => same shake on every render. */
  seed?: number;
  /** Also shake rotation, in degrees. */
  rotation?: number;
}

export interface GlitchAnimation extends AnimationBase {
  type: 'glitch';
  intensity?: number;
  /** Glitch bursts per second. */
  frequency?: number;
  seed?: number;
}

export type MaskShape = 'rect' | 'circle' | 'diagonal';

export interface MaskRevealAnimation extends AnimationBase {
  type: 'maskReveal';
  shape: MaskShape;
  /** Only used by `rect`. Defaults to `right`. */
  direction?: Direction;
  /** Circle center, 0..1 in the layer box. */
  center?: Vec2;
}

export type KeyframeValue = number;

export interface Keyframe {
  /** Frame relative to the animation start. */
  frame: Frames;
  value: KeyframeValue;
  /** Easing used from THIS keyframe to the next one. */
  easing?: Easing;
}

export interface KeyframeTrack {
  property: AnimatableProperty;
  keyframes: Keyframe[];
}

export interface KeyframeAnimation extends AnimationBase {
  type: 'keyframes';
  tracks: KeyframeTrack[];
}

/**
 * Escape hatch for provider specific animations. The payload is opaque to the
 * engine; the named provider is responsible for evaluating it.
 */
export interface CustomAnimation extends AnimationBase {
  type: 'custom';
  name: string;
  params?: JsonObject;
}

/** Every animation that is not a container of other animations. */
export type LeafAnimation =
  | FadeAnimation
  | SlideAnimation
  | ScaleAnimation
  | ZoomAnimation
  | RotateAnimation
  | BlurAnimation
  | BounceAnimation
  | SpringAnimation
  | RevealAnimation
  | TypewriterAnimation
  | KineticTypographyAnimation
  | ParallaxAnimation
  | CameraAnimation
  | ShakeAnimation
  | GlitchAnimation
  | MaskRevealAnimation
  | KeyframeAnimation
  | CustomAnimation;

export type Animation = LeafAnimation | StaggerAnimation;

export type AnimationOfType<T extends AnimationType> = Extract<Animation, { type: T }>;
