/**
 * Primitive value types shared by the whole scene model.
 *
 * Time is always expressed in integer frames inside the engine. Seconds only
 * appear at the edges (AI blueprints, UI) and are converted with `secondsToFrames`.
 */

/** A count of frames. Always an integer >= 0 once validated. */
export type Frames = number;
/** A duration in seconds. Only used at API boundaries. */
export type Seconds = number;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

/** Any CSS color string: hex, rgb(a), hsl(a) or a named color. */
export type Color = string;

export type AspectRatioPreset = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '21:9';
/** Preset ratios autocomplete; any `"w:h"` string is accepted and validated at runtime. */
export type AspectRatio = AspectRatioPreset | (string & {});

export type Direction = 'left' | 'right' | 'up' | 'down';

/** How media fits inside its layer box. Mirrors CSS `object-fit`. */
export type Fit = 'cover' | 'contain' | 'fill' | 'none';

export type Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type Units = 'px' | 'percent';

export type EasingPreset =
  | 'linear'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInQuart'
  | 'easeOutQuart'
  | 'easeInOutQuart'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack'
  | 'easeOutBounce'
  | 'easeOutElastic';

export interface CubicBezierEasing {
  type: 'cubicBezier';
  /** x1, y1, x2, y2 — same convention as CSS `cubic-bezier()`. */
  points: readonly [number, number, number, number];
}

/** Physically based spring, evaluated deterministically per frame. */
export interface SpringEasing {
  type: 'spring';
  mass?: number;
  stiffness?: number;
  damping?: number;
  overshootClamping?: boolean;
}

export interface StepsEasing {
  type: 'steps';
  steps: number;
  position?: 'start' | 'end';
}

export type Easing = EasingPreset | CubicBezierEasing | SpringEasing | StepsEasing;

export interface GradientStop {
  color: Color;
  /** 0..1 */
  offset: number;
}

export interface Gradient {
  kind: 'linear' | 'radial' | 'conic';
  /** Degrees, for linear and conic gradients. */
  angle?: number;
  stops: GradientStop[];
}

/** Free-form, JSON-serialisable bag of values. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
