/**
 * Compile once, sample every frame.
 *
 * `compileProject` does all the work that does not depend on the frame:
 * timeline resolution, layer boxes, z-ordering, animation windows, static
 * effect filters. `sampleScene` / `sampleLayer` then only evaluate what moves.
 * A compiled project is immutable: recompile (or recompile one scene) after
 * an edit.
 */
import { createAnimationProviderRegistry, type AnimationProviderRegistry, type EvaluationMode } from '../animation/providers/registry.js';
import { hasUnitAnimations, type WindowedAnimation } from '../animation/evaluate.js';
import { resolveLayerBox, type Rect } from '../core/layout.js';
import type { Animation, TextSplit } from '../model/animation.js';
import { getLayerTextSplit } from '../core/text.js';
import type { Layer } from '../model/layer.js';
import type { Dimensions } from '../model/primitives.js';
import type { Scene, VideoProject } from '../model/scene.js';
import { getLayerDuration, getLayerStartFrame, resolveTimeline, type ResolvedTimeline, type SceneTiming } from '../timing/timeline.js';
import { resolveAnimationWindow } from '../timing/windows.js';
import { defaultTransitionRegistry, type TransitionRegistry } from '../transitions/registry.js';
import { effectsToCssFilter, hasAnimatedEffects } from './style.js';

export interface RenderOptions {
  providers?: AnimationProviderRegistry;
  transitions?: TransitionRegistry;
  /** `render` (default) only uses deterministic animation providers. */
  mode?: EvaluationMode;
  onFallback?: (animation: Animation, reason: string) => void;
}

export interface ResolvedRenderOptions {
  providers: AnimationProviderRegistry;
  transitions: TransitionRegistry;
  mode: EvaluationMode;
  onFallback?: (animation: Animation, reason: string) => void;
}

export interface CompiledLayer {
  layer: Layer;
  rect: Rect;
  localStartFrame: number;
  localEndFrame: number;
  /** Whole-layer animations with precomputed windows. */
  animations: WindowedAnimation[];
  /** True when stagger / kinetic animations must be evaluated per unit. */
  hasUnitAnimations: boolean;
  /** How text is split into units for those animations. */
  textSplit: TextSplit | undefined;
  /** Precomputed CSS filter when effects are static, `undefined` when they are animated. */
  staticEffectsFilter: string | undefined;
}

export interface CompiledScene {
  scene: Scene;
  timing: SceneTiming;
  canvas: Dimensions;
  fps: number;
  /** Sorted by zIndex, then by original order. */
  layers: CompiledLayer[];
  sceneAnimations: WindowedAnimation[];
}

export interface CompiledProject {
  project: VideoProject;
  timeline: ResolvedTimeline;
  scenes: CompiledScene[];
  /** Absolute start / duration arrays for O(log n) scene lookup. */
  starts: number[];
  durations: number[];
  options: ResolvedRenderOptions;
}

export function resolveRenderOptions(options: RenderOptions = {}): ResolvedRenderOptions {
  return {
    providers: options.providers ?? createAnimationProviderRegistry(),
    transitions: options.transitions ?? defaultTransitionRegistry,
    mode: options.mode ?? 'render',
    ...(options.onFallback ? { onFallback: options.onFallback } : {}),
  };
}

function windowed(animations: readonly Animation[], ownerDuration: number, fps: number, layer?: Layer): WindowedAnimation[] {
  const out: WindowedAnimation[] = [];
  for (const animation of animations) {
    if (animation.enabled === false) continue;
    out.push({ animation, window: resolveAnimationWindow(animation, { ownerDurationInFrames: ownerDuration, fps, ...(layer?.type === 'text' ? { text: layer.text } : {}) }) });
  }
  return out;
}

export function compileLayer(layer: Layer, scene: Scene, canvas: Dimensions, fps: number): CompiledLayer {
  const localStartFrame = getLayerStartFrame(layer);
  const duration = getLayerDuration(layer, scene);
  return {
    layer,
    rect: resolveLayerBox(layer.position, canvas),
    localStartFrame,
    localEndFrame: localStartFrame + duration,
    animations: windowed(layer.animations, duration, fps, layer),
    hasUnitAnimations: hasUnitAnimations(layer.animations),
    textSplit: getLayerTextSplit(layer.animations),
    staticEffectsFilter: hasAnimatedEffects(layer.effects) ? undefined : effectsToCssFilter(layer.effects),
  };
}

export function compileScene(scene: Scene, timing: SceneTiming, canvas: Dimensions, fps: number): CompiledScene {
  const layers = scene.layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.zIndex - b.layer.zIndex || a.index - b.index)
    .map(({ layer }) => compileLayer(layer, scene, canvas, fps));
  return { scene, timing, canvas, fps, layers, sceneAnimations: windowed(scene.animations, scene.durationInFrames, fps) };
}

export function compileProject(project: VideoProject, options: RenderOptions = {}): CompiledProject {
  const timeline = resolveTimeline(project);
  const scenes = project.scenes.map((scene, i) => compileScene(scene, timeline.scenes[i]!, project.dimensions, project.fps));
  return {
    project,
    timeline,
    scenes,
    starts: timeline.scenes.map((s) => s.startFrame),
    durations: timeline.scenes.map((s) => s.durationInFrames),
    options: resolveRenderOptions(options),
  };
}
