/**
 * Timing windows of animations inside their owner (layer or scene).
 * Pure functions; everything is relative to the owner's start.
 */
import type { Animation } from '../model/animation.js';
import type { Frames } from '../model/primitives.js';

export interface AnimationWindowContext {
  /** Duration of the layer or scene that owns the animation. */
  ownerDurationInFrames: Frames;
  fps: number;
  /** Number of characters, used by `typewriter` with `charactersPerSecond`. */
  textLength?: number;
  /** Number of units (chars/words/lines) for `stagger` and `kineticTypography`. */
  unitCount?: number;
}

export interface AnimationWindow {
  /** First frame of the first play, relative to the owner. */
  startFrame: Frames;
  /** Duration of ONE play (one unit for staggered animations). */
  durationInFrames: Frames;
  /** Exclusive end of the whole animation including repeats and stagger offsets, capped to the owner. */
  endFrame: Frames;
  /** Plays including the first one. `Infinity` for `loop: true` (runtime only, never serialized). */
  iterations: number;
}

const DEFAULT_KINETIC_EACH = 3;

function baseDuration(animation: Animation, ctx: AnimationWindowContext, available: Frames): Frames {
  if (animation.type === 'typewriter' && animation.charactersPerSecond && ctx.textLength !== undefined) {
    return Math.max(1, Math.round((ctx.textLength / animation.charactersPerSecond) * ctx.fps));
  }
  if (animation.durationInFrames !== undefined) return Math.max(0, animation.durationInFrames);
  if (animation.type === 'keyframes') {
    // Keyframe animations last until their last keyframe unless told otherwise.
    let last = 0;
    for (const track of animation.tracks) for (const k of track.keyframes) last = Math.max(last, k.frame);
    return Math.min(last, available);
  }
  if (animation.type === 'stagger') {
    return animation.animation.durationInFrames ?? available;
  }
  return available;
}

function staggerSpan(animation: Animation, ctx: AnimationWindowContext): Frames {
  const units = Math.max(1, ctx.unitCount ?? 1);
  if (animation.type === 'stagger') return animation.each * (units - 1);
  if (animation.type === 'kineticTypography') return (animation.each ?? DEFAULT_KINETIC_EACH) * (units - 1);
  return 0;
}

export function resolveAnimationWindow(animation: Animation, ctx: AnimationWindowContext): AnimationWindow {
  const owner = Math.max(0, ctx.ownerDurationInFrames);
  const offset = Math.max(0, animation.startFrame ?? 0);
  const iterations = animation.loop ? Infinity : 1 + Math.max(0, animation.repeat ?? 0);
  const phase = animation.phase ?? 'during';

  let startFrame: Frames;
  let durationInFrames: Frames;

  if (phase === 'out') {
    // `startFrame` counts back from the owner end: the animation ENDS `offset` frames before it.
    durationInFrames = baseDuration(animation, ctx, Math.max(0, owner - offset));
    const span = staggerSpan(animation, ctx);
    startFrame = Math.max(0, owner - offset - durationInFrames - span);
  } else {
    startFrame = Math.min(offset, owner);
    durationInFrames = baseDuration(animation, ctx, Math.max(0, owner - startFrame));
  }

  const span = staggerSpan(animation, ctx);
  const total = iterations === Infinity ? owner - startFrame : durationInFrames * iterations + span;
  const endFrame = Math.min(owner, startFrame + total);

  return { startFrame, durationInFrames, endFrame, iterations };
}

/**
 * Progress (0..1) of one play of an animation at `frame` (relative to the
 * owner), handling repeats and yoyo. Returns 0 before the start and holds
 * the final value after the end.
 */
export function animationProgressAt(
  animation: Pick<Animation, 'yoyo'>,
  window: Pick<AnimationWindow, 'startFrame' | 'durationInFrames' | 'iterations'>,
  frame: Frames,
  unitDelay: Frames = 0,
): number {
  const local = frame - window.startFrame - unitDelay;
  if (local <= 0) return 0;
  const d = window.durationInFrames;
  if (d <= 0) return 1;
  const totalPlays = window.iterations;
  const played = local / d;
  if (played >= totalPlays) {
    // Finished: hold the last value, which is 0 if an even number of yoyo plays ended at the start.
    return animation.yoyo && totalPlays % 2 === 0 ? 0 : 1;
  }
  const iteration = Math.floor(played);
  const within = played - iteration;
  return animation.yoyo && iteration % 2 === 1 ? 1 - within : within;
}
