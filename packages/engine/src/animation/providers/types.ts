import type { Animation } from '../../model/animation.js';
import type { Dimensions, Frames } from '../../model/primitives.js';
import type { AnimationWindow } from '../../timing/windows.js';
import type { AnimationState } from '../state.js';

export interface AnimationEvaluationContext {
  fps: number;
  /** Frame relative to the owner (layer or scene) start. */
  frame: Frames;
  /** Resolved window of the animation inside its owner. */
  window: AnimationWindow;
  /** Size of the animated box in px (layer box or canvas for scene animations). */
  box: Dimensions;
  /** Present when evaluating one unit (character / word / line / item) of a split element. */
  unit?: { index: number; count: number };
}

/**
 * An animation provider turns animation DATA into values at a frame.
 *
 * Providers are pluggable so the model never depends on a library. The render
 * pipeline only accepts `deterministic` providers: identical input must yield
 * identical output regardless of machine, wall clock or evaluation order —
 * a hard requirement for Remotion's parallel, frame-by-frame rendering.
 */
export interface AnimationProvider {
  readonly id: string;
  readonly deterministic: boolean;
  /** Human readable purpose, e.g. "editor preview", "final render". */
  readonly description?: string;
  supports(animation: Animation): boolean;
  evaluate(animation: Animation, ctx: AnimationEvaluationContext): Partial<AnimationState>;
}
