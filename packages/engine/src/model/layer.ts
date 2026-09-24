/**
 * Layers are flat (no nesting) and ordered by `zIndex`. Each layer type is a
 * member of a discriminated union; adding a type means adding one interface
 * here and one entry in the layer registry, nothing else.
 *
 * Timing fields are relative to the owning scene.
 */
import type { Animation } from './animation.js';
import type { AssetId } from './assets.js';
import type { Effect } from './effects.js';
import type { Anchor, Color, Fit, Frames, Gradient, JsonObject, JsonValue, Units, Vec2 } from './primitives.js';
import type { CaptionStyle, TextStyle } from './text.js';
import type { Background } from './background.js';

export type LayerType =
  | 'background'
  | 'video'
  | 'image'
  | 'text'
  | 'caption'
  | 'shape'
  | 'lottie'
  | 'graphic'
  | 'overlay';

/** Layout box of a layer, resolved against the canvas by `resolveLayerBox`. */
export interface LayerBox {
  /** Point of the canvas the offsets are measured from. Also the layer's own alignment point. */
  anchor: Anchor;
  x: number;
  y: number;
  /** Omit for "fill the canvas". */
  width?: number;
  height?: number;
  units: Units;
}

export interface LayerTransform {
  /** 0..1 inside the layer box. Defaults to the center. */
  origin?: Vec2;
  skewX?: number;
  skewY?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** CSS perspective in px, enables 3D rotations. */
  perspective?: number;
  rotateX?: number;
  rotateY?: number;
}

/** Inset crop of the layer box, in percent (0..100) or pixels. */
export interface Crop {
  top: number;
  right: number;
  bottom: number;
  left: number;
  units: Units;
}

export type Mask =
  | { type: 'shape'; shape: 'rect' | 'roundedRect' | 'circle' | 'ellipse'; radius?: number; feather?: number; invert?: boolean }
  | { type: 'polygon'; points: Vec2[]; feather?: number; invert?: boolean }
  | { type: 'gradient'; gradient: Gradient; invert?: boolean }
  | { type: 'asset'; assetId: AssetId; fit?: Fit; invert?: boolean };

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface LayerBase {
  id: string;
  type: LayerType;
  name?: string;
  zIndex: number;
  /** Relative to the scene start. Defaults to 0. */
  startFrame?: Frames;
  /** Defaults to "until the end of the scene". */
  durationInFrames?: Frames;
  position: LayerBox;
  /** Uniform scale or per-axis scale. */
  scale: number | Vec2;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0..1 */
  opacity: number;
  transform?: LayerTransform;
  crop?: Crop;
  mask?: Mask;
  blendMode?: BlendMode;
  animations: Animation[];
  effects: Effect[];
  visible?: boolean;
  locked?: boolean;
  metadata?: JsonObject;
}

export interface MediaTrim {
  /** First source frame to play (at project fps). */
  startFrom?: Frames;
  /** Source frame to stop at, exclusive. */
  endAt?: Frames;
}

export interface BackgroundLayer extends LayerBase {
  type: 'background';
  background: Background;
}

export interface VideoLayer extends LayerBase {
  type: 'video';
  assetId: AssetId;
  fit: Fit;
  trim?: MediaTrim;
  playbackRate?: number;
  /** 0..1 */
  volume?: number;
  muted?: boolean;
  loop?: boolean;
  /** 0..1 point kept in frame when cropping with `cover`. */
  focalPoint?: Vec2;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: AssetId;
  fit: Fit;
  focalPoint?: Vec2;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  style: TextStyle;
  /** Word indices to render with `style.highlight`. */
  emphasis?: number[];
  maxWidth?: number;
  /** Shrink the font to fit the box. */
  autoFit?: boolean;
}

export interface CaptionLayer extends LayerBase {
  type: 'caption';
  /** Caption track id. Defaults to the owning scene's caption track. */
  trackId?: string;
  style: CaptionStyle;
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'polygon' | 'path';

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: ShapeKind;
  fill?: Color | Gradient;
  stroke?: { color: Color; width: number; dash?: number[] };
  cornerRadius?: number;
  points?: Vec2[];
  /** SVG path data for `path` shapes, in layer box coordinates. */
  path?: string;
}

/**
 * Lottie is an optional visual asset (animated icons, lower thirds, stickers),
 * not the engine's animation system. Layer animations still apply on top.
 */
export type LottieSource =
  | { kind: 'asset'; assetId: AssetId }
  | { kind: 'url'; url: string; format: 'json' | 'dotlottie' }
  | { kind: 'inline'; data: JsonObject };

export interface LottieLayer extends LayerBase {
  type: 'lottie';
  source: LottieSource;
  /** Animation id inside a multi-animation dotLottie file. */
  animationId?: string;
  playbackRate?: number;
  loop?: boolean;
  /** First Lottie frame to play (in the Lottie's own frame numbering). */
  lottieStartFrame?: number;
  /** Last Lottie frame to play, inclusive. */
  lottieEndFrame?: number;
  direction?: 'forward' | 'reverse';
  fit?: Fit;
  /**
   * Color / theme overrides. `slots` target Lottie slot ids (lottie-web ≥5.12,
   * dotLottie themes). `colors` replace fill/stroke colors by keypath.
   * Renderers that cannot apply an override must ignore it, not fail.
   */
  overrides?: {
    themeId?: string;
    slots?: Record<string, JsonValue>;
    colors?: Array<{ keypath: string; color: Color }>;
  };
}

export type GraphicKind = 'counter' | 'barChart' | 'lineChart' | 'pieChart' | 'progress' | 'icon' | 'svg' | 'lowerThird' | 'custom';

/**
 * Data-driven graphic (animated number, chart, lower third…). The engine only
 * carries the spec; a graphic renderer registered for `kind` draws it.
 */
export interface GraphicLayer extends LayerBase {
  type: 'graphic';
  kind: GraphicKind;
  data: JsonObject;
  style?: JsonObject;
}

export type OverlayKind = 'color' | 'gradient' | 'vignette' | 'grain' | 'lightLeak' | 'texture' | 'letterbox' | 'asset';

export interface OverlayLayer extends LayerBase {
  type: 'overlay';
  kind: OverlayKind;
  color?: Color;
  gradient?: Gradient;
  assetId?: AssetId;
  intensity?: number;
}

export type Layer =
  | BackgroundLayer
  | VideoLayer
  | ImageLayer
  | TextLayer
  | CaptionLayer
  | ShapeLayer
  | LottieLayer
  | GraphicLayer
  | OverlayLayer;

export type LayerOfType<T extends LayerType> = Extract<Layer, { type: T }>;
