/**
 * Timeline editing: pure layout and operations on a ShotPlan.
 *
 * The narration is one continuous file starting at frame 0, and shots are cut
 * against it. So the default trim is a ROLL edit (the cut between two shots
 * moves, the episode length and everything after it stay locked to the voice);
 * a RIPPLE edit (the shot changes length and pushes the rest) is explicit.
 */
import {
  normalizeWord,
  resolveShotTransitions,
  toTimeline,
  type SfxEvent,
  type Shot,
  type ShotPlan,
  type ShotType,
  type VideoProject,
} from '@studio-engine/scene-engine';
import { MIN_SHOT_SECONDS } from './plan';

export interface ShotBlock {
  id: string;
  index: number;
  type: ShotType;
  startFrame: number;
  durationInFrames: number;
  /** Frames of the incoming transition overlapping the previous shot (0 for a hard cut). */
  transitionInFrames: number;
  transition: string;
  label: string;
  motionSkill?: string;
  /** Skill actually applied by the engine, when it differs (fallback). */
  appliedSkill?: string;
  /** Editorial events of the applied skill, absolute frames. */
  events: Array<{ kind: string; frame: number }>;
  /** Highlighted words that the narration does not say during the shot. */
  offSyncWords: string[];
}

export interface SfxMarker {
  shotId: string;
  index: number;
  sfx: string;
  frame: number;
  gainDb: number;
}

export interface WordMark {
  text: string;
  startFrame: number;
  endFrame: number;
}

export interface TimelineLayout {
  fps: number;
  durationInFrames: number;
  shots: ShotBlock[];
  sfx: SfxMarker[];
  words: WordMark[];
}

const msToFrame = (ms: number, fps: number) => Math.round((ms / 1000) * fps);

export function narrationWords(plan: ShotPlan): WordMark[] {
  return (plan.narration?.words ?? []).map((w) => ({ text: w.text, startFrame: msToFrame(w.startMs, plan.fps), endFrame: Math.max(msToFrame(w.startMs, plan.fps) + 1, msToFrame(w.endMs, plan.fps)) }));
}

/** Everything the timeline draws, derived from the plan (and the compiled project for skill events). */
export function layoutTimeline(plan: ShotPlan, project?: VideoProject): TimelineLayout {
  const timeline = toTimeline(plan);
  const transitions = resolveShotTransitions(plan);
  const words = narrationWords(plan);
  const scenes = new Map((project?.scenes ?? []).map((s) => [s.id, s]));
  const shots = timeline.shots.map((t, index): ShotBlock => {
    const shot = plan.shots[index]!;
    const extra = scenes.get(t.id)?.metadata?.extra as { events?: Array<{ kind: string; at: number }>; appliedSkill?: string } | undefined;
    const end = t.startFrame + t.durationInFrames;
    const spoken = new Set(words.filter((w) => w.startFrame >= t.startFrame && w.startFrame < end).map((w) => normalizeWord(w.text)));
    const offSyncWords = words.length ? (shot.highlightedWords ?? []).filter((w) => !spoken.has(normalizeWord(w))) : [];
    return {
      id: t.id,
      index,
      type: t.type,
      startFrame: t.startFrame,
      durationInFrames: t.durationInFrames,
      transitionInFrames: index > 0 ? (transitions[index]!.transition?.durationInFrames ?? 0) : 0,
      transition: t.transition ?? 'hard_cut',
      label: shot.text ?? shot.number?.label ?? shot.chart?.title ?? shot.document?.source ?? t.id,
      ...(shot.motionSkill ? { motionSkill: shot.motionSkill } : {}),
      ...(extra?.appliedSkill && extra.appliedSkill !== shot.motionSkill ? { appliedSkill: extra.appliedSkill } : {}),
      events: (extra?.events ?? []).map((e) => ({ kind: e.kind, frame: t.startFrame + e.at })),
      offSyncWords,
    };
  });
  const sfx = plan.shots.flatMap((shot, i) => (shot.sfx ?? []).map((e, index): SfxMarker => ({ shotId: shot.id, index, sfx: e.sfx, frame: shots[i]!.startFrame + (e.at ?? 0), gainDb: e.gainDb ?? -6 })));
  return { fps: plan.fps, durationInFrames: timeline.durationInFrames, shots, sfx, words };
}

/** Shot visible at `frame`: during a transition overlap the incoming shot wins (same rule as the preview). */
export function shotAtFrame<T extends { startFrame: number }>(shots: readonly T[], frame: number): T | undefined {
  let found: T | undefined;
  for (const s of shots) if (frame >= s.startFrame) found = s;
  return found;
}

// ---------------------------------------------------------------------------
// Operations (immutable)
// ---------------------------------------------------------------------------

const minFrames = (plan: ShotPlan) => Math.round(MIN_SHOT_SECONDS * plan.fps);

function withShots(plan: ShotPlan, shots: Shot[]): ShotPlan {
  return { ...plan, shots };
}

/**
 * Moves the cut at the END of shot `id` by `delta` frames.
 * - `roll` (default): the next shot absorbs the change, nothing after it moves.
 * - `ripple`: only this shot changes; every following shot moves.
 * Clamped so no shot gets shorter than the editor minimum.
 */
export function trimShotEnd(plan: ShotPlan, id: string, delta: number, mode: 'roll' | 'ripple' = 'roll'): ShotPlan {
  const i = plan.shots.findIndex((s) => s.id === id);
  if (i < 0 || !Number.isFinite(delta)) return plan;
  const min = minFrames(plan);
  const shot = plan.shots[i]!;
  const next = plan.shots[i + 1];
  let d = Math.round(delta);
  d = Math.max(d, min - shot.durationInFrames);
  if (mode === 'roll' && next) d = Math.min(d, next.durationInFrames - min);
  if (d === 0) return plan;
  return withShots(
    plan,
    plan.shots.map((s, k) => {
      if (k === i) return { ...s, durationInFrames: s.durationInFrames + d };
      if (mode === 'roll' && k === i + 1) return { ...s, durationInFrames: s.durationInFrames - d };
      return s;
    }),
  );
}

/** Moves shot `id` to position `toIndex` (0-based, in the final order). */
export function moveShot(plan: ShotPlan, id: string, toIndex: number): ShotPlan {
  const from = plan.shots.findIndex((s) => s.id === id);
  const to = Math.max(0, Math.min(plan.shots.length - 1, Math.round(toIndex)));
  if (from < 0 || from === to) return plan;
  const shots = [...plan.shots];
  const [moved] = shots.splice(from, 1);
  shots.splice(to, 0, moved!);
  return withShots(plan, shots);
}

export function uniqueShotId(plan: ShotPlan, base: string): string {
  const ids = new Set(plan.shots.map((s) => s.id));
  const stem = base.replace(/-\d+$/, '');
  for (let n = 2; ; n++) if (!ids.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

/** Inserts a copy right after the shot. Returns the plan and the new id. */
export function duplicateShot(plan: ShotPlan, id: string): { plan: ShotPlan; id: string } {
  const i = plan.shots.findIndex((s) => s.id === id);
  if (i < 0) return { plan, id };
  const copy: Shot = { ...structuredClone(plan.shots[i]!), id: uniqueShotId(plan, id) };
  const shots = [...plan.shots];
  shots.splice(i + 1, 0, copy);
  return { plan: withShots(plan, shots), id: copy.id };
}

/** Removes a shot (never the last one). Returns the plan and the id to select next. */
export function deleteShot(plan: ShotPlan, id: string): { plan: ShotPlan; selectId: string } {
  const i = plan.shots.findIndex((s) => s.id === id);
  if (i < 0 || plan.shots.length <= 1) return { plan, selectId: id };
  const shots = plan.shots.filter((s) => s.id !== id);
  return { plan: withShots(plan, shots), selectId: shots[Math.min(i, shots.length - 1)]!.id };
}

function setShotSfx(shot: Shot, events: SfxEvent[]): Shot {
  const next = { ...shot };
  if (events.length) next.sfx = events;
  else delete next.sfx;
  return next;
}

/**
 * Moves an SFX event to an absolute frame. The event is re-attached to the
 * shot visible at that frame, so it stays where it was dropped even if shots
 * are later trimmed around it.
 */
export function moveSfx(plan: ShotPlan, shotId: string, index: number, frame: number): ShotPlan {
  const layout = layoutTimeline(plan);
  const source = plan.shots.find((s) => s.id === shotId);
  const event = source?.sfx?.[index];
  if (!event) return plan;
  const f = Math.max(0, Math.min(layout.durationInFrames - 1, Math.round(frame)));
  const target = shotAtFrame(layout.shots, f)!;
  const moved: SfxEvent = { ...event, at: f - target.startFrame };
  if (moved.at === 0) delete moved.at;
  return withShots(
    plan,
    plan.shots.map((s) => {
      let events = s.sfx ?? [];
      if (s.id === shotId) events = events.filter((_, k) => k !== index);
      if (s.id === target.id) events = [...events, moved].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
      return events === s.sfx ? s : setShotSfx(s, events);
    }),
  );
}

export function addSfxAt(plan: ShotPlan, sfx: string, frame: number): ShotPlan {
  const layout = layoutTimeline(plan);
  const f = Math.max(0, Math.min(layout.durationInFrames - 1, Math.round(frame)));
  const target = shotAtFrame(layout.shots, f)!;
  const at = f - target.startFrame;
  return withShots(
    plan,
    plan.shots.map((s) => (s.id === target.id ? setShotSfx(s, [...(s.sfx ?? []), at ? { sfx, at } : { sfx }].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) : s)),
  );
}

export function removeSfx(plan: ShotPlan, shotId: string, index: number): ShotPlan {
  return withShots(plan, plan.shots.map((s) => (s.id === shotId ? setShotSfx(s, (s.sfx ?? []).filter((_, k) => k !== index)) : s)));
}

// ---------------------------------------------------------------------------
// Geometry and snapping
// ---------------------------------------------------------------------------

export const ZOOM = { min: 1, max: 60, default: 6 } as const;

export function fitZoom(durationInFrames: number, widthPx: number): number {
  return Math.max(0.2, Math.min(ZOOM.max, widthPx / Math.max(1, durationInFrames)));
}

/** Snap targets: shot edges and narration word starts. */
export function snapTargets(layout: TimelineLayout, playhead?: number): number[] {
  const t = new Set<number>([0, layout.durationInFrames]);
  for (const s of layout.shots) {
    t.add(s.startFrame);
    t.add(s.startFrame + s.durationInFrames);
  }
  for (const w of layout.words) t.add(w.startFrame);
  if (playhead !== undefined) t.add(playhead);
  return [...t].sort((a, b) => a - b);
}

/** Nearest target within `thresholdFrames`, else the frame itself. */
export function snapFrame(frame: number, targets: readonly number[], thresholdFrames: number, exclude?: number): number {
  let best = frame;
  let bestDist = thresholdFrames;
  for (const t of targets) {
    if (t === exclude) continue;
    const d = Math.abs(t - frame);
    if (d <= bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

/** Index a dragged shot lands on, from the frame under its centre. */
export function dropIndex(layout: TimelineLayout, draggedId: string, centerFrame: number): number {
  const others = layout.shots.filter((s) => s.id !== draggedId);
  let index = 0;
  for (const s of others) if (centerFrame > s.startFrame + s.durationInFrames / 2) index++;
  return index;
}

export function formatTime(frame: number, fps: number): string {
  const total = Math.max(0, frame) / fps;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
