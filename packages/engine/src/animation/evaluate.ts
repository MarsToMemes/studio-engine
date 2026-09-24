/**
 * Evaluate a list of animations at one frame into a single `AnimationState`.
 * Windows come from the timeline resolver or from `compileScene()` and are
 * computed once, not per frame.
 */
import type { Animation } from '../model/animation.js';
import type { Dimensions, Frames } from '../model/primitives.js';
import type { AnimationWindow } from '../timing/windows.js';
import { AnimationProviderRegistry, type EvaluationMode } from './providers/registry.js';
import { createState, mergeState, type AnimationState } from './state.js';

export interface EvaluateOptions {
  fps: number;
  /** Frame relative to the owner start. */
  frame: Frames;
  box: Dimensions;
  registry: AnimationProviderRegistry;
  mode: EvaluationMode;
  unit?: { index: number; count: number };
  /** Receives provider fallbacks (e.g. to surface them in the editor). */
  onFallback?: (animation: Animation, reason: string) => void;
}

export interface WindowedAnimation {
  animation: Animation;
  window: AnimationWindow;
}

export function evaluateAnimations(items: readonly WindowedAnimation[], options: EvaluateOptions): AnimationState {
  const state = createState();
  for (const { animation, window } of items) {
    if (animation.enabled === false) continue;
    const { provider, fallback, reason } = options.registry.resolve(animation, options.mode);
    if (fallback && reason) options.onFallback?.(animation, reason);
    if (!provider) continue;
    mergeState(
      state,
      provider.evaluate(animation, {
        fps: options.fps,
        frame: options.frame,
        window,
        box: options.box,
        ...(options.unit ? { unit: options.unit } : {}),
      }),
    );
  }
  return state;
}

/** True when some animation must be evaluated per unit (character / word / line). */
export function hasUnitAnimations(animations: readonly Animation[]): boolean {
  return animations.some((a) => a.enabled !== false && (a.type === 'stagger' || a.type === 'kineticTypography'));
}
