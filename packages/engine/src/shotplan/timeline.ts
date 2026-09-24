/**
 * Derived timing of a ShotPlan and the flat Timeline view.
 *
 * Same arithmetic as the rest of the engine (and Remotion <TransitionSeries>):
 * a transition INTO shot i overlaps shots i-1 and i. Transitions longer than
 * half of either neighbour are shortened (and reported) so a plan written by
 * an AI can never produce an invalid timeline.
 */
import type { Transition } from '../model/transition.js';
import { getSceneStartFrames, getTimelineDuration } from '../timing/timeline.js';
import { defaultTransitionRegistry, type TransitionRegistry } from '../transitions/registry.js';
import { DEFAULT_TRANSITION_ID, getEditorialTransition, toEngineTransition } from './transitions.js';
import type { JsonObject, JsonValue } from '../model/primitives.js';
import type { Shot, ShotPlan, Timeline, TimelineShot } from './types.js';

export interface ResolvedShotTransition {
  /** Editorial id actually used (`hard_cut` when missing or unknown). */
  id: string;
  /** Engine transition, `undefined` for a hard cut. */
  transition?: Transition;
  /** Set when the requested id does not exist. */
  unknownId?: string;
  /** Set when the duration was shortened to fit the neighbouring shots. */
  shortenedFrom?: number;
}

export function resolveShotTransitions(plan: Pick<ShotPlan, 'shots' | 'fps'>, registry: TransitionRegistry = defaultTransitionRegistry): ResolvedShotTransition[] {
  return plan.shots.map((shot, i) => {
    const requested = shot.transition ?? DEFAULT_TRANSITION_ID;
    const known = getEditorialTransition(requested);
    const id = known ? requested : DEFAULT_TRANSITION_ID;
    const transition = toEngineTransition(id, plan.fps, registry, shot.transitionDurationInFrames);
    const out: ResolvedShotTransition = { id, ...(known ? {} : { unknownId: requested }) };
    if (!transition) return out;
    const prev = plan.shots[i - 1];
    const max = Math.floor(Math.min(shot.durationInFrames, prev ? prev.durationInFrames : shot.durationInFrames) / 2);
    if (transition.durationInFrames > max) {
      out.shortenedFrom = transition.durationInFrames;
      transition.durationInFrames = max;
    }
    if (transition.durationInFrames > 0) out.transition = transition;
    else out.id = DEFAULT_TRANSITION_ID;
    return out;
  });
}

function timedShots(plan: Pick<ShotPlan, 'shots' | 'fps'>, registry?: TransitionRegistry) {
  const transitions = resolveShotTransitions(plan, registry);
  // The first shot's transition plays inside the shot (edge) and never overlaps.
  return plan.shots.map((s, i) => ({ durationInFrames: s.durationInFrames, ...(i > 0 && transitions[i]!.transition ? { transitionIn: transitions[i]!.transition } : {}) }));
}

export function getShotStartFrames(plan: Pick<ShotPlan, 'shots' | 'fps'>, registry?: TransitionRegistry): number[] {
  return getSceneStartFrames(timedShots(plan, registry));
}

export function getShotPlanDuration(plan: Pick<ShotPlan, 'shots' | 'fps'>, registry?: TransitionRegistry): number {
  return getTimelineDuration(timedShots(plan, registry));
}

const PAYLOAD_KEYS = ['subtext', 'number', 'chart', 'map', 'document', 'transitionDurationInFrames'] as const;

const toJson = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

/** The flat Timeline format, with derived start frames. Lossless: `fromTimeline(toTimeline(p))` gives `p` back. */
export function toTimeline(plan: ShotPlan, registry?: TransitionRegistry): Timeline {
  const starts = getShotStartFrames(plan, registry);
  const transitions = resolveShotTransitions(plan, registry);
  return {
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    durationInFrames: getShotPlanDuration(plan, registry),
    shots: plan.shots.map((shot, i): TimelineShot => {
      const metadata: Record<string, JsonValue> = { ...(shot.metadata ?? {}) };
      for (const key of PAYLOAD_KEYS) if (shot[key] !== undefined) metadata[key] = toJson(shot[key]);
      if (shot.sfx && shot.sfx.length > 0) metadata.sfxEvents = toJson(shot.sfx);
      if (shot.transition !== undefined && transitions[i]!.id !== shot.transition) metadata.requestedTransition = shot.transition;
      return {
        id: shot.id,
        startFrame: starts[i]!,
        durationInFrames: shot.durationInFrames,
        type: shot.type,
        ...(shot.media !== undefined ? { media: shot.media } : {}),
        ...(shot.text !== undefined ? { text: shot.text } : {}),
        ...(shot.highlightedWords ? { highlightedWords: [...shot.highlightedWords] } : {}),
        ...(shot.motionSkill !== undefined ? { motionSkill: shot.motionSkill } : {}),
        // Always explicit in the view (hard_cut by default), so the UI never has to guess.
        transition: transitions[i]!.id,
        ...(shot.intensity ? { intensity: shot.intensity } : {}),
        ...(shot.sfx && shot.sfx[0] ? { sfx: shot.sfx[0].sfx } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
    }),
  };
}

export interface FromTimelineResult {
  plan: ShotPlan;
  /** Shots whose `startFrame` did not match the derived value (the derived value wins). */
  startFrameMismatches: Array<{ id: string; declared: number; derived: number }>;
}

/**
 * Accept the flat Timeline format (e.g. written by an AI or another tool).
 * `startFrame` is treated as a hint: positions are always re-derived.
 */
export function fromTimeline(timeline: Timeline, rest: Pick<ShotPlan, 'assets'> & Partial<Omit<ShotPlan, 'shots' | 'fps' | 'width' | 'height' | 'version'>>, registry?: TransitionRegistry): FromTimelineResult {
  const shots = timeline.shots.map((t): Shot => {
    const metadata: JsonObject = { ...(t.metadata ?? {}) };
    const shot: Shot = { id: t.id, type: t.type, durationInFrames: t.durationInFrames };
    if (t.media !== undefined) shot.media = t.media;
    if (t.text !== undefined) shot.text = t.text;
    if (t.highlightedWords) shot.highlightedWords = [...t.highlightedWords];
    if (t.motionSkill !== undefined) shot.motionSkill = t.motionSkill;
    // A requested-but-unknown id is restored so validation can still report it.
    const requested = metadata.requestedTransition;
    delete metadata.requestedTransition;
    const transition = typeof requested === 'string' ? requested : t.transition;
    // `hard_cut` is the default: omitting it is equivalent and keeps plans minimal.
    if (transition !== undefined && transition !== DEFAULT_TRANSITION_ID) shot.transition = transition;
    if (t.intensity) shot.intensity = t.intensity;
    if (Array.isArray(metadata.sfxEvents)) shot.sfx = metadata.sfxEvents as unknown as Shot['sfx'];
    else if (t.sfx) shot.sfx = [{ sfx: t.sfx }];
    delete metadata.sfxEvents;
    for (const key of PAYLOAD_KEYS) {
      if (metadata[key] !== undefined) {
        (shot as unknown as Record<string, unknown>)[key] = metadata[key];
        delete metadata[key];
      }
    }
    if (Object.keys(metadata).length > 0) shot.metadata = metadata;
    return shot;
  });
  const plan: ShotPlan = { version: 1, fps: timeline.fps, width: timeline.width, height: timeline.height, ...rest, shots };
  const derived = getShotStartFrames(plan, registry);
  const startFrameMismatches = timeline.shots
    .map((t, i) => ({ id: t.id, declared: t.startFrame, derived: derived[i]! }))
    .filter((m) => m.declared !== m.derived);
  return { plan, startFrameMismatches };
}
