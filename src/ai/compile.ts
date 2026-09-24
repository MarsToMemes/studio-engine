/**
 * Blueprint → VideoProject compiler.
 *
 * Timing model: blueprint seconds are NARRATIVE windows aligned with the
 * narration. To keep narration continuous while transitions overlap scenes,
 * every scene starts exactly at its narrative start and is extended by its
 * outgoing transition:
 *
 *   duration(i) = narrative(i) + overlap(i, i+1)
 *   ⇒ start(i) = narrativeStart(i)  and  total = narrativeEnd(last)
 *
 * Each scene plays its own slice of the narration (a voiceover segment of
 * exactly `narrative(i)` frames), so voice slices never overlap.
 */
import { createProject, createScene } from '../core/factories.js';
import { sequentialIds, type IdGenerator } from '../core/ids.js';
import { defaultSceneTypeRegistry, type SceneTypeRegistry } from '../core/sceneTypes.js';
import type { AssetRegistry } from '../model/assets.js';
import type { CaptionCue, CaptionTrack } from '../model/captions.js';
import type { Scene, VideoProject } from '../model/scene.js';
import type { Transition } from '../model/transition.js';
import { defaultPresetRegistry, type PresetRegistry } from '../presets/registry.js';
import { secondsToFrames } from '../timing/frames.js';
import type { ValidationIssue, ValidationResult } from '../validation/issues.js';
import { validateProject } from '../validation/validate.js';
import type { BlueprintDocument, BlueprintWord, SceneBlueprint } from './blueprint.js';
import { applyChoice, SceneComposerRegistry, type ComposeContext } from './compose.js';
import { validateBlueprint } from './validateBlueprint.js';

export interface CompileBlueprintOptions {
  assets?: AssetRegistry;
  fps?: number;
  ids?: IdGenerator;
  presets?: PresetRegistry;
  sceneTypes?: SceneTypeRegistry;
  composers?: SceneComposerRegistry;
  projectId?: string;
  /** Max words per estimated caption cue. Defaults to 6. */
  wordsPerCue?: number;
}

export type CompileBlueprintResult =
  | { ok: true; project: VideoProject; validation: ValidationResult; notes: string[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

interface Window {
  startFrame: number;
  endFrame: number;
}

function narrativeWindows(doc: BlueprintDocument, fps: number, sceneTypes: SceneTypeRegistry): Window[] {
  let cursor = 0;
  return doc.scenes.map((s) => {
    const startSeconds = s.startSeconds ?? cursor;
    const endSeconds = s.endSeconds ?? startSeconds + (s.durationSeconds ?? sceneTypes.get(s.type)?.defaultDurationInSeconds ?? 4);
    cursor = endSeconds;
    return { startFrame: secondsToFrames(startSeconds, fps), endFrame: secondsToFrames(endSeconds, fps) };
  });
}

function chunkWords<T>(words: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size));
  return out;
}

/** Caption cues from word timings, or estimated from the script (word timings proportional to characters). */
export function buildCaptionCues(bp: SceneBlueprint, window: Window, fps: number, ids: IdGenerator, wordsPerCue = 6): CaptionCue[] {
  const length = window.endFrame - window.startFrame;
  if (bp.words && bp.words.length > 0) {
    const toLocal = (s: number) => Math.min(length, Math.max(0, secondsToFrames(s, fps) - window.startFrame));
    return chunkWords<BlueprintWord>(bp.words, wordsPerCue)
      .map((group) => {
        const words = group.map((w) => ({ text: w.text, startFrame: toLocal(w.startSeconds), endFrame: Math.max(toLocal(w.startSeconds) + 1, toLocal(w.endSeconds)) }));
        return { id: ids('cue'), text: group.map((w) => w.text).join(' '), startFrame: words[0]!.startFrame, endFrame: words[words.length - 1]!.endFrame, words };
      })
      .filter((c) => c.endFrame > c.startFrame);
  }
  // No alignment available: estimate word timings from character counts so
  // word-by-word caption styles still advance through the whole cue.
  const words = (bp.script ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0 || length <= 0) return [];
  const totalChars = words.reduce((n, w) => n + w.length + 1, 0);
  let consumed = 0;
  const timed = words.map((text) => {
    const startFrame = Math.round((consumed / totalChars) * length);
    consumed += text.length + 1;
    return { text, startFrame, endFrame: Math.round((consumed / totalChars) * length) };
  });
  return chunkWords(timed, wordsPerCue)
    .map((group) => ({ id: ids('cue'), text: group.map((w) => w.text).join(' '), startFrame: group[0]!.startFrame, endFrame: group[group.length - 1]!.endFrame, words: group.filter((w) => w.endFrame > w.startFrame) }))
    .filter((c) => c.endFrame > c.startFrame);
}

export function compileBlueprint(doc: BlueprintDocument, options: CompileBlueprintOptions = {}): CompileBlueprintResult {
  const presets = options.presets ?? defaultPresetRegistry;
  const sceneTypes = options.sceneTypes ?? defaultSceneTypeRegistry;
  const assets = options.assets ?? {};
  const pre = validateBlueprint(doc, { presets, sceneTypes, assetIds: new Set(Object.keys(assets)) });
  if (!pre.valid) return { ok: false, errors: pre.errors, warnings: pre.warnings };

  const ids = options.ids ?? sequentialIds();
  const composers = options.composers ?? new SceneComposerRegistry();
  const fps = options.fps ?? doc.fps ?? 30;
  const notes: string[] = [];

  const project = createProject({ fps, aspectRatio: doc.aspectRatio ?? '16:9', ids, ...(doc.title ? { name: doc.title } : {}), ...(options.projectId ? { id: options.projectId } : {}) });
  project.assets = { ...assets };
  const windows = narrativeWindows(doc, fps, sceneTypes);
  const lengths = windows.map((w) => w.endFrame - w.startFrame);
  const applyCtx = { fps, canvas: project.dimensions };

  // Transitions INTO each scene, clamped so they fit the scenes they join.
  const transitions: Array<Transition | undefined> = doc.scenes.map((s, i) => {
    if (i === 0) return undefined;
    const choice = s.transitionIn ?? doc.style?.transition;
    if (!choice) return undefined;
    const t = presets.apply('transition', choice, applyCtx);
    const max = Math.floor(Math.min(lengths[i - 1]!, lengths[i]!) / 2);
    if (t.type !== 'cut' && t.durationInFrames > max) {
      notes.push(`scenes[${i}].transitionIn shortened from ${t.durationInFrames} to ${max} frames to fit the adjacent scenes`);
      t.durationInFrames = max;
    }
    return t;
  });
  const overlapOut = (i: number) => {
    const t = transitions[i + 1];
    return t && t.type !== 'cut' ? t.durationInFrames : 0;
  };

  const captionStyle = doc.style?.captions ? presets.apply('caption', doc.style.captions, applyCtx) : presets.apply('caption', 'caption-clean', applyCtx);

  project.scenes = doc.scenes.map((bp, i): Scene => {
    const window = windows[i]!;
    const durationInFrames = lengths[i]! + overlapOut(i);

    let captions: CaptionTrack | undefined;
    const wantCaptions = bp.captions ?? Boolean(doc.style?.captions);
    if (wantCaptions) {
      const cues = buildCaptionCues(bp, window, fps, ids, options.wordsPerCue);
      if (cues.length > 0) captions = { id: ids('captions'), cues };
    }

    const ctx: ComposeContext = {
      blueprint: bp,
      doc,
      fps,
      canvas: project.dimensions,
      durationInFrames,
      ids,
      assets,
      presets,
      ...(captions ? { captionStyle, captionTrackId: captions.id } : {}),
    };

    const scene = createScene(
      bp.type,
      {
        id: ids('scene'),
        durationInFrames,
        background: { type: 'color', color: '#0b0b0f' },
        layers: composers.get(bp.type)(ctx),
        animations: bp.camera ? applyChoice(ctx, 'camera', bp.camera, durationInFrames) : [],
        metadata: {
          source: 'ai',
          scriptSegmentId: `segment_${i + 1}`,
          ...(bp.role ? { role: bp.role } : {}),
          ...(bp.headline ? { title: bp.headline } : {}),
          ...(bp.notes ? { notes: bp.notes } : {}),
          ...(bp.visualQuery ? { extra: { visualQuery: bp.visualQuery } } : {}),
        },
      },
      { fps, ids, sceneTypes },
    );
    const transitionIn = transitions[i];
    if (transitionIn) scene.transitionIn = transitionIn;
    if (captions) scene.captions = captions;
    if (doc.narration) {
      scene.voiceover = {
        id: ids('voiceover'),
        assetId: doc.narration.assetId,
        startFrame: 0,
        durationInFrames: lengths[i]!,
        trim: { startFrom: window.startFrame, endAt: window.endFrame },
        ...(bp.script ? { text: bp.script } : {}),
        ...(captions ? { captionTrackId: captions.id } : {}),
      };
    }
    return scene;
  });

  if (doc.music) {
    project.audio.push({
      id: ids('music'),
      assetId: doc.music.assetId,
      role: 'music',
      volume: doc.music.volume ?? 0.35,
      loop: true,
      fadeInFrames: Math.round(fps * 0.5),
      fadeOutFrames: Math.round(fps * 1.5),
      ...(doc.music.duckTo !== undefined ? { ducking: { amount: doc.music.duckTo } } : {}),
    });
  }

  const validation = validateProject(project, { sceneTypes });
  if (!validation.valid) return { ok: false, errors: validation.errors, warnings: validation.warnings };
  return { ok: true, project, validation, notes };
}
