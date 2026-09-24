/**
 * Adapter for third-party animation libraries (GSAP, Motion, Theatre.js…).
 *
 * The engine does not depend on any of them. An integration wraps the library
 * in this shape and registers it. Whether it may be used for the final render
 * is the integration author's explicit claim (`deterministic`):
 *
 * - GSAP: a paused timeline driven with `timeline.progress(p)` on a plain
 *   object is deterministic and can render.
 * - Theatre.js: `sequence.position = seconds` then reading the object values
 *   is deterministic and can render.
 * - Motion (framer-motion): its value/animation APIs are time-driven and
 *   imperative; use it for editor UI interactions (`deterministic: false`).
 *
 * Non-deterministic providers are used in preview only; the render pipeline
 * falls back to the native provider and reports it.
 */
import type { Animation, AnimationType } from '../../model/animation.js';
import type { AnimationState } from '../state.js';
import type { AnimationEvaluationContext, AnimationProvider } from './types.js';

export interface ExternalProviderOptions {
  id: string;
  deterministic: boolean;
  description?: string;
  /** Animation types handled, or a predicate (e.g. only `custom` animations with a given name). */
  supports: readonly AnimationType[] | ((animation: Animation) => boolean);
  evaluate: (animation: Animation, ctx: AnimationEvaluationContext) => Partial<AnimationState>;
}

export function createExternalProvider(options: ExternalProviderOptions): AnimationProvider {
  const { supports } = options;
  const predicate = typeof supports === 'function' ? supports : (a: Animation) => supports.includes(a.type);
  return {
    id: options.id,
    deterministic: options.deterministic,
    ...(options.description ? { description: options.description } : {}),
    supports: predicate,
    evaluate: options.evaluate,
  };
}
