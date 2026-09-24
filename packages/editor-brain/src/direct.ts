/**
 * The editor brain, end to end:
 *
 *   EDITORIAL ANALYZER → STORY ARCHITECT → RHYTHM EDITOR → SHOT PLANNER /
 *   VISUAL DIRECTOR → MOTION DIRECTOR → SOUND DESIGNER → QUALITY CONTROL
 *
 * Every decision carries its reason (`reasons`) and the result is a ShotPlan
 * version 2 validated at `stage: 'final'` against VIDEO_EDITING_BIBLE.md.
 * Deterministic: the same input always gives the same plan.
 */
import {
  compileShotPlan,
  defaultMotionSkillRegistry,
  getShotStartFrames,
  validateShotPlan,
  type ControlledSilence,
  type EditorialLevel,
  type EditorialMemory,
  type NarrationSegment,
  type Shot,
  type ShotPlan,
} from '@studio-engine/scene-engine';
import { analyzeScript, scriptSentences } from './analyzer.js';
import { architectStory } from './architect.js';
import { intensityOf, MotionDirector } from './motion.js';
import { planRhythm } from './rhythm.js';
import { designSfx, musicStates, pickSilences, SILENCE_SECONDS } from './sound.js';
import type { BrainInput, BrainResult, EditorialUnit, StoryStructure } from './types.js';
import { VisualDirector, type Visual } from './visual.js';

export const BRAIN_VERSION = 1;

const CHAPTER_CARD_SECONDS = 1.5;
const OUTRO_SECONDS = 1;
const FADE_FRAMES = 12;
const DISSOLVE_FRAMES = 15;
const MAX_STRONG_RATIO = 0.2;
/** A key word closer than this to the start of its sentence needs no J-cut (bible GRAM-03: ±6 frames). */
const J_CUT_TOLERANCE = 6;

interface Draft {
  shot: Shot;
  unit?: EditorialUnit;
  role: 'key' | 'support' | 'chapter';
  chapterIndex: number;
  sceneIndexInChapter: number;
  /** Frames of silence at the end of the shot (the sentence's pause), before extra tails. */
  silentEnd: number;
  tail: number;
}

const level = (n: number): EditorialLevel => Math.max(1, Math.min(5, n)) as EditorialLevel;
const firstWords = (s: string, n: number) => s.split(/\s+/).slice(0, n).join(' ');

/** What the analyzer and the architect decided: the editorial understanding of the script. */
export interface Story {
  units: EditorialUnit[];
  structure: StoryStructure;
  decisions: string[];
}

/** 1–2. EDITORIAL ANALYZER + STORY ARCHITECT, heuristic version (offline, deterministic). */
export function heuristicStory(input: BrainInput): Story {
  const decisions: string[] = [];
  const { chapters } = scriptSentences(input);
  const units = analyzeScript(input);
  if (!units.length) throw new Error('the script contains no narration');
  const structure = architectStory(units, chapters, decisions);
  return { units, structure, decisions };
}

/** Heuristic brain, end to end. */
export function directEpisode(input: BrainInput): BrainResult {
  return directFromStory(input, heuristicStory(input));
}

/**
 * 3–9. Everything after the editorial understanding: rhythm, visuals, motion,
 * sound, QC. Shared by the heuristic and the LLM brains.
 */
export function directFromStory(input: BrainInput, story: Story): BrainResult {
  const fps = input.fps ?? 30;
  const skills = input.skills ?? defaultMotionSkillRegistry;
  const { units, structure } = story;
  const decisions = [...story.decisions];
  if (!input.narration) decisions.unshift('no narration transcript: timing estimated at 156 words per minute');
  else if (units.some((u) => u.estimatedTiming)) decisions.unshift(`timing estimated for ${units.filter((u) => u.estimatedTiming).map((u) => u.id).join(', ')}: the transcript does not match the script there`);
  const unitById = new Map(units.map((u) => [u.id, u]));

  // 3. RHYTHM EDITOR
  const timings = new Map(planRhythm(units, fps, input.pacing ?? 'standard').map((t) => [t.unitId, t]));

  // Major revelations get a controlled silence (only with a real voice to pause).
  const silenced = input.narration
    ? pickSilences(
        units.filter((u) => u.intent === 'revelation' && u.importance >= 5).map((u) => ({ shotId: u.id, chapterIndex: u.chapterIndex, frame: Math.round((u.startMs / 1000) * fps), importance: u.importance })),
        fps,
      )
    : new Set<string>();

  // 4–5. SHOT PLANNER, VISUAL DIRECTOR, MOTION DIRECTOR
  const visual = new VisualDirector(input.assets, input.catalog, fps, Math.ceil(units.length / 3));
  const motion = new MotionDirector(skills);
  const drafts: Draft[] = [];
  const segments: NarrationSegment[] = [];
  const firstShotOfUnit = new Map<string, number>();

  structure.chapters.forEach((chapter, ci) => {
    const scenes = structure.scenes.filter((s) => s.chapterId === chapter.id);
    if (ci > 0) {
      const title = firstWords(chapter.title, 6);
      if (title !== chapter.title) decisions.push(`chapter "${chapter.title}" shortened to 6 words on its card (CHAP-02)`);
      const v: Visual = { type: 'chapter', text: title, reason: `New chapter: ${chapter.question ?? chapter.title}` };
      const card = { id: `u0-${chapter.id}`, index: -1, chapterIndex: ci, text: title, words: title.split(' '), startMs: 0, endMs: 0, wordStartsMs: [], estimatedTiming: true, intent: 'chapter', importance: 3, analysis: {}, entities: { numbers: [], emphasis: [], places: [] }, why: 'chapter change' } satisfies EditorialUnit;
      const m = motion.choose(v, card, 'key', false);
      drafts.push({
        shot: {
          id: `chapter-${ci + 1}`,
          type: 'chapter',
          durationInFrames: Math.round(CHAPTER_CARD_SECONDS * fps),
          text: title,
          subtext: `CHAPTER ${ci + 1}`,
          sceneId: scenes[0]!.id,
          beat: 'transition',
          editorialIntent: 'chapter',
          importance: 3,
          visualHierarchy: visual.hierarchy(v, card),
          transition: 'fade',
          transitionDurationInFrames: FADE_FRAMES,
          ...(m.skill ? { motionSkill: m.skill } : {}),
          reasons: { shot: v.reason, ...(m.why ? { motion: m.why } : {}), transition: 'A fade marks the change of chapter.' },
          decidedBy: 'rules',
        },
        role: 'chapter',
        chapterIndex: ci,
        sceneIndexInChapter: 0,
        silentEnd: Math.round(CHAPTER_CARD_SECONDS * fps),
        tail: 0,
      });
    }
    scenes.forEach((scene, si) => {
      let firstImage = true;
      for (const uid of scene.unitIds) {
        const u = unitById.get(uid)!;
        const t = timings.get(uid)!;
        firstShotOfUnit.set(uid, drafts.length);
        if (input.narration) segments.push({ id: u.id, sourceStartMs: t.sourceStartMs, sourceEndMs: t.sourceEndMs, startFrame: 0 });
        const idOf = (k: number) => (t.chunks.length === 1 ? u.id : `${u.id}-${String.fromCharCode(97 + k)}`);
        const keyIndex = t.chunks.findIndex((c) => c.role === 'key');
        const key = visual.keyVisual(u, t.chunks[keyIndex]!, idOf(keyIndex));
        t.chunks.forEach((chunk, k) => {
          const v = chunk.role === 'key' ? key : visual.supportVisual(u, chunk, key.media, idOf(k));
          const m = motion.choose(v, u, chunk.role, silenced.has(u.id) && k === 0);
          const cam = visual.camera(v, u, motion.controlsCamera(m.skill));
          const framing = visual.framing(v, firstImage, u);
          if (v.type === 'image') firstImage = false;
          const callback = u.intent === 'conclusion' && chunk.role === 'key' && v.reason.startsWith('Visual callback');
          const shot: Shot = {
            id: idOf(k),
            type: v.type,
            durationInFrames: chunk.endFrame - chunk.startFrame,
            ...(v.media ? { media: v.media } : {}),
            ...(v.text ? { text: v.text } : {}),
            ...(v.highlightedWords ? { highlightedWords: v.highlightedWords } : {}),
            ...(v.number ? { number: v.number } : {}),
            ...(v.chart ? { chart: v.chart } : {}),
            ...(v.map ? { map: v.map } : {}),
            ...(v.document ? { document: v.document } : {}),
            ...(m.skill ? { motionSkill: m.skill } : {}),
            ...(cam.move ? { camera: cam.move } : {}),
            ...(framing ? { framing } : {}),
            ...(chunk.hold ? { hold: chunk.hold } : {}),
            ...(callback ? { transition: 'dissolve', transitionDurationInFrames: DISSOLVE_FRAMES } : {}),
            sceneId: scene.id,
            beat: structure.beats[u.id]!,
            editorialIntent: u.intent,
            importance: chunk.role === 'key' ? u.importance : level(u.importance - 1),
            ...(chunk.role === 'key' ? { analysis: u.analysis } : {}),
            visualHierarchy: visual.hierarchy(v, u),
            reasons: {
              shot: v.reason,
              ...(m.why ? { motion: m.why } : {}),
              ...(cam.why ? { camera: cam.why } : {}),
              ...(callback ? { transition: 'A dissolve links the end to the beginning: same place, new meaning.' } : {}),
            },
            decidedBy: 'rules',
            metadata: { unit: u.id },
          };
          drafts.push({ shot, unit: u, role: chunk.role, chapterIndex: ci, sceneIndexInChapter: si, silentEnd: k === t.chunks.length - 1 ? t.frames - t.speechEndFrame : 0, tail: 0 });
        });
      }
    });
  });

  // J-cuts: a key figure or place spoken shortly after the sentence starts gets its shot
  // exactly on the word (GRAM-03: ±6 frames); the previous shot covers the first words.
  const lead = new Map<string, number>();
  for (const u of units) {
    const key = u.intent === 'number' || u.intent === 'statistic' || u.intent === 'comparison' ? u.entities.numbers[0]?.wordIndex : u.intent === 'location' ? u.entities.places[0]?.wordIndex : undefined;
    const i = firstShotOfUnit.get(u.id)!;
    const first = drafts[i]!;
    const prev = drafts[i - 1];
    const t = timings.get(u.id)!;
    if (key === undefined || key === 0 || !prev || prev.role === 'chapter' || first.role !== 'key') continue;
    const kf = t.wordFrames[key]!;
    if (kf <= J_CUT_TOLERANCE || first.shot.durationInFrames - kf < fps) continue;
    prev.shot.durationInFrames += kf;
    first.shot.durationInFrames -= kf;
    for (const h of first.shot.document?.highlights ?? []) if (h.at !== undefined) h.at = Math.max(0, h.at - kf);
    lead.set(u.id, kf);
    decisions.push(`${u.id}: J-cut, the ${first.shot.type} appears on “${u.words[key]}” (${kf} frames into the sentence)`);
  }

  // 6. SILENCES and TAILS: pauses the voice needs before a silence, a transition, the end.
  const silences: ControlledSilence[] = [];
  const silenceFrames = Math.round(SILENCE_SECONDS * fps);
  for (const uid of silenced) {
    const i = firstShotOfUnit.get(uid)!;
    if (i === 0) continue;
    drafts[i - 1]!.tail += silenceFrames;
    silences.push({ id: `silence-${uid}`, beforeShotId: drafts[i]!.shot.id, durationInFrames: silenceFrames, kinds: ['music_drop'] });
    decisions.push(`${uid}: ${SILENCE_SECONDS} s of silence before the revelation (music drop)`);
  }
  drafts.forEach((d, i) => {
    const td = d.shot.transitionDurationInFrames;
    if (!td || i === 0) return;
    // The next shot starts `td` frames early: the previous shot must outlast its voice by that much,
    // so two voice ranges never overlap and no word is cut by the transition (RHY-08).
    const prev = drafts[i - 1]!;
    if (prev.tail < td + 1) prev.tail = td + 1;
  });
  drafts[drafts.length - 1]!.tail += Math.round(OUTRO_SECONDS * fps);
  for (const d of drafts) d.shot.durationInFrames += d.tail;

  // Intensity: strong for the hook and the silenced revelations, within 20 % (MOT-02).
  for (const d of drafts) {
    if (d.role === 'chapter' || !d.unit) continue;
    if (!d.shot.motionSkill && !d.shot.camera) continue;
    d.shot.intensity = intensityOf(d.unit, d.role, silenced.has(d.unit.id) && d.role === 'key');
  }
  const strong = drafts.filter((d) => d.shot.intensity === 'strong');
  const budget = Math.max(1, Math.floor(drafts.length * MAX_STRONG_RATIO));
  strong.slice(budget).forEach((d) => (d.shot.intensity = 'medium'));

  // 7. SOUND DESIGNER: music states.
  const shots = drafts.map((d) => d.shot);
  if (input.music) {
    const states = musicStates(drafts.map((d) => ({ id: d.shot.id, sceneId: d.shot.sceneId!, sceneIndexInChapter: d.sceneIndexInChapter, chapterIndex: d.chapterIndex, revelation: d.role === 'key' && d.unit?.intent === 'revelation' })));
    let previous: string | undefined;
    for (const s of shots) {
      s.musicState = states.get(s.id)!;
      if (s.musicState !== previous) s.reasons = { ...s.reasons!, music: MUSIC_WHY[s.musicState] };
      previous = s.musicState;
    }
  }
  const starts = getShotStartFrames({ shots, fps });
  for (const seg of segments) seg.startFrame = starts[firstShotOfUnit.get(seg.id)!]! - (lead.get(seg.id) ?? 0);

  // Memory: motifs, concepts, callbacks (bible §21).
  const memory: EditorialMemory = {};
  const callbackShot = shots.find((s) => s.transition === 'dissolve' && s.editorialIntent === 'conclusion');
  if (visual.motif) {
    memory.visualMotifs = [{ id: 'motif-1', description: visual.motif.description, assetId: visual.motif.assetId, introducedIn: visual.motif.shotId }];
    if (callbackShot) memory.callbackCandidates = [{ motifId: 'motif-1', callbackShotId: callbackShot.id, note: 'the opening image returns in the conclusion' }];
  }
  const concepts = units.filter((u) => (u.intent === 'hook' || u.intent === 'revelation') && u.entities.emphasis.length);
  if (concepts.length) memory.introducedConcepts = concepts.map((u) => ({ id: `concept-${u.id}`, label: u.entities.emphasis.join(' '), introducedIn: shots[firstShotOfUnit.get(u.id)!]!.id }));
  const motifScenes = new Set([visual.motif?.shotId, callbackShot?.id].filter(Boolean).map((id) => shots.find((s) => s.id === id)!.sceneId));

  const plan: ShotPlan = {
    version: 2,
    fps,
    width: input.width ?? 1920,
    height: input.height ?? 1080,
    assets: { ...input.assets },
    ...(input.narration ? { narration: { assetId: input.narration.assetId, words: input.narration.words, ...(input.narration.gainDb !== undefined ? { gainDb: input.narration.gainDb } : {}), segments } } : {}),
    ...(input.music ? { music: { assetId: input.music.assetId, gainDb: input.music.gainDb ?? -18, duckDb: input.music.duckDb ?? -6 } } : {}),
    ...(input.captions !== false && input.narration ? { captions: { enabled: true, style: 'caption-bold-pop', wordsPerCue: 3 } } : {}),
    chapters: structure.chapters.map((c) => ({ id: c.id, title: c.title, ...(c.question ? { question: c.question } : {}) })),
    scenes: structure.scenes.map((s) => ({ id: s.id, chapterId: s.chapterId, purpose: s.purpose, ...(visual.motif && motifScenes.has(s.id) ? { motifs: ['motif-1'] } : {}) })),
    ...(silences.length ? { silences } : {}),
    ...(Object.keys(memory).length ? { memory } : {}),
    metadata: { generator: 'editor-brain', brainVersion: BRAIN_VERSION, ...(input.title ? { title: input.title } : {}) },
    shots,
  };

  // 8. SOUND DESIGNER: effects on the events the compiled skills really emit.
  const draft = compileShotPlan(plan, { skills });
  if (draft.ok) {
    const sounds = draft.project.scenes.map((scene, i) => ({
      shotId: scene.id,
      startFrame: starts[i]!,
      durationInFrames: shots[i]!.durationInFrames,
      events: (scene.metadata?.extra?.events as Array<{ kind: string; at: number }> | undefined) ?? [],
      importance: shots[i]!.importance ?? 3,
    }));
    const sfx = designSfx(sounds, input.sfx ?? {}, fps);
    for (const s of shots) {
      const list = sfx.sfx.get(s.id);
      if (!list) continue;
      s.sfx = list;
      s.reasons = { ...s.reasons!, sfx: sfx.why.get(s.id)! };
    }
    if (!input.sfx) decisions.push('no sound library given: no sound effects');
    for (const category of sfx.missing) visual.requests.push({ unitId: '-', need: 'sfx', description: `sound effects of category "${category}" in the sound library` });
  }

  // STORY-05: a strong claim needs visual proof soon after it.
  for (const u of units) {
    if (!u.analysis.proofRequired || u.importance < 4) continue;
    const window = units.filter((x) => x.index > u.index && x.index <= u.index + 3 && x.chapterIndex === u.chapterIndex);
    const proven = [u, ...window].some((x) => x.intent === 'proof' || x.intent === 'statistic' || shots.some((s) => s.metadata?.unit === x.id && (s.type === 'document' || s.type === 'chart')));
    if (!proven) decisions.push(`${u.id}: strong claim without visual proof in the next sentences (STORY-05): “${firstWords(u.text, 10)}…”`);
  }

  // 9. QUALITY CONTROL
  const validation = validateShotPlan(plan, { stage: 'final', skillIds: skills.availableIds(), skillCatalog: skills });
  const compiled = compileShotPlan(plan, { skills });
  return {
    plan,
    analysis: units,
    structure,
    assetRequests: visual.requests,
    decisions,
    qc: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings, notes: compiled.ok ? compiled.notes : [] },
  };
}

const MUSIC_WHY: Record<string, string> = {
  calm: 'Calm music: the chapter opens and sets the scene.',
  build: 'The music builds towards the revelation.',
  tension: 'Tension under the argument.',
  reveal: 'The music comes back with the revelation.',
  aftermath: 'Aftermath: the music settles after the revelation.',
};
