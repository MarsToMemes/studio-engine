/**
 * ShotPlan → VideoProject.
 *
 * Every shot becomes one scene (scene id = shot id, layer ids derived from it),
 * so the UI can map any engine object back to the shot that produced it.
 * Base layers per shot type are deterministic and themed; motion skills are
 * applied afterwards by an injectable resolver (the Motion Skill Registry).
 * Nothing here can fail on a missing skill, SFX or transition: they fall back
 * and are reported in `notes`.
 */
import { createLayer, createProject, createScene } from '../core/factories.js';
import { resolveLayerBox } from '../core/layout.js';
import type { AudioTrack } from '../model/audio.js';
import type { CaptionCue, CaptionTrack } from '../model/captions.js';
import type { Layer, LayerBox, TextLayer } from '../model/layer.js';
import type { Dimensions, JsonObject } from '../model/primitives.js';
import type { Scene, SceneRole, SceneType, VideoProject } from '../model/scene.js';
import type { TextStyle } from '../model/text.js';
import { defaultPresetRegistry, type PresetRegistry } from '../presets/registry.js';
import { defaultTransitionRegistry, type TransitionRegistry } from '../transitions/registry.js';
import type { ValidationIssue, ValidationResult } from '../validation/issues.js';
import { validateProject } from '../validation/validate.js';
import { defaultMotionSkillRegistry } from '../skills/index.js';
import { applyFraming, applyShotCamera, type CameraSkillSource } from '../skills/camera.js';
import { deriveMusicCues, resolveNarration, resolveSilences } from './editorial.js';
import { ambienceAutomation, inSilence, musicAutomation, silenceWindows } from './sound.js';
import { DOCUMENTARY_THEME, type DocumentaryTheme } from './theme.js';
import { getShotStartFrames, resolveShotTransitions } from './timeline.js';
import type { Shot, ShotPlan, TranscriptWord } from './types.js';
import { isHookShot, normalizeWord, validateShotPlan, type ShotPlanValidationOptions } from './validate.js';

/** Semantic handles on the layers a shot produced, for motion skills to target. */
export type ShotLayerRole = 'media' | 'text' | 'subtext' | 'number' | 'chart' | 'map' | 'document' | 'highlight' | 'source' | 'captions' | 'accent';

export interface ComposedShot {
  shot: Shot;
  scene: Scene;
  /** Layers by role. `highlight` may hold several layers; the first one is exposed here. */
  roles: Partial<Record<ShotLayerRole, Layer>>;
}

/** A narration word inside a shot, in frames relative to the shot start. */
export interface ShotWord {
  text: string;
  startFrame: number;
  endFrame: number;
}

export interface ShotSkillContext {
  fps: number;
  canvas: Dimensions;
  theme: DocumentaryTheme;
  presets: PresetRegistry;
  /** Narration words spoken during the shot (empty without a transcript). */
  words: ShotWord[];
}

/** Editorial moment emitted by a skill (keyword appears, number lands…). Drives automatic SFX. */
export interface ShotEvent {
  kind: 'text' | 'keyword' | 'number' | 'highlight' | 'reveal' | 'impact' | 'glitch' | 'whoosh' | 'chapter';
  /** Frame relative to the shot start. */
  at: number;
}

/**
 * Applies `shot.motionSkill` to a composed shot (mutating its layers / scene
 * animations). Returns the skill id actually applied — possibly a fallback —
 * or `undefined` when nothing was applied.
 */
export type ShotSkillResolver = (composed: ComposedShot, ctx: ShotSkillContext) => { applied?: string; note?: string; events?: ShotEvent[] };

/** What `compileShotPlan` needs from a skill registry (keeps this module free of the skill catalog). */
export interface SkillProvider {
  toResolver(): ShotSkillResolver;
  availableIds(): Set<string>;
  /** Optional: lets the shot camera use skill-based moves and detect camera conflicts (CAM-02). */
  get?(id: string): { id: string; category: string; controlsCamera: boolean; family?: string } | undefined;
  resolve?: CameraSkillSource['resolve'];
  resolveParams?: CameraSkillSource['resolveParams'];
}

export interface CompileShotPlanOptions extends ShotPlanValidationOptions {
  projectId?: string;
  name?: string;
  theme?: DocumentaryTheme;
  presets?: PresetRegistry;
  transitions?: TransitionRegistry;
  /** Motion skill registry. Defaults to the built-in skills; `false` compiles without motion. */
  skills?: SkillProvider | false;
  /** Custom skill resolver; wins over `skills`. */
  applySkill?: ShotSkillResolver;
}

export type CompileShotPlanResult =
  | { ok: true; project: VideoProject; validation: ValidationResult; planWarnings: ValidationIssue[]; notes: string[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** Shots whose visuals do not already show the words. */
export const DEFAULT_CAPTION_SHOT_TYPES: readonly Shot['type'][] = ['image', 'video', 'document', 'chart', 'map'];

const box = (anchor: LayerBox['anchor'], x: number, y: number, width?: number, height?: number): LayerBox => ({
  anchor,
  x,
  y,
  units: 'percent',
  ...(width !== undefined ? { width } : {}),
  ...(height !== undefined ? { height } : {}),
});

const SCENE_TYPES: Record<Shot['type'], SceneType> = {
  image: 'image',
  video: 'video',
  text: 'text',
  number: 'statistic',
  document: 'screenshot',
  chart: 'chart',
  map: 'map',
  revelation: 'text',
  chapter: 'title',
};

function roleOf(shot: Shot, index: number): SceneRole {
  if (typeof shot.metadata?.role === 'string') return shot.metadata.role;
  if (isHookShot(shot, index)) return 'hook';
  if (shot.type === 'revelation') return 'twist';
  if (shot.type === 'chapter') return 'intro';
  if (shot.type === 'number') return 'statistic';
  if (shot.type === 'document' || shot.type === 'chart') return 'evidence';
  return 'explanation';
}

/** Indices of `words` (split on whitespace) that match `highlighted`. */
export function emphasisIndices(text: string, highlighted: readonly string[] | undefined): number[] {
  if (!highlighted || highlighted.length === 0) return [];
  const wanted = new Set(highlighted.map(normalizeWord));
  return text
    .trim()
    .split(/\s+/)
    .flatMap((w, i) => (wanted.has(normalizeWord(w)) ? [i] : []));
}

function headlineStyle(theme: DocumentaryTheme, size: number, accent: string): TextStyle {
  return {
    fontFamily: theme.fontFamily,
    fontSize: size,
    fontWeight: 900,
    lineHeight: 1.05,
    letterSpacing: -1,
    textTransform: 'uppercase',
    textAlign: 'center',
    color: theme.text,
    highlight: { color: accent },
    shadow: { x: 0, y: 4, blur: 18, color: 'rgba(0,0,0,0.45)' },
  };
}

function textLayer(id: string, text: string, style: TextStyle, position: LayerBox, zIndex: number, emphasis: number[] = []): TextLayer {
  return createLayer('text', { id, text, style, position, zIndex, autoFit: true, ...(emphasis.length ? { emphasis } : {}) });
}

/** Displayed rect of an image fitted with `contain` inside a box, in px. */
function containRect(boxPx: { x: number; y: number; width: number; height: number }, aspect: number | undefined) {
  if (!aspect) return boxPx;
  const boxAspect = boxPx.width / boxPx.height;
  if (aspect > boxAspect) {
    const h = boxPx.width / aspect;
    return { x: boxPx.x, y: boxPx.y + (boxPx.height - h) / 2, width: boxPx.width, height: h };
  }
  const w = boxPx.height * aspect;
  return { x: boxPx.x + (boxPx.width - w) / 2, y: boxPx.y, width: w, height: boxPx.height };
}

// ---------------------------------------------------------------------------
// Base composition per shot type
// ---------------------------------------------------------------------------

function composeLayers(shot: Shot, plan: ShotPlan, theme: DocumentaryTheme, canvas: Dimensions): { layers: Layer[]; roles: ComposedShot['roles'] } {
  const roles: ComposedShot['roles'] = {};
  const layers: Layer[] = [];
  const add = (role: ShotLayerRole, layer: Layer) => {
    layers.push(layer);
    if (!roles[role]) roles[role] = layer;
    return layer;
  };
  const id = (suffix: string) => `${shot.id}:${suffix}`;
  const emphasis = shot.text ? emphasisIndices(shot.text, shot.highlightedWords) : [];

  switch (shot.type) {
    case 'image':
    case 'video': {
      const media = shot.type === 'video'
        ? createLayer('video', { id: id('media'), assetId: shot.media!, fit: 'cover', muted: true, zIndex: 10 })
        : createLayer('image', { id: id('media'), assetId: shot.media!, fit: 'cover', zIndex: 10 });
      add('media', media);
      if (shot.text) {
        const style: TextStyle = { ...headlineStyle(theme, 64, theme.accent), textAlign: 'left', background: { color: 'rgba(18,18,18,0.72)', paddingX: 28, paddingY: 14, radius: 6 } };
        add('text', textLayer(id('text'), shot.text, style, box('bottom-left', 5, -12, 70, 14), 40, emphasis));
      }
      break;
    }
    case 'text':
    case 'revelation': {
      const accent = shot.type === 'revelation' ? theme.alert : theme.accent;
      add('text', textLayer(id('text'), shot.text!, headlineStyle(theme, shot.type === 'revelation' ? 150 : 120, accent), box('center', 0, shot.subtext ? -6 : 0, 86, 44), 40, emphasis));
      if (shot.subtext) add('subtext', textLayer(id('subtext'), shot.subtext, { ...headlineStyle(theme, 44, accent), fontWeight: 600, textTransform: 'none', letterSpacing: 0 }, box('center', 0, 18, 76, 10), 40));
      break;
    }
    case 'chapter': {
      if (shot.subtext) add('subtext', textLayer(id('subtext'), shot.subtext, { ...headlineStyle(theme, 40, theme.accent), color: theme.accent, letterSpacing: 6 }, box('center', 0, -14, 70, 8), 40));
      add('text', textLayer(id('text'), shot.text!, headlineStyle(theme, 130, theme.accent), box('center', 0, 0, 86, 22), 40, emphasis));
      add('accent', createLayer('shape', { id: id('accent'), shape: 'rect', fill: theme.accent, zIndex: 35, position: box('center', 0, 16, 12, 0.8) }));
      break;
    }
    case 'number': {
      const n = shot.number!;
      add('number', createLayer('graphic', {
        id: id('number'),
        kind: 'counter',
        data: { from: n.from ?? 0, to: n.value, decimals: n.decimals ?? 0, prefix: n.prefix ?? '', suffix: n.suffix ?? '', countDurationInFrames: Math.round(plan.fps * 1.2), easing: 'easeOutCubic' },
        style: { fontFamily: theme.fontFamily, fontSize: 240, fontWeight: 900, letterSpacing: -6, color: theme.accent },
        zIndex: 30,
        position: box('center', 0, -6, 90, 30),
      }));
      const label = n.label ?? shot.text;
      if (label) add('text', textLayer(id('text'), label, { ...headlineStyle(theme, 56, theme.accent), fontWeight: 700 }, box('center', 0, 16, 80, 10), 40, emphasis));
      break;
    }
    case 'chart': {
      const c = shot.chart!;
      add('chart', createLayer('graphic', { id: id('chart'), kind: c.kind, data: { labels: c.labels, values: c.values, ...(c.unit ? { unit: c.unit } : {}), accent: theme.accent }, zIndex: 30, position: box('center', 0, 4, 80, 56) }));
      const title = c.title ?? shot.text;
      if (title) add('text', textLayer(id('text'), title, headlineStyle(theme, 64, theme.accent), box('top-center', 0, 8, 86, 12), 40, emphasis));
      break;
    }
    case 'map': {
      add('map', createLayer('graphic', { id: id('map'), kind: 'map', data: JSON.parse(JSON.stringify(shot.map)) as JsonObject, zIndex: 20, position: box('center', 0, 0) }));
      if (shot.text) add('text', textLayer(id('text'), shot.text, { ...headlineStyle(theme, 64, theme.accent), textAlign: 'left', background: { color: 'rgba(18,18,18,0.72)', paddingX: 28, paddingY: 14, radius: 6 } }, box('bottom-left', 5, -12, 70, 14), 40, emphasis));
      break;
    }
    case 'document': {
      const docBox = box('center', 0, -3, 78, 78);
      add('document', createLayer('image', { id: id('document'), assetId: shot.media!, fit: 'contain', zIndex: 10, position: docBox, effects: [{ type: 'dropShadow', x: 0, y: 24, blur: 60, color: 'rgba(0,0,0,0.55)' }] }));
      const asset = plan.assets[shot.media!];
      const rect = containRect(resolveLayerBox(docBox, canvas), asset?.width && asset.height ? asset.width / asset.height : undefined);
      (shot.document?.highlights ?? []).forEach((h, i) => {
        add('highlight', createLayer('shape', {
          id: id(`highlight-${i}`),
          shape: 'rect',
          fill: 'rgba(255,199,44,0.45)',
          blendMode: 'multiply',
          zIndex: 15,
          position: { anchor: 'top-left', units: 'px', x: rect.x + (h.x / 100) * rect.width, y: rect.y + (h.y / 100) * rect.height, width: (h.width / 100) * rect.width, height: (h.height / 100) * rect.height },
          // Highlighter swipe, timed to the narration.
          animations: [{ type: 'reveal', direction: 'right', startFrame: h.at ?? 0, durationInFrames: Math.max(1, Math.round(plan.fps * 0.35)), easing: 'easeOutCubic' }],
        }));
      });
      const source = shot.document?.source ?? shot.subtext;
      // Bottom-left by default; top-left when captions use the bottom band (bible CAP-04).
      const captioned = Boolean(plan.captions?.enabled && (plan.captions.showOn ?? DEFAULT_CAPTION_SHOT_TYPES).includes(shot.type));
      if (source) add('source', { ...textLayer(id('source'), `Source: ${source}`, { fontFamily: theme.fontFamily, fontSize: 30, fontWeight: 600, color: theme.text, textAlign: 'left', background: { color: 'rgba(18,18,18,0.8)', paddingX: 18, paddingY: 10, radius: 4 } }, captioned ? box('top-left', 4, 4, 60, 7) : box('bottom-left', 4, -4, 60, 7), 45), screenSpace: true });
      if (shot.text) add('text', textLayer(id('text'), shot.text, headlineStyle(theme, 56, theme.accent), box('top-center', 0, 4, 86, 10), 40, emphasis));
      break;
    }
  }
  return { layers, roles };
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

/** Narration words whose start falls inside the shot window, in shot-relative frames. */
function shotWords(words: readonly TranscriptWord[], window: { start: number; end: number }, duration: number, fps: number): ShotWord[] {
  const toFrame = (ms: number) => Math.round((ms / 1000) * fps);
  return words
    .filter((w) => {
      const f = toFrame(w.startMs);
      return f >= window.start && f < window.end;
    })
    .map((w) => {
      const startFrame = Math.max(0, toFrame(w.startMs) - window.start);
      return { text: w.text.trim(), startFrame, endFrame: Math.min(duration, Math.max(startFrame + 1, toFrame(w.endMs) - window.start)) };
    })
    .filter((w) => w.text !== '');
}

function captionTrack(shotId: string, inShot: readonly ShotWord[], wordsPerCue: number): CaptionTrack | undefined {
  if (inShot.length === 0) return undefined;
  const cues: CaptionCue[] = [];
  let group: ShotWord[] = [];
  const flush = () => {
    if (!group.length) return;
    cues.push({ id: `${shotId}:cue-${cues.length + 1}`, text: group.map((w) => w.text).join(' '), startFrame: group[0]!.startFrame, endFrame: group[group.length - 1]!.endFrame, words: group.map((w) => ({ ...w })) });
    group = [];
  };
  for (const w of inShot) {
    group.push(w);
    // A cue never runs across the end of a sentence.
    if (group.length >= wordsPerCue || /[.!?…]["»”’)]*$/.test(w.text)) flush();
  }
  flush();
  return { id: `${shotId}:captions`, cues };
}

/**
 * True when the shot's own text repeats most of what is spoken during it
 * (e.g. an image with the sentence as a title): captions would duplicate it.
 */
export function captionsRedundant(shot: Pick<Shot, 'text'>, words: readonly ShotWord[]): boolean {
  if (!shot.text || !words.length) return false;
  const spoken = new Set(words.map((w) => normalizeWord(w.text)).filter(Boolean));
  const shown = shot.text.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (!shown.length) return false;
  const repeated = shown.filter((w) => spoken.has(w)).length;
  return repeated / shown.length >= 0.6;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export function compileShotPlan(plan: ShotPlan, options: CompileShotPlanOptions = {}): CompileShotPlanResult {
  const skills = options.skills === false ? undefined : (options.skills ?? defaultMotionSkillRegistry);
  const applySkill = options.applySkill ?? skills?.toResolver();
  const pre = validateShotPlan(plan, {
    ...options,
    ...(skills && !options.skillIds ? { skillIds: skills.availableIds() } : {}),
    ...(skills?.get && !options.skillCatalog ? { skillCatalog: { get: (id: string) => skills.get!(id) } } : {}),
  });
  if (!pre.valid) return { ok: false, errors: pre.errors, warnings: pre.warnings };

  const theme = options.theme ?? DOCUMENTARY_THEME;
  const presets = options.presets ?? defaultPresetRegistry;
  const registry = options.transitions ?? defaultTransitionRegistry;
  const canvas = { width: plan.width, height: plan.height };
  const notes: string[] = [];
  const resolveSfx = options.resolveSfx ?? ((sfxId: string) => (plan.assets[sfxId] ? sfxId : undefined));

  const project = createProject({
    id: options.projectId ?? String(plan.metadata?.id ?? 'shot-plan'),
    ...(options.name ? { name: options.name } : {}),
    fps: plan.fps,
    dimensions: canvas,
    aspectRatio: `${plan.width}:${plan.height}`,
    background: { type: 'color', color: theme.background },
  });
  project.assets = { ...plan.assets };

  const transitions = resolveShotTransitions(plan, registry);
  const starts = getShotStartFrames(plan, registry);
  // Where the voice really plays (segments), with words in timeline time.
  const narration = resolveNarration(plan);
  // Controlled silences, rendered (bible §13).
  const silences = silenceWindows(resolveSilences(plan, starts));
  const captionStyle = plan.captions?.enabled ? presets.apply('caption', plan.captions.style ?? 'caption-bold-pop', { fps: plan.fps, canvas }) : undefined;
  if (captionStyle?.activeWord) captionStyle.activeWord = { ...captionStyle.activeWord, color: theme.accent };

  project.scenes = plan.shots.map((shot, i): Scene => {
    const { layers, roles } = composeLayers(shot, plan, theme, canvas);
    const scene = createScene(SCENE_TYPES[shot.type], {
      id: shot.id,
      durationInFrames: shot.durationInFrames,
      background: { type: 'color', color: theme.background },
      layers,
      metadata: {
        role: roleOf(shot, i),
        source: 'ai',
        extra: {
          shotType: shot.type,
          ...(shot.intensity ? { intensity: shot.intensity } : {}),
          ...(shot.motionSkill ? { motionSkill: shot.motionSkill } : {}),
          transition: transitions[i]!.id,
          ...(shot.editorialIntent ? { editorialIntent: shot.editorialIntent } : {}),
          ...(shot.sceneId ? { sceneId: shot.sceneId } : {}),
          ...(shot.beat ? { beat: shot.beat } : {}),
          ...(shot.musicState ? { musicState: shot.musicState } : {}),
        },
      },
    });

    const t = transitions[i]!;
    if (t.transition) scene.transitionIn = { ...t.transition, id: `${shot.id}:transition` };
    if (t.unknownId) notes.push(`${shot.id}: unknown transition "${t.unknownId}", hard_cut used`);
    if (t.shortenedFrom !== undefined) notes.push(`${shot.id}: transition shortened from ${t.shortenedFrom} frames`);

    // Sound effects.
    const audio: AudioTrack[] = [];
    (shot.sfx ?? []).forEach((e, k) => {
      const assetId = resolveSfx(e.sfx);
      if (!assetId) {
        notes.push(`${shot.id}: sfx "${e.sfx}" unresolved, skipped`);
        return;
      }
      if (inSilence(starts[i]! + (e.at ?? 0), silences, 'sfx_drop')) {
        notes.push(`${shot.id}: sfx "${e.sfx}" falls in a controlled silence (sfx_drop), skipped`);
        return;
      }
      audio.push({ id: `${shot.id}:sfx-${k}`, assetId, role: 'sfx', startFrame: e.at ?? 0, volume: Math.min(1, dbToGain(e.gainDb ?? -6)) });
    });
    scene.audio = audio;

    const next = starts[i + 1];
    const window = { start: starts[i]!, end: next ?? starts[i]! + shot.durationInFrames };
    const words = shotWords(narration.words, window, shot.durationInFrames, plan.fps);

    // Captions, sliced from the narration transcript. Not when the shot
    // already shows what is being said (bible CAP-03).
    const captioned = Boolean(captionStyle && narration.words.length && (plan.captions?.showOn ?? DEFAULT_CAPTION_SHOT_TYPES).includes(shot.type));
    const redundant = captioned && captionsRedundant(shot, words);
    if (redundant) notes.push(`${shot.id}: [CAP-03] no captions, the on-screen text already says it`);
    if (captionStyle && captioned && !redundant) {
      const track = captionTrack(shot.id, words, plan.captions?.wordsPerCue ?? 3);
      if (track) {
        scene.captions = track;
        const layer = createLayer('caption', { id: `${shot.id}:captions`, trackId: track.id, style: captionStyle, zIndex: 60, position: box('bottom-center', 0, -6, 90, 16), screenSpace: true });
        scene.layers.push(layer);
        roles.captions = layer;
      }
    }

    // Motion skill (Motion Skill Registry, injected).
    if (shot.motionSkill) {
      if (applySkill) {
        const r = applySkill({ shot, scene, roles }, { fps: plan.fps, canvas, theme, presets, words });
        if (r.note) notes.push(`${shot.id}: ${r.note}`);
        if (r.applied && scene.metadata?.extra) scene.metadata.extra.appliedSkill = r.applied;
        if (r.events?.length && scene.metadata?.extra) scene.metadata.extra.events = r.events.map((e) => ({ kind: e.kind, at: e.at }));
      } else {
        notes.push(`${shot.id}: motion skill "${shot.motionSkill}" not applied (no skill registry)`);
      }
    }

    // Shot camera and framing, independent of the motion skill (bible §7).
    const target = { shot, scene, roles };
    const framingNote = applyFraming(target);
    if (framingNote) notes.push(`${shot.id}: ${framingNote}`);
    if (shot.camera) {
      const extra = scene.metadata!.extra!;
      const appliedSkill = typeof extra.appliedSkill === 'string' ? skills?.get?.(extra.appliedSkill) : undefined;
      const source = skills?.resolve && skills.resolveParams ? { resolve: skills.resolve.bind(skills), resolveParams: skills.resolveParams.bind(skills) } : undefined;
      const cam = applyShotCamera(target, { fps: plan.fps, canvas, theme, presets, words }, source, appliedSkill?.controlsCamera ? appliedSkill.id : undefined);
      if (cam.note) notes.push(`${shot.id}: ${cam.note}`);
      if (cam.applied) extra.camera = cam.applied;
      if (cam.events?.length) extra.events = [...((extra.events as Array<{ kind: string; at: number }> | undefined) ?? []), ...cam.events.map((e) => ({ kind: e.kind, at: e.at }))];
    }
    return scene;
  });

  // Narration (continuous, or one track per segment) and ducked music bed, in
  // absolute frames. With segments the music ducks per segment, not for the
  // whole file (bible MUS-06).
  if (plan.narration) {
    const volume = Math.min(1, dbToGain(plan.narration.gainDb ?? 0));
    if (!narration.segmented) project.audio.push({ id: 'narration', assetId: plan.narration.assetId, role: 'voiceover', startFrame: 0, volume });
    else for (const v of narration.voice) {
      project.audio.push({ id: `narration:${v.id}`, assetId: plan.narration.assetId, role: 'voiceover', startFrame: v.startFrame, durationInFrames: v.durationInFrames, trim: { startFrom: v.sourceStartFrame, endAt: v.sourceStartFrame + v.durationInFrames }, volume });
    }
  }
  if (plan.music) {
    const bedDb = plan.music.gainDb ?? -18;
    const automation = musicAutomation(deriveMusicCues(plan, starts), silences, { fps: plan.fps, bedDb });
    project.audio.push({
      id: 'music',
      assetId: plan.music.assetId,
      role: 'music',
      startFrame: 0,
      loop: true,
      volume: dbToGain(bedDb),
      fadeInFrames: Math.round(plan.fps * 0.5),
      fadeOutFrames: Math.round(plan.fps * 1.5),
      ...(plan.narration ? { ducking: { amount: dbToGain(plan.music.duckDb ?? -6), attackFrames: Math.round(plan.fps * 0.2), releaseFrames: Math.round(plan.fps * 0.5) } } : {}),
      ...(automation.length ? { automation } : {}),
    });
  }
  if (plan.ambience) {
    const automation = ambienceAutomation(silences, plan.fps);
    project.audio.push({
      id: 'ambience',
      assetId: plan.ambience.assetId,
      role: 'ambience',
      startFrame: 0,
      loop: true,
      volume: dbToGain(plan.ambience.gainDb ?? -28),
      fadeInFrames: Math.round(plan.fps * 1),
      fadeOutFrames: Math.round(plan.fps * 1.5),
      ...(automation.length ? { automation } : {}),
    });
  }
  if (silences.some((w) => w.kinds.includes('ambient_drop')) && !plan.ambience) notes.push('ambient_drop silence without an ambience bed: nothing to drop');

  const validation = validateProject(project);
  if (!validation.valid) return { ok: false, errors: validation.errors, warnings: [...pre.warnings, ...validation.warnings] };
  return { ok: true, project, validation, planWarnings: pre.warnings, notes };
}

