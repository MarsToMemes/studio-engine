/**
 * Editorial layer helpers (ShotPlan version 2): where the voice really plays,
 * the effective music cues, controlled silences, and v1 → v2 migration.
 */
import type { ControlledSilence, EditorialScene, MusicCue, Shot, ShotPlan, TranscriptWord } from './types.js';
import type { EditorialIntent } from './vocabulary.js';

const msToFrame = (ms: number, fps: number) => Math.round((ms / 1000) * fps);
const frameToMs = (frame: number, fps: number) => (frame / fps) * 1000;

export interface VoiceRange {
  id: string;
  /** Timeline frame where this range of the narration file plays. */
  startFrame: number;
  /** First frame of the narration file played (at plan fps). */
  sourceStartFrame: number;
  durationInFrames: number;
}

export interface ResolvedNarration {
  /** Words in TIMELINE milliseconds (words outside every segment are cut and dropped). */
  words: TranscriptWord[];
  /** Ranges of the narration file on the timeline. Empty without narration. */
  voice: VoiceRange[];
  segmented: boolean;
}

/**
 * Where the voice really is on the timeline. Without segments the narration
 * is one continuous file from frame 0 (version 1 behaviour).
 */
export function resolveNarration(plan: Pick<ShotPlan, 'fps' | 'narration' | 'assets'>): ResolvedNarration {
  const n = plan.narration;
  if (!n) return { words: [], voice: [], segmented: false };
  const fps = plan.fps;
  // Tolerates malformed input (validation reports it): only well-formed entries are used.
  const words = Array.isArray(n.words) ? n.words.filter((w) => typeof w?.startMs === 'number' && typeof w.endMs === 'number') : [];
  const validSegments = Array.isArray(n.segments)
    ? n.segments.filter((s) => typeof s?.sourceStartMs === 'number' && typeof s.sourceEndMs === 'number' && s.sourceEndMs > s.sourceStartMs && Number.isInteger(s.startFrame))
    : [];
  if (!validSegments.length) {
    const seconds = plan.assets[n.assetId]?.durationInSeconds;
    const lastWord = words.length ? words[words.length - 1]!.endMs : 0;
    const durationInFrames = Math.max(1, msToFrame(seconds !== undefined ? seconds * 1000 : lastWord, fps));
    return { words, voice: [{ id: 'narration', startFrame: 0, sourceStartFrame: 0, durationInFrames }], segmented: false };
  }
  const segments = [...validSegments].sort((a, b) => a.startFrame - b.startFrame);
  const voice = segments.map((s): VoiceRange => {
    const sourceStartFrame = msToFrame(s.sourceStartMs, fps);
    return { id: s.id, startFrame: s.startFrame, sourceStartFrame, durationInFrames: Math.max(1, msToFrame(s.sourceEndMs, fps) - sourceStartFrame) };
  });
  const placed: TranscriptWord[] = [];
  for (const w of words) {
    const s = segments.find((seg) => w.startMs >= seg.sourceStartMs && w.startMs < seg.sourceEndMs);
    if (!s) continue;
    const offset = frameToMs(s.startFrame, fps) - s.sourceStartMs;
    placed.push({ ...w, startMs: Math.round(w.startMs + offset), endMs: Math.round(Math.min(w.endMs, s.sourceEndMs) + offset) });
  }
  placed.sort((a, b) => a.startMs - b.startMs);
  return { words: placed, voice, segmented: true };
}

/**
 * Effective music cues (`starts` = `getShotStartFrames(plan)`): the explicit `music.cues`, or one cue at each shot
 * where `musicState` changes (a shot without a state keeps the previous one).
 */
export function deriveMusicCues(plan: ShotPlan, starts: readonly number[]): MusicCue[] {
  if (!plan.music) return [];
  if (plan.music.cues) return [...plan.music.cues].sort((a, b) => a.atFrame - b.atFrame);
  const cues: MusicCue[] = [];
  let current: string | undefined;
  plan.shots.forEach((shot, i) => {
    if (!shot.musicState || shot.musicState === current) return;
    current = shot.musicState;
    cues.push({ id: `cue-${shot.id}`, atFrame: starts[i]!, state: shot.musicState });
  });
  return cues;
}

export interface ResolvedSilence {
  silence: ControlledSilence;
  startFrame: number;
  endFrame: number;
}

/** Controlled silences in absolute frames (each ends where its `beforeShotId` starts). */
export function resolveSilences(plan: ShotPlan, starts: readonly number[]): ResolvedSilence[] {
  const index = new Map(plan.shots.map((s, i) => [s.id, i]));
  return (Array.isArray(plan.silences) ? plan.silences : [])
    .filter((s) => typeof s?.durationInFrames === 'number' && index.has(s.beforeShotId))
    .map((silence) => {
      const endFrame = starts[index.get(silence.beforeShotId)!]!;
      return { silence, startFrame: Math.max(0, endFrame - silence.durationInFrames), endFrame };
    })
    .sort((a, b) => a.startFrame - b.startFrame);
}

// ---------------------------------------------------------------------------
// v1 → v2 migration
// ---------------------------------------------------------------------------

/** Same rule as `isHookShot` (validate.ts), duplicated to avoid an import cycle. */
const isHook = (shot: Shot, index: number) => shot.metadata?.role === 'hook' || (index === 0 && shot.metadata?.role === undefined);

/** Default intent of a shot type when nothing else is known. */
const INTENT_BY_TYPE: Record<Shot['type'], EditorialIntent> = {
  image: 'fact',
  video: 'context',
  text: 'important_fact',
  number: 'number',
  document: 'proof',
  chart: 'statistic',
  map: 'location',
  revelation: 'revelation',
  chapter: 'chapter',
};

/**
 * Upgrades a version 1 plan to a version 2 DRAFT, keeping every v1 field.
 * It does not invent editorial reasoning:
 * - intents are guessed from shot types and marked `decidedBy: 'migration'`;
 * - `reasons` and `visualHierarchy` are left empty, so a `stage: 'final'`
 *   validation lists exactly what the editor brain (or a human) must fill in.
 * Already-v2 plans are returned unchanged.
 */
export function migrateShotPlan(plan: ShotPlan): ShotPlan {
  if (plan.version === 2) return plan;
  const scene: EditorialScene = { id: 'scene-1', purpose: '' };
  return {
    ...plan,
    version: 2,
    scenes: [scene],
    shots: plan.shots.map((shot, i) => ({
      ...shot,
      sceneId: shot.sceneId ?? scene.id,
      editorialIntent: shot.editorialIntent ?? (isHook(shot, i) ? 'hook' : INTENT_BY_TYPE[shot.type]),
      decidedBy: shot.decidedBy ?? 'migration',
    })),
  };
}
