/**
 * Timeline derivation. Scenes store only their own duration; every absolute
 * frame is derived here so there is a single source of truth.
 *
 *   start(0)   = 0
 *   start(i+1) = start(i) + duration(i) - overlap(i, i+1)
 *   total      = Σ duration - Σ overlap
 *
 * `overlap(i, i+1)` is the duration of the transition between the two scenes
 * (0 for a cut), matching Remotion's `<TransitionSeries>`.
 */
import type { AudioTrack, VoiceoverSegment } from '../model/audio.js';
import type { AssetRegistry } from '../model/assets.js';
import type { Layer, LayerType } from '../model/layer.js';
import type { Frames } from '../model/primitives.js';
import type { Scene, VideoProject } from '../model/scene.js';
import type { Transition } from '../model/transition.js';
import { resolveAnimationWindow, type AnimationWindow } from './windows.js';

// ---------------------------------------------------------------------------
// Scene / layer primitives
// ---------------------------------------------------------------------------

export function getSceneDuration(scene: Pick<Scene, 'durationInFrames'>): Frames {
  return Math.max(0, scene.durationInFrames);
}

export function getLayerStartFrame(layer: Pick<Layer, 'startFrame'>): Frames {
  return Math.max(0, layer.startFrame ?? 0);
}

/** Layer duration, defaulting to the rest of the scene and clipped to the scene. */
export function getLayerDuration(layer: Pick<Layer, 'startFrame' | 'durationInFrames'>, scene: Pick<Scene, 'durationInFrames'>): Frames {
  const start = getLayerStartFrame(layer);
  const available = Math.max(0, getSceneDuration(scene) - start);
  return layer.durationInFrames === undefined ? available : Math.min(Math.max(0, layer.durationInFrames), available);
}

/** Exclusive end frame of a layer, relative to its scene. */
export function getLayerEndFrame(layer: Pick<Layer, 'startFrame' | 'durationInFrames'>, scene: Pick<Scene, 'durationInFrames'>): Frames {
  return getLayerStartFrame(layer) + getLayerDuration(layer, scene);
}

export function isLayerActiveAt(layer: Pick<Layer, 'startFrame' | 'durationInFrames' | 'visible'>, scene: Pick<Scene, 'durationInFrames'>, sceneFrame: Frames): boolean {
  if (layer.visible === false) return false;
  return sceneFrame >= getLayerStartFrame(layer) && sceneFrame < getLayerEndFrame(layer, scene);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

type TransitionOwner = Pick<Scene, 'transitionIn' | 'transitionOut'>;

/** The transition played between `prev` and `next`: `next.transitionIn ?? prev.transitionOut`. */
export function getTransitionBetween(prev: TransitionOwner, next: TransitionOwner): Transition | undefined {
  return next.transitionIn ?? prev.transitionOut;
}

export function getTransitionDuration(transition: Transition | undefined): Frames {
  if (!transition || transition.type === 'cut') return 0;
  return Math.max(0, transition.durationInFrames);
}

/** Frames shared by two consecutive scenes. */
export function getTransitionOverlap(prev: TransitionOwner, next: TransitionOwner): Frames {
  return getTransitionDuration(getTransitionBetween(prev, next));
}

// ---------------------------------------------------------------------------
// Scene placement
// ---------------------------------------------------------------------------

type TimedScene = Pick<Scene, 'durationInFrames' | 'transitionIn' | 'transitionOut'>;

/** Absolute start frame of every scene. O(n). */
export function getSceneStartFrames(scenes: readonly TimedScene[]): Frames[] {
  const starts: Frames[] = new Array(scenes.length);
  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    if (i > 0) cursor -= getTransitionOverlap(scenes[i - 1]!, scene);
    starts[i] = Math.max(0, cursor);
    cursor = starts[i]! + getSceneDuration(scene);
  }
  return starts;
}

export function getSceneStartFrame(scenes: readonly TimedScene[], index: number): Frames {
  assertIndex(scenes, index);
  return getSceneStartFrames(scenes.slice(0, index + 1))[index]!;
}

/** Exclusive absolute end frame of the scene at `index`. */
export function getSceneEndFrame(scenes: readonly TimedScene[], index: number): Frames {
  return getSceneStartFrame(scenes, index) + getSceneDuration(scenes[index]!);
}

/** Total composition length in frames. */
export function getTimelineDuration(scenes: readonly TimedScene[]): Frames {
  let total = 0;
  for (let i = 0; i < scenes.length; i++) {
    total += getSceneDuration(scenes[i]!);
    if (i > 0) total -= getTransitionOverlap(scenes[i - 1]!, scenes[i]!);
  }
  return Math.max(0, total);
}

function assertIndex(list: readonly unknown[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    throw new RangeError(`Scene index ${index} out of range (0..${list.length - 1})`);
  }
}

// ---------------------------------------------------------------------------
// Full resolution
// ---------------------------------------------------------------------------

export type TransitionPlacement = 'overlap' | 'edge';

export interface ResolvedTransition {
  transition: Transition;
  /** `overlap`: between two scenes. `edge`: first scene in / last scene out, played inside the scene. */
  placement: TransitionPlacement;
  startFrame: Frames;
  endFrame: Frames;
  durationInFrames: Frames;
  fromSceneId?: string;
  toSceneId?: string;
}

export interface ResolvedAnimation extends AnimationWindow {
  /** Index in the owner's `animations` array. */
  index: number;
  /** Absolute frames. */
  absoluteStartFrame: Frames;
  absoluteEndFrame: Frames;
}

export interface ResolvedLayer {
  layerId: string;
  type: LayerType;
  zIndex: number;
  /** Relative to the scene. */
  localStartFrame: Frames;
  localEndFrame: Frames;
  /** Absolute. */
  startFrame: Frames;
  endFrame: Frames;
  durationInFrames: Frames;
  animations: ResolvedAnimation[];
}

export interface ResolvedAudio {
  id: string;
  assetId: string;
  role: AudioTrack['role'];
  sceneId?: string;
  startFrame: Frames;
  endFrame: Frames;
  durationInFrames: Frames;
}

export interface SceneTiming {
  sceneId: string;
  index: number;
  startFrame: Frames;
  /** Exclusive. */
  endFrame: Frames;
  durationInFrames: Frames;
  transitionIn?: ResolvedTransition;
  transitionOut?: ResolvedTransition;
}

export interface ResolvedScene extends SceneTiming {
  layers: ResolvedLayer[];
  animations: ResolvedAnimation[];
  audio: ResolvedAudio[];
  voiceover?: ResolvedAudio;
  captions?: { trackId: string; startFrame: Frames; endFrame: Frames; cueCount: number };
}

export type TimelineClipKind = 'scene' | 'transition' | 'layer' | 'audio' | 'voiceover' | 'captions';

export interface TimelineClip {
  id: string;
  kind: TimelineClipKind;
  trackId: string;
  startFrame: Frames;
  endFrame: Frames;
  sceneId?: string;
  refId: string;
}

export interface TimelineTrack {
  id: string;
  kind: TimelineClipKind;
  label: string;
}

export interface ResolvedTimeline {
  fps: number;
  durationInFrames: Frames;
  scenes: ResolvedScene[];
  audio: ResolvedAudio[];
  tracks: TimelineTrack[];
  clips: TimelineClip[];
}

export function resolveSceneTiming(scenes: readonly Scene[], index: number, starts?: readonly Frames[]): SceneTiming {
  assertIndex(scenes, index);
  const scene = scenes[index]!;
  const allStarts = starts ?? getSceneStartFrames(scenes);
  const startFrame = allStarts[index]!;
  const durationInFrames = getSceneDuration(scene);
  const endFrame = startFrame + durationInFrames;
  const timing: SceneTiming = { sceneId: scene.id, index, startFrame, endFrame, durationInFrames };

  const prev = index > 0 ? scenes[index - 1] : undefined;
  const next = index < scenes.length - 1 ? scenes[index + 1] : undefined;

  const inTransition = prev ? getTransitionBetween(prev, scene) : scene.transitionIn;
  if (inTransition && inTransition.type !== 'cut') {
    const d = Math.min(getTransitionDuration(inTransition), durationInFrames);
    timing.transitionIn = {
      transition: inTransition,
      placement: prev ? 'overlap' : 'edge',
      startFrame,
      endFrame: startFrame + d,
      durationInFrames: d,
      ...(prev ? { fromSceneId: prev.id } : {}),
      toSceneId: scene.id,
    };
  }

  const outTransition = next ? getTransitionBetween(scene, next) : scene.transitionOut;
  if (outTransition && outTransition.type !== 'cut') {
    const d = Math.min(getTransitionDuration(outTransition), durationInFrames);
    timing.transitionOut = {
      transition: outTransition,
      placement: next ? 'overlap' : 'edge',
      startFrame: endFrame - d,
      endFrame,
      durationInFrames: d,
      fromSceneId: scene.id,
      ...(next ? { toSceneId: next.id } : {}),
    };
  }
  return timing;
}

function resolveAudioTrack(
  track: AudioTrack | VoiceoverSegment,
  role: AudioTrack['role'],
  ownerStart: Frames,
  ownerDuration: Frames,
  assets: AssetRegistry,
  fps: number,
  sceneId?: string,
): ResolvedAudio {
  const local = Math.max(0, track.startFrame ?? 0);
  const remaining = Math.max(0, ownerDuration - local);
  let duration = track.durationInFrames ?? remaining;
  const asset = assets[track.assetId];
  if (track.durationInFrames === undefined && asset?.durationInSeconds !== undefined && !('loop' in track && track.loop)) {
    const trimStart = track.trim?.startFrom ?? 0;
    const trimEnd = track.trim?.endAt ?? Math.round(asset.durationInSeconds * fps);
    duration = Math.min(duration, Math.max(0, trimEnd - trimStart));
  }
  duration = Math.min(duration, remaining);
  return {
    id: track.id,
    assetId: track.assetId,
    role,
    ...(sceneId ? { sceneId } : {}),
    startFrame: ownerStart + local,
    endFrame: ownerStart + local + duration,
    durationInFrames: duration,
  };
}

function resolveAnimations(
  animations: Layer['animations'],
  ownerDuration: Frames,
  ownerAbsoluteStart: Frames,
  fps: number,
  layer?: Layer,
): ResolvedAnimation[] {
  const out: ResolvedAnimation[] = [];
  for (let i = 0; i < animations.length; i++) {
    const animation = animations[i]!;
    if (animation.enabled === false) continue;
    const w = resolveAnimationWindow(animation, { ownerDurationInFrames: ownerDuration, fps, ...(layer?.type === 'text' ? { text: layer.text } : {}) });
    out.push({ ...w, index: i, absoluteStartFrame: ownerAbsoluteStart + w.startFrame, absoluteEndFrame: ownerAbsoluteStart + w.endFrame });
  }
  return out;
}

/**
 * Derive every absolute frame of the project in one O(scenes + layers + audio) pass.
 * The result references scenes/layers by id and never copies their content.
 */
export function resolveTimeline(project: Pick<VideoProject, 'fps' | 'scenes' | 'assets' | 'audio'>): ResolvedTimeline {
  const { fps, scenes, assets } = project;
  const starts = getSceneStartFrames(scenes);
  const durationInFrames = getTimelineDuration(scenes);

  const resolvedScenes: ResolvedScene[] = [];
  const clips: TimelineClip[] = [];
  const trackIds = new Map<string, TimelineTrack>();
  const addTrack = (id: string, kind: TimelineClipKind, label: string) => {
    if (!trackIds.has(id)) trackIds.set(id, { id, kind, label });
  };
  addTrack('scenes', 'scene', 'Scenes');

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    const timing = resolveSceneTiming(scenes, i, starts);
    const { startFrame, durationInFrames: sceneDuration } = timing;

    const layers: ResolvedLayer[] = scene.layers.map((layer) => {
      const localStartFrame = getLayerStartFrame(layer);
      const layerDuration = getLayerDuration(layer, scene);
      return {
        layerId: layer.id,
        type: layer.type,
        zIndex: layer.zIndex,
        localStartFrame,
        localEndFrame: localStartFrame + layerDuration,
        startFrame: startFrame + localStartFrame,
        endFrame: startFrame + localStartFrame + layerDuration,
        durationInFrames: layerDuration,
        animations: resolveAnimations(layer.animations, layerDuration, startFrame + localStartFrame, fps, layer),
      };
    });

    const audio = scene.audio.map((t) => resolveAudioTrack(t, t.role, startFrame, sceneDuration, assets, fps, scene.id));
    const voiceover = scene.voiceover
      ? resolveAudioTrack(scene.voiceover, 'voiceover', startFrame, sceneDuration, assets, fps, scene.id)
      : undefined;

    const resolved: ResolvedScene = {
      ...timing,
      layers,
      animations: resolveAnimations(scene.animations, sceneDuration, startFrame, fps),
      audio,
      ...(voiceover ? { voiceover } : {}),
    };

    if (scene.captions && scene.captions.cues.length > 0) {
      const cues = scene.captions.cues;
      let first = Infinity;
      let last = -Infinity;
      for (const cue of cues) {
        first = Math.min(first, cue.startFrame);
        last = Math.max(last, cue.endFrame);
      }
      resolved.captions = {
        trackId: scene.captions.id,
        startFrame: startFrame + Math.max(0, first),
        endFrame: startFrame + Math.min(sceneDuration, last),
        cueCount: cues.length,
      };
    }
    resolvedScenes.push(resolved);

    // Clips for a multi-track timeline UI.
    clips.push({ id: `scene:${scene.id}`, kind: 'scene', trackId: 'scenes', startFrame, endFrame: timing.endFrame, sceneId: scene.id, refId: scene.id });
    if (timing.transitionIn && timing.transitionIn.placement === 'overlap') {
      addTrack('transitions', 'transition', 'Transitions');
      clips.push({
        id: `transition:${timing.transitionIn.fromSceneId}->${scene.id}`,
        kind: 'transition',
        trackId: 'transitions',
        startFrame: timing.transitionIn.startFrame,
        endFrame: timing.transitionIn.endFrame,
        sceneId: scene.id,
        refId: timing.transitionIn.transition.id ?? `${timing.transitionIn.fromSceneId}->${scene.id}`,
      });
    }
    for (const l of layers) {
      const trackId = `layers:z${l.zIndex}`;
      addTrack(trackId, 'layer', `Layer z${l.zIndex}`);
      clips.push({ id: `layer:${scene.id}:${l.layerId}`, kind: 'layer', trackId, startFrame: l.startFrame, endFrame: l.endFrame, sceneId: scene.id, refId: l.layerId });
    }
    if (voiceover) {
      addTrack('voiceover', 'voiceover', 'Voiceover');
      clips.push({ id: `voiceover:${voiceover.id}`, kind: 'voiceover', trackId: 'voiceover', startFrame: voiceover.startFrame, endFrame: voiceover.endFrame, sceneId: scene.id, refId: voiceover.id });
    }
    for (const a of audio) {
      const trackId = `audio:${a.role}`;
      addTrack(trackId, 'audio', `Audio (${a.role})`);
      clips.push({ id: `audio:${a.id}`, kind: 'audio', trackId, startFrame: a.startFrame, endFrame: a.endFrame, sceneId: scene.id, refId: a.id });
    }
    if (resolved.captions) {
      addTrack('captions', 'captions', 'Captions');
      clips.push({ id: `captions:${resolved.captions.trackId}`, kind: 'captions', trackId: 'captions', startFrame: resolved.captions.startFrame, endFrame: resolved.captions.endFrame, sceneId: scene.id, refId: resolved.captions.trackId });
    }
  }

  const projectAudio = project.audio.map((t) => resolveAudioTrack(t, t.role, 0, durationInFrames, assets, fps));
  for (const a of projectAudio) {
    const trackId = `audio:${a.role}`;
    addTrack(trackId, 'audio', `Audio (${a.role})`);
    clips.push({ id: `audio:${a.id}`, kind: 'audio', trackId, startFrame: a.startFrame, endFrame: a.endFrame, refId: a.id });
  }

  return {
    fps,
    durationInFrames,
    scenes: resolvedScenes,
    audio: [...resolvedScenes.flatMap((s) => (s.voiceover ? [s.voiceover, ...s.audio] : s.audio)), ...projectAudio],
    tracks: [...trackIds.values()],
    clips,
  };
}

/**
 * Index of the scene visible at an absolute frame. During an overlap the
 * INCOMING scene is returned (it is the one on top). Binary search, O(log n).
 */
export function findSceneIndexAtFrame(starts: readonly Frames[], durations: readonly Frames[], frame: Frames): number {
  if (starts.length === 0) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= frame) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === -1) return -1;
  return frame < starts[found]! + durations[found]! ? found : -1;
}
