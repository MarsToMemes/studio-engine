/**
 * Editorial transition catalog (snake_case ids used by the AI and the UI)
 * mapped onto the engine's transition registry.
 *
 * `hard_cut` is the default. Transitions are tiered so the editor can keep
 * spectacular ones for moments that justify them.
 */
import type { Transition } from '../model/transition.js';
import type { TransitionRegistry } from '../transitions/registry.js';

export type TransitionTier = 'neutral' | 'standard' | 'spectacular';

export interface EditorialTransition {
  id: string;
  /** Engine transition type. */
  engineType: string;
  tier: TransitionTier;
  description: string;
}

export const DEFAULT_TRANSITION_ID = 'hard_cut';

export const EDITORIAL_TRANSITIONS: readonly EditorialTransition[] = [
  { id: 'hard_cut', engineType: 'cut', tier: 'neutral', description: 'Default. Instant cut, no overlap.' },
  { id: 'fade', engineType: 'fade', tier: 'standard', description: 'Dip through black. Chapter or time change.' },
  { id: 'dissolve', engineType: 'crossfade', tier: 'standard', description: 'Soft cross-dissolve between related shots.' },
  { id: 'slide', engineType: 'slide', tier: 'standard', description: 'Next shot slides over the current one.' },
  { id: 'push', engineType: 'push', tier: 'standard', description: 'Next shot pushes the current one out.' },
  { id: 'wipe', engineType: 'wipe', tier: 'standard', description: 'Hard-edge wipe.' },
  { id: 'zoom', engineType: 'zoom', tier: 'spectacular', description: 'Zoom through. Energetic continuation.' },
  { id: 'zoom_blur', engineType: 'zoomBlur', tier: 'spectacular', description: 'Fast zoom with motion blur.' },
  { id: 'whip', engineType: 'whip', tier: 'spectacular', description: 'Whip pan. Fast-paced sequences.' },
  { id: 'blur', engineType: 'blur', tier: 'standard', description: 'Blur dissolve.' },
  { id: 'flash', engineType: 'flash', tier: 'spectacular', description: 'White flash. Beats, impacts.' },
  { id: 'glitch', engineType: 'glitch', tier: 'spectacular', description: 'Digital glitch. Revelations only.' },
  { id: 'film_burn', engineType: 'filmBurn', tier: 'spectacular', description: 'Warm light burst. Archive / memory.' },
];

const byId = new Map(EDITORIAL_TRANSITIONS.map((t) => [t.id, t]));

export function getEditorialTransition(id: string): EditorialTransition | undefined {
  return byId.get(id);
}

/**
 * Engine transition for an editorial id. Unknown ids resolve to `undefined`
 * (= hard cut) instead of throwing: a missing transition never breaks a render.
 */
export function toEngineTransition(id: string | undefined, fps: number, registry: TransitionRegistry, durationInFrames?: number): Transition | undefined {
  const t = byId.get(id ?? DEFAULT_TRANSITION_ID);
  if (!t || t.engineType === 'cut') return undefined;
  return registry.create(t.engineType, fps, durationInFrames !== undefined ? { durationInFrames } : {});
}
