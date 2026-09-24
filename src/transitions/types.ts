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

export type RemotionBuiltInPresentation = 'fade' | 'slide' | 'wipe' | 'flip' | 'iris' | 'clockWipe';

/**
 * How a transition is expressed with `@remotion/transitions`.
 * - `builtin`: use Remotion's own presentation (no duplication).
 * - `custom`: use the engine's generic presentation, which renders
 *   `evaluateTransition()` output. Only needed where Remotion has no equivalent.
 */
export type RemotionPresentationSpec =
  | { kind: 'builtin'; name: RemotionBuiltInPresentation; props: Record<string, JsonValue> }
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
  /** Maps a normalized transition to Remotion. `undefined` for `cut` (no transition element). */
  toRemotion?: (transition: NormalizedTransition, ctx: TransitionEvaluationContext) => RemotionPresentationSpec;
  /** Deterministic evaluation. `progress` is already eased. */
  evaluate: (transition: NormalizedTransition, progress: number, ctx: TransitionEvaluationContext) => TransitionFrameState;
}

/** A transition with every default filled in. */
export interface NormalizedTransition extends Transition {
  easing: Easing;
  intensity: number;
  params: JsonObject;
}
