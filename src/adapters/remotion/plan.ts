/**
 * Scene model → Remotion composition PLAN.
 *
 * This module does not import `remotion`. It produces a plain, serializable
 * description that a thin Remotion project turns into components:
 *
 *   plan.series  → <TransitionSeries> with one <TransitionSeries.Sequence> per
 *                  scene and one <TransitionSeries.Transition> per overlap
 *   plan.audio   → <Sequence from><Audio/></Sequence> with `audioVolumeAt`
 *   plan.preload → prefetch() / preloadVideo() list
 *   <Composition width height fps durationInFrames> ← plan.composition
 *
 * `durationInFrames` is computed with the same overlap rule Remotion applies
 * to <TransitionSeries>, so the composition length always matches.
 */
import type { AudioRole, AudioTrack, VoiceoverSegment } from '../../model/audio.js';
import type { Asset } from '../../model/assets.js';
import type { VideoProject } from '../../model/scene.js';
import type { Transition } from '../../model/transition.js';
import { getUsedAssetIds } from '../../assets/library.js';
import { resolveTimeline, type ResolvedAudio, type ResolvedTransition } from '../../timing/timeline.js';
import { defaultTransitionRegistry, type TransitionRegistry } from '../../transitions/registry.js';
import type { RemotionCapabilities, RemotionPresentationSpec, RemotionTimingSpec } from '../../transitions/types.js';
import { SceneValidationError } from '../../validation/issues.js';
import { validateProject, type ValidationOptions } from '../../validation/validate.js';

export interface RemotionCompositionSettings {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

export interface RemotionSequenceItem {
  kind: 'sequence';
  sceneId: string;
  sceneIndex: number;
  durationInFrames: number;
  /** Absolute start, for reference / debugging. */
  startFrame: number;
  /** Edge transitions are rendered by the scene itself, not by <TransitionSeries>. */
  edgeIn?: { transition: Transition; durationInFrames: number };
  edgeOut?: { transition: Transition; durationInFrames: number };
}

export interface RemotionTransitionItem {
  kind: 'transition';
  fromSceneId: string;
  toSceneId: string;
  transition: Transition;
  presentation: RemotionPresentationSpec;
  timing: RemotionTimingSpec;
}

export type RemotionSeriesItem = RemotionSequenceItem | RemotionTransitionItem;

export interface VolumeEnvelope {
  volume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  /** Absolute frame windows where the track is ducked, with the target multiplier. */
  ducking: Array<{ startFrame: number; endFrame: number; amount: number; attackFrames: number; releaseFrames: number }>;
}

export interface RemotionAudioItem {
  id: string;
  role: AudioRole;
  assetId: string;
  src: string;
  /** Absolute frame. */
  from: number;
  durationInFrames: number;
  startFrom: number;
  endAt?: number;
  playbackRate: number;
  loop: boolean;
  muted: boolean;
  envelope: VolumeEnvelope;
}

export interface RemotionPreloadItem {
  assetId: string;
  kind: Asset['kind'];
  src: string;
}

export interface RemotionCompositionPlan {
  composition: RemotionCompositionSettings;
  series: RemotionSeriesItem[];
  audio: RemotionAudioItem[];
  preload: RemotionPreloadItem[];
  /** Transitions whose Remotion presentation is provided by the engine (not by @remotion/transitions). */
  customPresentations: string[];
  /** Optional Remotion capabilities this plan relies on. Empty unless enabled in the options. */
  requiredCapabilities: Array<keyof RemotionCapabilities>;
}

export interface BuildPlanOptions extends ValidationOptions {
  compositionId?: string;
  transitions?: TransitionRegistry;
  /** Validate first (default true). An invalid project never produces a plan. */
  validate?: boolean;
  /**
   * Capabilities of the render environment. Off by default so plans render
   * on any Chrome; enable `htmlInCanvas` to use Remotion's shader transitions.
   */
  capabilities?: Partial<RemotionCapabilities>;
}

function edge(resolved: ResolvedTransition | undefined): { transition: Transition; durationInFrames: number } | undefined {
  return resolved && resolved.placement === 'edge' ? { transition: resolved.transition, durationInFrames: resolved.durationInFrames } : undefined;
}

export function buildRemotionPlan(project: VideoProject, options: BuildPlanOptions = {}): RemotionCompositionPlan {
  if (options.validate !== false) {
    const result = validateProject(project, options);
    if (!result.valid) throw new SceneValidationError(result);
  }
  const registry = options.transitions ?? defaultTransitionRegistry;
  const timeline = resolveTimeline(project);
  const box = project.dimensions;

  const series: RemotionSeriesItem[] = [];
  const custom = new Set<string>();
  const required = new Set<keyof RemotionCapabilities>();
  timeline.scenes.forEach((s, i) => {
    const tIn = s.transitionIn;
    if (i > 0 && tIn && tIn.placement === 'overlap') {
      const remotion = registry.toRemotion(tIn.transition, { box, ...(options.capabilities ? { capabilities: options.capabilities } : {}) });
      if (remotion) {
        if (remotion.presentation.kind === 'custom') custom.add(remotion.presentation.name);
        else if (remotion.presentation.requires) required.add(remotion.presentation.requires);
        series.push({ kind: 'transition', fromSceneId: tIn.fromSceneId!, toSceneId: s.sceneId, transition: tIn.transition, ...remotion });
      }
    }
    const edgeIn = i === 0 ? edge(tIn) : undefined;
    const edgeOut = i === timeline.scenes.length - 1 ? edge(s.transitionOut) : undefined;
    series.push({
      kind: 'sequence',
      sceneId: s.sceneId,
      sceneIndex: i,
      durationInFrames: s.durationInFrames,
      startFrame: s.startFrame,
      ...(edgeIn ? { edgeIn } : {}),
      ...(edgeOut ? { edgeOut } : {}),
    });
  });

  // Audio: voiceovers first (they drive ducking), then the rest.
  const voiceWindows = timeline.audio.filter((a) => a.role === 'voiceover');
  const trackById = new Map<string, Partial<AudioTrack> & Partial<VoiceoverSegment>>();
  for (const scene of project.scenes) {
    for (const t of scene.audio) trackById.set(t.id, t);
    if (scene.voiceover) trackById.set(scene.voiceover.id, scene.voiceover);
  }
  for (const t of project.audio) trackById.set(t.id, t);

  const toItem = (a: ResolvedAudio): RemotionAudioItem => {
    const t = trackById.get(a.id) ?? {};
    const duck = t.ducking;
    return {
      id: a.id,
      role: a.role,
      assetId: a.assetId,
      src: project.assets[a.assetId]!.src,
      from: a.startFrame,
      durationInFrames: a.durationInFrames,
      startFrom: t.trim?.startFrom ?? 0,
      ...(t.trim?.endAt !== undefined ? { endAt: t.trim.endAt } : {}),
      playbackRate: t.playbackRate ?? 1,
      loop: t.loop ?? false,
      muted: t.muted ?? false,
      envelope: {
        volume: t.volume ?? 1,
        fadeInFrames: t.fadeInFrames ?? 0,
        fadeOutFrames: t.fadeOutFrames ?? 0,
        ducking:
          duck && a.role !== 'voiceover'
            ? voiceWindows
                .filter((v) => v.endFrame > a.startFrame && v.startFrame < a.startFrame + a.durationInFrames)
                .map((v) => ({ startFrame: v.startFrame, endFrame: v.endFrame, amount: duck.amount, attackFrames: duck.attackFrames ?? 6, releaseFrames: duck.releaseFrames ?? 12 }))
            : [],
      },
    };
  };

  const audio = timeline.audio.filter((a) => a.durationInFrames > 0).map(toItem);

  const preload = getUsedAssetIds(project)
    .map((id) => project.assets[id]!)
    .map((a) => ({ assetId: a.id, kind: a.kind, src: a.src }));

  return {
    composition: {
      id: options.compositionId ?? sanitizeCompositionId(project.name ?? project.id),
      width: project.dimensions.width,
      height: project.dimensions.height,
      fps: project.fps,
      durationInFrames: Math.max(1, timeline.durationInFrames),
    },
    series,
    audio,
    preload,
    customPresentations: [...custom],
    requiredCapabilities: [...required],
  };
}

/** Remotion composition ids may only contain a-z, A-Z, 0-9, CJK and "-". */
export function sanitizeCompositionId(value: string): string {
  const id = value.replace(/[^a-zA-Z0-9一-龥-]+/g, '-').replace(/^-+|-+$/g, '');
  return id || 'Video';
}

/**
 * Volume of an audio item at `frame` frames after its `from` — pass it to
 * `<Audio volume={(f) => audioVolumeAt(item, f)} />`.
 */
export function audioVolumeAt(item: Pick<RemotionAudioItem, 'from' | 'durationInFrames' | 'envelope'>, frame: number): number {
  const { envelope: e, durationInFrames } = item;
  let v = e.volume;
  if (e.fadeInFrames > 0 && frame < e.fadeInFrames) v *= Math.max(0, frame / e.fadeInFrames);
  const remaining = durationInFrames - frame;
  if (e.fadeOutFrames > 0 && remaining < e.fadeOutFrames) v *= Math.max(0, remaining / e.fadeOutFrames);
  const abs = item.from + frame;
  let duck = 1;
  for (const w of e.ducking) {
    let k = 0;
    if (abs >= w.startFrame && abs < w.endFrame) k = w.attackFrames > 0 ? Math.min(1, (abs - w.startFrame) / w.attackFrames) : 1;
    else if (abs >= w.endFrame && abs < w.endFrame + w.releaseFrames) k = 1 - (abs - w.endFrame) / w.releaseFrames;
    duck = Math.min(duck, 1 - k * (1 - w.amount));
  }
  return Math.max(0, Math.min(1, v * duck));
}
