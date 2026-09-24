import type { AnimationState } from '../animation/state.js';
import type { BlendMode } from '../model/layer.js';
import type { Color, Dimensions, Direction, Easing, JsonObject, JsonValue } from '../model/primitives.js';
import type { Transition } from '../model/transition.js';

/** What both scenes look like at a given progress of a transition. */
export interface TransitionFrameState {
  exiting: Partial<AnimationState>;
  entering: Partial<AnimationState>;
  /** Full-frame layer drawn above both scenes (flash, dip to color, film burn). */
  overlay?: { color: Color; opacity: number; blendMode?: BlendMode; kind?: 'solid' | 'burn' };
  /**
   * Distortion that needs a shader (ripple, glitch slices). Renderers without
   * shader support ignore it; the rest of the state still gives a clean result.
   */
  distortion?: { kind: 'ripple' | 'glitch'; amount: number; seed: number };
  /** Which scene is drawn on top. Defaults to `entering`. */
  top?: 'entering' | 'exiting';
}

export interface TransitionEvaluationContext {
  box: Dimensions;
}

/** CSS presentations, available in every Remotion 4 setup. */
export type RemotionCssPresentation = 'fade' | 'slide' | 'wipe' | 'flip' | 'iris' | 'clockWipe';
/** WebGL presentations built on Remotion's HTML-in-Canvas (Chrome ≥ 148 with the feature enabled). */
export type RemotionShaderPresentation = 'zoomBlur' | 'filmBurn' | 'ripple' | 'zoomInOut';
export type RemotionBuiltInPresentation = RemotionCssPresentation | RemotionShaderPresentation;

/** What the Remotion render environment supports. */
export interface RemotionCapabilities {
  /** Remotion HTML-in-Canvas shader presentations can run (Chrome ≥ 148, flag enabled). */
  htmlInCanvas: boolean;
}

export interface RemotionMappingContext extends TransitionEvaluationContext {
  capabilities: RemotionCapabilities;
}

/**
 * How a transition is expressed with `@remotion/transitions`.
 * - `builtin`: use Remotion's own presentation (no duplication). `requires`
 *   is set when it only works with an optional capability.
 * - `custom`: use the engine's generic presentation, which renders
 *   `evaluateAtProgress()` output. Used where Remotion has no equivalent, or
 *   where the Remotion equivalent needs a capability that is not available.
 */
export type RemotionPresentationSpec =
  | { kind: 'builtin'; name: RemotionBuiltInPresentation; props: Record<string, JsonValue>; requires?: keyof RemotionCapabilities }
  | { kind: 'custom'; name: string; props: Record<string, JsonValue> };

export type RemotionTimingSpec =
  | { kind: 'linear'; durationInFrames: number; easing?: Easing }
  | { kind: 'spring'; durationInFrames: number; config: { mass?: number; stiffness?: number; damping?: number } };

export interface TransitionDefinition {
  type: string;
  label: string;
  description: string;
  defaultDurationInSeconds: number;
  defaultEasing: Easing;
  directional: boolean;
  defaultDirection?: Direction;
  defaultIntensity: number;
  defaultParams?: JsonObject;
  /** Maps a normalized transition to Remotion. Omitted for `cut` (no transition element). */
  toRemotion?: (transition: NormalizedTransition, ctx: RemotionMappingContext) => RemotionPresentationSpec;
  /** Deterministic evaluation. `progress` is already eased. */
  evaluate: (transition: NormalizedTransition, progress: number, ctx: TransitionEvaluationContext) => TransitionFrameState;
}

/** A transition with every default filled in. */
export interface NormalizedTransition extends Transition {
  easing: Easing;
  intensity: number;
  params: JsonObject;
}
