/**
 * Transitions between scenes.
 *
 * Semantics (identical to Remotion's `<TransitionSeries>`):
 * - A transition between scene A and scene B OVERLAPS the two scenes. It
 *   consumes `durationInFrames` from the total timeline duration.
 * - The transition used between A and B is `B.transitionIn ?? A.transitionOut`.
 *   Setting both to different values is reported as a validation warning.
 * - The first scene's `transitionIn` and the last scene's `transitionOut` have
 *   no neighbour to overlap with; they are rendered INSIDE the scene (from / to
 *   the project background) and do not change the timeline duration.
 */
import type { Direction, Easing, Frames, JsonObject } from './primitives.js';

export type BuiltInTransitionType =
  | 'cut'
  | 'fade'
  | 'crossfade'
  | 'slide'
  | 'wipe'
  | 'zoom'
  | 'zoomBlur'
  | 'whip'
  | 'filmBurn'
  | 'ripple'
  | 'glitch'
  | 'blur'
  | 'flash'
  | 'push'
  | 'flip'
  | 'iris';

/** Open union: custom transitions can be registered in the transition registry. */
export type TransitionType = BuiltInTransitionType | (string & {});

export interface Transition {
  id?: string;
  type: TransitionType;
  /** 0 for `cut`. Must fit inside both neighbouring scenes. */
  durationInFrames: Frames;
  direction?: Direction;
  easing?: Easing;
  /** 0..1 scalar interpreted by each transition (blur radius, flash strength…). */
  intensity?: number;
  /** Transition specific parameters (e.g. `{ color: '#fff' }` for flash). */
  params?: JsonObject;
  presetId?: string;
}
