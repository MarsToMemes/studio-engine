/**
 * Pure editing operations on a ShotPlan. The UI only calls these; every
 * change produces a new plan (immutable), which is recompiled for preview.
 */
import {
  compileShotPlan,
  EDITORIAL_TRANSITIONS,
  getAvailableMotionSkills,
  toTimeline,
  type AssetKind,
  type EditorialTransition,
  type Intensity,
  type MotionSkill,
  type SfxEvent,
  type Shot,
  type ShotPlan,
  type ShotType,
  type ValidationIssue,
  type VideoProject,
} from '@studio-engine/scene-engine';

/** Shortest shot the editor allows, in seconds. */
export const MIN_SHOT_SECONDS = 0.5;

export function updateShot(plan: ShotPlan, id: string, patch: Partial<Shot>): ShotPlan {
  return {
    ...plan,
    shots: plan.shots.map((s) => {
      if (s.id !== id) return s;
      const next: Shot = { ...s, ...patch };
      // Empty values mean "unset" so the plan stays minimal and defaults apply.
      for (const key of Object.keys(patch) as Array<keyof Shot>) {
        const v = next[key];
        if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[key];
      }
      return next;
    }),
  };
}

export function setShotSeconds(plan: ShotPlan, id: string, seconds: number): ShotPlan {
  const safe = Number.isFinite(seconds) ? Math.max(MIN_SHOT_SECONDS, seconds) : MIN_SHOT_SECONDS;
  return updateShot(plan, id, { durationInFrames: Math.round(safe * plan.fps) });
}

/** "BILLIONS, land" → ["BILLIONS", "land"] */
export function setHighlightedWords(plan: ShotPlan, id: string, csv: string): ShotPlan {
  return updateShot(plan, id, { highlightedWords: csv.split(',').map((w) => w.trim()).filter(Boolean) });
}

export function setSkill(plan: ShotPlan, id: string, skillId: string): ShotPlan {
  // Parameters belong to the previous skill.
  return updateShot(plan, id, { motionSkill: skillId, motionParams: undefined });
}

export function setIntensity(plan: ShotPlan, id: string, intensity: Intensity | ''): ShotPlan {
  return updateShot(plan, id, { intensity: intensity || undefined });
}

export function setTransition(plan: ShotPlan, id: string, transition: string): ShotPlan {
  return updateShot(plan, id, { transition: transition === 'hard_cut' ? undefined : transition, transitionDurationInFrames: undefined });
}

export function setSfx(plan: ShotPlan, id: string, events: SfxEvent[]): ShotPlan {
  return updateShot(plan, id, { sfx: events });
}

export function setMapZoom(plan: ShotPlan, id: string, zoom: number): ShotPlan {
  const shot = plan.shots.find((s) => s.id === id);
  if (!shot?.map) return plan;
  return updateShot(plan, id, { map: { ...shot.map, zoom: Math.max(0, Math.min(12, zoom)) } });
}

const MEDIA_KINDS: Partial<Record<ShotType, readonly AssetKind[]>> = { image: ['image', 'svg'], document: ['image', 'svg'], video: ['video'] };

export function mediaOptions(plan: ShotPlan, type: ShotType): string[] {
  const kinds = MEDIA_KINDS[type];
  return kinds ? Object.values(plan.assets).filter((a) => kinds.includes(a.kind)).map((a) => a.id) : [];
}

/** Audio assets usable as SFX: everything audio except the narration and the music bed. */
export function sfxOptions(plan: ShotPlan): string[] {
  const reserved = new Set([plan.narration?.assetId, plan.music?.assetId]);
  return Object.values(plan.assets).filter((a) => a.kind === 'audio' && !reserved.has(a.id)).map((a) => a.id);
}

/** Only skills that exist AND apply to this shot type. */
export function skillOptions(type: ShotType): MotionSkill[] {
  return getAvailableMotionSkills({ shotType: type });
}

export function transitionOptions(): readonly EditorialTransition[] {
  return EDITORIAL_TRANSITIONS;
}

export function shotStartFrame(plan: ShotPlan, id: string): number {
  return toTimeline(plan).shots.find((s) => s.id === id)?.startFrame ?? 0;
}

/** Absolute frame range of a shot, end exclusive. */
export function shotRange(plan: ShotPlan, id: string): [number, number] {
  const s = toTimeline(plan).shots.find((x) => x.id === id);
  return s ? [s.startFrame, s.startFrame + s.durationInFrames] : [0, 1];
}

/**
 * A frame that shows what the shot looks like once it has "happened": after
 * the incoming transition and after the last editorial event of its motion
 * skill (keyword spoken, number landed…). Seeking there after an edit shows
 * the result instead of an empty entrance frame.
 */
export function posterFrame(plan: ShotPlan, project: VideoProject | undefined, id: string): number {
  const [start, end] = shotRange(plan, id);
  const scene = project?.scenes.find((s) => s.id === id);
  const transitionIn = scene?.transitionIn && scene.transitionIn.type !== 'cut' ? scene.transitionIn.durationInFrames : 0;
  const events = (scene?.metadata?.extra?.events as Array<{ at: number }> | undefined) ?? [];
  const lastEvent = events.reduce((m, e) => Math.max(m, e.at), 0);
  const settle = Math.round(plan.fps * 0.6);
  return Math.min(end - 1, start + Math.max(transitionIn + settle, lastEvent + settle));
}

export interface PreviewCompilation {
  project?: VideoProject;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  notes: string[];
  compileMs: number;
}

export function compilePreview(plan: ShotPlan): PreviewCompilation {
  const t0 = performance.now();
  const r = compileShotPlan(plan);
  const compileMs = performance.now() - t0;
  return r.ok
    ? { project: r.project, errors: [], warnings: [...r.planWarnings, ...r.validation.warnings], notes: r.notes, compileMs }
    : { errors: r.errors, warnings: r.warnings, notes: [], compileMs };
}
