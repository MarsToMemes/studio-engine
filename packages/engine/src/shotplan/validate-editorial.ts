/**
 * Editorial validation: the VIDEO_EDITING_BIBLE.md rules that the plan data
 * makes checkable. Called by `validateShotPlan` once the plan is structurally
 * sound (valid shots, durations and fps).
 *
 * Blocking editorial rules (DIR-01, SCENE-01, HIER-01, SRC-01/02) are errors
 * at `stage: 'final'` and warnings at `stage: 'draft'` (the default), so a
 * plan being written can still be previewed.
 */
import { isFiniteNumber, isNonEmptyString, isNonNegativeInteger, isObject, isOneOf, isPositiveInteger } from '../validation/guards.js';
import type { IssueCollector } from '../validation/issues.js';
import type { TransitionRegistry } from '../transitions/registry.js';
import { resolveNarration, resolveSilences } from './editorial.js';
import { getShotPlanDuration, getShotStartFrames } from './timeline.js';
import type { ShotPlan } from './types.js';
import { BEATS, SHOT_CAMERA_MOVES, DECIDED_BY, EDITORIAL_INTENTS, FRAMINGS, isEditorialLevel, MUSIC_STATES, RESOLVING_BEATS, SILENCE_KINDS, type EditorialIntent } from './vocabulary.js';

export type ValidationStage = 'draft' | 'final';

/** Seconds (bible §5, §13, §24). */
export const EDITORIAL_LIMITS = {
  maxHoldSeconds: 8,
  maxSameTypeRun: 3,
  chapterCard: { min: 1, max: 1.5 },
  maxChapterTitleWords: 6,
  silence: { min: 0.3, max: 0.6, minGapSeconds: 60 },
  /** A word may overlap a cut by this many frames (RHY-08). */
  cutWordToleranceFrames: 2,
} as const;

/** Intents strong enough to follow a controlled silence (SIL-04). */
const SILENCE_PAYOFF: readonly EditorialIntent[] = ['revelation', 'contradiction', 'number', 'proof', 'important_fact', 'hook'];

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function validateEditorialLayer(plan: ShotPlan, issues: IssueCollector, stage: ValidationStage, registry?: TransitionRegistry): void {
  const fps = plan.fps;
  const v2 = plan.version === 2;
  const blocking = (path: string, code: string, message: string) => (stage === 'final' ? issues.error(path, code, message) : issues.warn(path, code, message));
  const shots = plan.shots;
  const starts = getShotStartFrames(plan, registry);
  const duration = getShotPlanDuration(plan, registry);
  const sp = (i: number) => `shots[${i}]`;

  // --- Per-shot editorial fields (checked in every version when present) -----
  shots.forEach((shot, i) => {
    const p = sp(i);
    if (shot.editorialIntent !== undefined && !isOneOf(shot.editorialIntent, EDITORIAL_INTENTS)) issues.error(`${p}.editorialIntent`, 'editorial.intent.invalid', `unknown editorial intent "${String(shot.editorialIntent)}"`);
    if (shot.beat !== undefined && !isOneOf(shot.beat, BEATS)) issues.error(`${p}.beat`, 'editorial.beat.invalid', `beat must be one of ${BEATS.join(', ')}`);
    if (shot.musicState !== undefined && !isOneOf(shot.musicState, MUSIC_STATES)) issues.error(`${p}.musicState`, 'music.state.invalid', `musicState must be one of ${MUSIC_STATES.join(', ')}`);
    if (shot.framing !== undefined && !isOneOf(shot.framing, FRAMINGS)) issues.error(`${p}.framing`, 'shot.framing', `framing must be one of ${FRAMINGS.join(', ')}`);
    if (shot.decidedBy !== undefined && !isOneOf(shot.decidedBy, DECIDED_BY)) issues.error(`${p}.decidedBy`, 'editorial.decidedBy', `decidedBy must be one of ${DECIDED_BY.join(', ')}`);
    if (shot.camera !== undefined && !isOneOf(shot.camera, SHOT_CAMERA_MOVES)) issues.warn(`${p}.camera`, 'camera.unknown', `unknown camera move "${String(shot.camera)}"; the shot stays static`);
    if (shot.importance !== undefined && !isEditorialLevel(shot.importance)) issues.error(`${p}.importance`, 'editorial.level', 'importance is a level from 1 to 5');
    if (shot.analysis !== undefined) {
      if (!isObject(shot.analysis)) issues.error(`${p}.analysis`, 'editorial.analysis', 'analysis must be an object');
      else for (const k of ['surprise', 'informationDensity', 'visualPotential', 'tension'] as const) {
        const v = shot.analysis[k];
        if (v !== undefined && !isEditorialLevel(v)) issues.error(`${p}.analysis.${k}`, 'editorial.level', `${k} is a level from 1 to 5 (heuristic, not a measurement)`);
      }
    }
    if (shot.focus !== undefined && !(isObject(shot.focus) && [shot.focus.x, shot.focus.y].every((v) => isFiniteNumber(v) && v >= 0 && v <= 100))) issues.error(`${p}.focus`, 'shot.focus', 'focus needs x and y in percent (0..100)');
    if (shot.hold !== undefined && !isNonEmptyString(shot.hold)) issues.error(`${p}.hold`, 'shot.hold', 'hold is the reason of an intentional long shot');
    else if (shot.hold && shot.type !== 'video' && shot.durationInFrames / fps > EDITORIAL_LIMITS.maxHoldSeconds) {
      issues.warn(`${p}.durationInFrames`, 'pacing.hold.max', `intentional long shot of ${(shot.durationInFrames / fps).toFixed(1)} s (max ${EDITORIAL_LIMITS.maxHoldSeconds} s outside continuous video)`);
    }

    // Chapter cards (every version).
    if (shot.type === 'chapter') {
      const s = shot.durationInFrames / fps;
      if (s < EDITORIAL_LIMITS.chapterCard.min || s > EDITORIAL_LIMITS.chapterCard.max) issues.warn(`${p}.durationInFrames`, 'chapter.duration', `chapter card lasts ${s.toFixed(2)} s (recommended ${EDITORIAL_LIMITS.chapterCard.min}–${EDITORIAL_LIMITS.chapterCard.max} s)`);
      if (shot.text && countWords(shot.text) > EDITORIAL_LIMITS.maxChapterTitleWords) issues.warn(`${p}.text`, 'chapter.title.long', `chapter title has ${countWords(shot.text)} words (max ${EDITORIAL_LIMITS.maxChapterTitleWords})`);
    }
  });

  // --- Visual contrast: runs of the same shot type (VAR-01) ------------------
  let run = 1;
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1]!;
    const b = shots[i]!;
    const sameSequence = a.sequence !== undefined && a.sequence === b.sequence;
    run = a.type === b.type && !sameSequence ? run + 1 : 1;
    if (run === EDITORIAL_LIMITS.maxSameTypeRun + 1) issues.warn(sp(i), 'variety.consecutive', `${run} ${b.type} shots in a row; alternate the visual language or mark an intentional sequence`);
  }

  // --- Narration: segments, and cuts inside spoken words (RHY-08) -----------
  const segments = plan.narration?.segments;
  if (segments !== undefined) {
    if (!Array.isArray(segments)) issues.error('narration.segments', 'narration.segments.invalid', 'segments must be an array');
    else {
      const seen = new Set<string>();
      segments.forEach((s, i) => {
        const p = `narration.segments[${i}]`;
        if (!isObject(s) || !isNonEmptyString(s.id) || !isFiniteNumber(s.sourceStartMs) || !isFiniteNumber(s.sourceEndMs) || !isNonNegativeInteger(s.startFrame)) {
          return issues.error(p, 'narration.segment.invalid', 'segment needs id, sourceStartMs, sourceEndMs and an integer startFrame >= 0');
        }
        if (seen.has(s.id)) issues.error(`${p}.id`, 'narration.segment.duplicate', `duplicate segment id "${s.id}"`);
        seen.add(s.id);
        if (s.sourceStartMs < 0 || s.sourceEndMs <= s.sourceStartMs) issues.error(p, 'narration.segment.range', 'sourceEndMs must be greater than sourceStartMs >= 0');
      });
    }
  }
  const narration = resolveNarration(plan);
  if (narration.segmented) {
    for (let i = 1; i < narration.voice.length; i++) {
      const prev = narration.voice[i - 1]!;
      if (narration.voice[i]!.startFrame < prev.startFrame + prev.durationInFrames) issues.error(`narration.segments`, 'narration.segment.overlap', `segment "${narration.voice[i]!.id}" starts before "${prev.id}" ends (two voices at once)`);
    }
    const last = narration.voice[narration.voice.length - 1];
    if (last && last.startFrame + last.durationInFrames > duration) issues.warn('narration.segments', 'narration.segment.outside', `segment "${last.id}" ends after the episode`);
  }
  const words = narration.words.map((w) => ({ text: w.text, start: Math.round((w.startMs / 1000) * fps), end: Math.round((w.endMs / 1000) * fps) }));
  if (words.length) {
    const tol = EDITORIAL_LIMITS.cutWordToleranceFrames;
    for (let i = 1; i < shots.length; i++) {
      const cut = starts[i]!;
      const w = words.find((x) => cut > x.start + tol && cut < x.end - tol);
      if (w) issues.warn(`${sp(i)}.durationInFrames`, 'pacing.cut.word', `the cut at frame ${cut} falls inside the word "${w.text}"; cut at the start of a word or in a pause`);
    }
  }

  // --- Music cues ------------------------------------------------------------
  const cues = plan.music?.cues;
  if (cues !== undefined) {
    if (!Array.isArray(cues)) issues.error('music.cues', 'music.cues.invalid', 'cues must be an array');
    else cues.forEach((c, i) => {
      const p = `music.cues[${i}]`;
      if (!isObject(c) || !isNonEmptyString(c.id) || !isNonNegativeInteger(c.atFrame) || !isOneOf(c.state, MUSIC_STATES)) return issues.error(p, 'music.cue.invalid', `cue needs id, an integer atFrame >= 0 and a state (${MUSIC_STATES.join(', ')})`);
      if (c.atFrame >= duration) issues.warn(`${p}.atFrame`, 'music.cue.outside', 'cue starts after the episode ends');
    });
  }

  // --- Controlled silences (SIL) ---------------------------------------------
  const silences = plan.silences;
  if (silences !== undefined) {
    const shotIds = new Set(shots.map((s) => s.id));
    if (!Array.isArray(silences)) issues.error('silences', 'silences.invalid', 'silences must be an array');
    else {
      silences.forEach((s, i) => {
        const p = `silences[${i}]`;
        if (!isObject(s) || !isNonEmptyString(s.id) || !isPositiveInteger(s.durationInFrames) || !Array.isArray(s.kinds) || s.kinds.length === 0 || !s.kinds.every((k) => isOneOf(k, SILENCE_KINDS))) {
          return issues.error(p, 'silence.invalid', `silence needs id, a positive integer durationInFrames and kinds (${SILENCE_KINDS.join(', ')})`);
        }
        if (!shotIds.has(s.beforeShotId)) return issues.error(`${p}.beforeShotId`, 'silence.shot.unknown', `shot "${s.beforeShotId}" does not exist`);
        const seconds = s.durationInFrames / fps;
        if (seconds < EDITORIAL_LIMITS.silence.min || seconds > EDITORIAL_LIMITS.silence.max) issues.warn(`${p}.durationInFrames`, 'silence.duration', `controlled silence of ${seconds.toFixed(2)} s (recommended ${EDITORIAL_LIMITS.silence.min}–${EDITORIAL_LIMITS.silence.max} s, never more than 1 s)`);
        const next = shots.find((x) => x.id === s.beforeShotId)!;
        const strong = (next.editorialIntent && SILENCE_PAYOFF.includes(next.editorialIntent)) || next.type === 'revelation' || (next.sfx ?? []).some((e) => (e.at ?? 0) <= Math.round(fps * 0.2));
        if (!strong) issues.warn(p, 'silence.payoff', `the silence is not followed by a strong event ("${next.id}" is not a revelation and has no impact at its start)`);
      });
      const resolved = resolveSilences(plan, starts);
      const chapterOf = chapterIndex(plan);
      for (let i = 1; i < resolved.length; i++) {
        const a = resolved[i - 1]!;
        const b = resolved[i]!;
        const tooClose = (b.startFrame - a.startFrame) / fps < EDITORIAL_LIMITS.silence.minGapSeconds;
        const ca = chapterOf.get(a.silence.beforeShotId);
        const sameChapter = ca !== undefined && ca === chapterOf.get(b.silence.beforeShotId);
        if (tooClose || sameChapter) issues.warn(`silences`, 'silence.frequency', `silences "${a.silence.id}" and "${b.silence.id}" are ${sameChapter ? 'in the same chapter' : `less than ${EDITORIAL_LIMITS.silence.minGapSeconds} s apart`}; use silence sparingly`);
      }
      for (const r of resolved) {
        const spoken = words.find((w) => w.end > r.startFrame && w.start < r.endFrame);
        if (spoken) issues.warn('silences', 'silence.voice', `the voice says "${spoken.text}" during silence "${r.silence.id}": place the narration segments around it`);
      }
    }
  }

  if (!v2) return;

  // ===========================================================================
  // Version 2: the editorial plan is mandatory.
  // ===========================================================================
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  if (!Array.isArray(plan.scenes) || scenes.length === 0) blocking('scenes', 'scene.missing', 'a version 2 plan needs scenes (every shot belongs to a scene with a purpose)');
  const chapters = Array.isArray(plan.chapters) ? plan.chapters : [];
  const chapterIds = new Set<string>();
  chapters.forEach((c, i) => {
    if (!isObject(c) || !isNonEmptyString(c.id) || !isNonEmptyString(c.title)) return issues.error(`chapters[${i}]`, 'chapter.invalid', 'chapter needs an id and a title');
    if (chapterIds.has(c.id)) issues.error(`chapters[${i}].id`, 'chapter.duplicate', `duplicate chapter id "${c.id}"`);
    chapterIds.add(c.id);
    if (countWords(c.title) > EDITORIAL_LIMITS.maxChapterTitleWords) issues.warn(`chapters[${i}].title`, 'chapter.title.long', `chapter title has ${countWords(c.title)} words (max ${EDITORIAL_LIMITS.maxChapterTitleWords})`);
  });
  const motifIds = new Set((plan.memory?.visualMotifs ?? []).map((m) => m.id));
  const sceneById = new Map<string, (typeof scenes)[number]>();
  scenes.forEach((s, i) => {
    const p = `scenes[${i}]`;
    if (!isObject(s) || !isNonEmptyString(s.id)) return issues.error(p, 'scene.invalid', 'scene needs an id');
    if (sceneById.has(s.id)) issues.error(`${p}.id`, 'scene.duplicate', `duplicate scene id "${s.id}"`);
    sceneById.set(s.id, s);
    if (!isNonEmptyString(s.purpose)) blocking(`${p}.purpose`, 'scene.purpose.missing', `scene "${s.id}" has no narrative purpose`);
    if (s.chapterId !== undefined && !chapterIds.has(s.chapterId)) issues.error(`${p}.chapterId`, 'chapter.unknown', `chapter "${s.chapterId}" does not exist`);
    for (const m of s.motifs ?? []) if (!motifIds.has(m)) issues.error(`${p}.motifs`, 'memory.motif.unknown', `motif "${m}" is not in memory.visualMotifs`);
  });
  for (const c of plan.memory?.callbackCandidates ?? []) if (!motifIds.has(c.motifId)) issues.error('memory.callbackCandidates', 'memory.motif.unknown', `motif "${c.motifId}" is not in memory.visualMotifs`);

  // Every shot: intent, reason, scene, hierarchy.
  const shotScene: Array<string | undefined> = [];
  shots.forEach((shot, i) => {
    const p = sp(i);
    if (shot.editorialIntent === undefined) blocking(`${p}.editorialIntent`, 'editorial.intent.missing', `shot "${shot.id}" has no editorial intent`);
    if (!isNonEmptyString(shot.reasons?.shot)) blocking(`${p}.reasons.shot`, 'editorial.reason.missing', `shot "${shot.id}" does not say what the viewer must understand, feel or discover`);
    if (!isNonEmptyString(shot.visualHierarchy?.primary)) blocking(`${p}.visualHierarchy.primary`, 'hierarchy.primary.missing', `shot "${shot.id}" does not declare its primary visual element`);
    if (shot.sceneId === undefined) blocking(`${p}.sceneId`, 'scene.missing', `shot "${shot.id}" belongs to no scene`);
    else if (!sceneById.has(shot.sceneId)) issues.error(`${p}.sceneId`, 'scene.unknown', `scene "${shot.sceneId}" does not exist`);
    shotScene.push(shot.sceneId !== undefined && sceneById.has(shot.sceneId) ? shot.sceneId : undefined);
  });

  // Scenes and chapters are contiguous.
  const contiguity = (keys: Array<string | undefined>, code: string, what: string) => {
    const closed = new Set<string>();
    keys.forEach((k, i) => {
      const prev = keys[i - 1];
      if (prev !== undefined && prev !== k) closed.add(prev);
      if (k !== undefined && closed.has(k)) issues.error(`${sp(i)}.sceneId`, code, `${what} "${k}" is split: its shots must be contiguous`);
    });
  };
  contiguity(shotScene, 'scene.contiguous', 'scene');
  contiguity(
    shotScene.map((s) => (s ? sceneById.get(s)?.chapterId : undefined)),
    'chapter.contiguous',
    'chapter',
  );

  // SCENE-02 and REV-02: beats.
  for (const scene of scenes) {
    if (!isObject(scene) || !isNonEmptyString(scene.id)) continue;
    const inScene = shots.filter((s) => s.sceneId === scene.id);
    if (!inScene.length) continue;
    const beats = new Set(inScene.map((s) => s.beat));
    if (!beats.has('setup') || !RESOLVING_BEATS.some((b) => beats.has(b))) {
      issues.warn(`scenes[${scenes.indexOf(scene)}]`, 'scene.beats', `scene "${scene.id}" needs a setup beat and a resolving beat (${RESOLVING_BEATS.join(', ')})`);
    }
    inScene.forEach((shot, k) => {
      if (shot.editorialIntent !== 'revelation') return;
      const prepared = inScene.slice(0, k).some((s) => s.beat === 'setup' || s.beat === 'contradiction' || s.editorialIntent === 'contradiction');
      if (!prepared) issues.warn(sp(shots.indexOf(shot)), 'reveal.setup', `revelation "${shot.id}" has no setup or contradiction before it in its scene`);
    });
  }

  // MUS-03: music states.
  if (plan.music) {
    let previous: string | undefined;
    shots.forEach((shot, i) => {
      if (shot.musicState === undefined) {
        issues.warn(`${sp(i)}.musicState`, 'music.state.missing', `shot "${shot.id}" has no music state`);
        return;
      }
      const sceneStart = i === 0 || shots[i - 1]!.sceneId !== shot.sceneId;
      // A change is expected on a revelation and right after it (the music returns, bible MUS-04).
      const aroundReveal = shot.editorialIntent === 'revelation' || shots[i - 1]?.editorialIntent === 'revelation';
      if (previous !== undefined && shot.musicState !== previous && !sceneStart && !aroundReveal) {
        issues.warn(`${sp(i)}.musicState`, 'music.state.change', `music changes from ${previous} to ${shot.musicState} inside a scene, away from a revelation`);
      }
      previous = shot.musicState;
    });
  }

  // SRC-01 / SRC-02: rights of every asset.
  for (const [id, asset] of Object.entries(plan.assets)) {
    if (!isObject(asset)) continue; // reported by the structural validation
    const src = asset.source;
    if (!src?.license || typeof src.commercialUse !== 'boolean') blocking(`assets.${id}.source`, 'asset.license.missing', `asset "${id}" has no recorded license (source.license and source.commercialUse)`);
    else if (!src.commercialUse) blocking(`assets.${id}.source`, 'asset.license.noncommercial', `asset "${id}" cannot be used commercially`);
  }
}

/** Shot id → chapter id (through its scene). */
function chapterIndex(plan: ShotPlan): Map<string, string> {
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  const sceneChapter = new Map(scenes.filter((s) => isObject(s) && isNonEmptyString(s.chapterId)).map((s) => [s.id, s.chapterId!]));
  const out = new Map<string, string>();
  for (const shot of plan.shots) {
    const c = shot.sceneId ? sceneChapter.get(shot.sceneId) : undefined;
    if (c) out.set(shot.id, c);
  }
  return out;
}

/** Ids of the issue codes that `stage` turns into errors. */
export const STAGE_BLOCKING_CODES = ['editorial.intent.missing', 'editorial.reason.missing', 'scene.missing', 'scene.purpose.missing', 'hierarchy.primary.missing', 'asset.license.missing', 'asset.license.noncommercial'] as const;

