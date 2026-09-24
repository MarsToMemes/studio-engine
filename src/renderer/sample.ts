import { evaluateAnimations } from '../animation/evaluate.js';
import type { AnimationState } from '../animation/state.js';
import type { Frames } from '../model/primitives.js';
import { findSceneIndexAtFrame, type ResolvedTransition } from '../timing/timeline.js';
import type { TransitionFrameState } from '../transitions/types.js';
import type { CompiledLayer, CompiledProject, CompiledScene, ResolvedRenderOptions } from './compile.js';
import { buildLayerStyle, effectsToCssFilter, stateToStyle, type StyleMap } from './style.js';

export interface LayerFrame {
  compiled: CompiledLayer;
  /** Frame relative to the layer start. */
  localFrame: Frames;
  state: AnimationState;
  style: StyleMap;
}

export interface SceneFrame {
  scene: CompiledScene;
  sceneFrame: Frames;
  /** Camera / scene-level animation state, applied to the layer stack container. */
  cameraState: AnimationState;
  cameraStyle: StyleMap;
  /** Visible layers, bottom to top. */
  layers: LayerFrame[];
  /** First scene's `transitionIn` / last scene's `transitionOut`, played inside the scene. */
  edgeTransition?: { resolved: ResolvedTransition; role: 'entering' | 'exiting'; state: TransitionFrameState; style: StyleMap };
}

export function sampleLayer(compiled: CompiledLayer, sceneFrame: Frames, scene: CompiledScene, options: ResolvedRenderOptions): LayerFrame | undefined {
  const { layer } = compiled;
  if (layer.visible === false || sceneFrame < compiled.localStartFrame || sceneFrame >= compiled.localEndFrame) return undefined;
  const localFrame = sceneFrame - compiled.localStartFrame;
  const state = evaluateAnimations(compiled.animations, {
    fps: scene.fps,
    frame: localFrame,
    box: compiled.rect,
    registry: options.providers,
    mode: options.mode,
    ...(options.onFallback ? { onFallback: options.onFallback } : {}),
  });
  const filter = compiled.staticEffectsFilter ?? effectsToCssFilter(layer.effects, localFrame);
  return { compiled, localFrame, state, style: buildLayerStyle(layer, compiled.rect, state, filter) };
}

/**
 * Per-unit states for split text (stagger, kinetic typography). The text
 * renderer decides what a unit is and calls this with the unit count.
 */
export function sampleLayerUnits(compiled: CompiledLayer, sceneFrame: Frames, count: number, scene: CompiledScene, options: ResolvedRenderOptions): AnimationState[] {
  const localFrame = sceneFrame - compiled.localStartFrame;
  const unitAnimations = compiled.animations.filter((a) => a.animation.type === 'stagger' || a.animation.type === 'kineticTypography');
  const out: AnimationState[] = new Array(count);
  for (let index = 0; index < count; index++) {
    out[index] = evaluateAnimations(unitAnimations, {
      fps: scene.fps,
      frame: localFrame,
      box: compiled.rect,
      registry: options.providers,
      mode: options.mode,
      unit: { index, count },
    });
  }
  return out;
}

function edgeTransition(scene: CompiledScene, sceneFrame: Frames, options: ResolvedRenderOptions): SceneFrame['edgeTransition'] {
  const { timing } = scene;
  const ctx = { box: scene.canvas };
  const tIn = timing.transitionIn;
  if (tIn && tIn.placement === 'edge' && sceneFrame < tIn.durationInFrames) {
    const state = options.transitions.evaluate(tIn.transition, sceneFrame, ctx);
    return { resolved: tIn, role: 'entering', state, style: stateToStyle(state.entering) };
  }
  const tOut = timing.transitionOut;
  const outStart = timing.durationInFrames - (tOut?.durationInFrames ?? 0);
  if (tOut && tOut.placement === 'edge' && sceneFrame >= outStart) {
    // Played in reverse: the scene is the "entering" side leaving towards the background.
    const state = options.transitions.evaluate(tOut.transition, tOut.durationInFrames - (sceneFrame - outStart), ctx);
    return { resolved: tOut, role: 'exiting', state, style: stateToStyle(state.entering) };
  }
  return undefined;
}

export function sampleScene(scene: CompiledScene, sceneFrame: Frames, options: ResolvedRenderOptions): SceneFrame {
  const layers: LayerFrame[] = [];
  for (const compiled of scene.layers) {
    const frame = sampleLayer(compiled, sceneFrame, scene, options);
    if (frame) layers.push(frame);
  }
  const cameraState = evaluateAnimations(scene.sceneAnimations, {
    fps: scene.fps,
    frame: sceneFrame,
    box: scene.canvas,
    registry: options.providers,
    mode: options.mode,
    ...(options.onFallback ? { onFallback: options.onFallback } : {}),
  });
  const cameraStyle = stateToStyle(cameraState);
  const sceneEffects = effectsToCssFilter(scene.scene.effects, sceneFrame);
  if (sceneEffects) cameraStyle.filter = [cameraStyle.filter, sceneEffects].filter(Boolean).join(' ');
  const edge = edgeTransition(scene, sceneFrame, options);
  return { scene, sceneFrame, cameraState, cameraStyle, layers, ...(edge ? { edgeTransition: edge } : {}) };
}

export interface ProjectFrame {
  frame: Frames;
  /** One scene, or two during an overlapping transition (exiting first). */
  scenes: SceneFrame[];
  transition?: { resolved: ResolvedTransition; progressFrame: Frames; state: TransitionFrameState };
}

/**
 * Everything visible at an absolute frame. Used by editor previews that do
 * not run inside Remotion; the Remotion adapter relies on `<TransitionSeries>`
 * instead and only calls `sampleScene`.
 */
export function sampleProjectFrame(compiled: CompiledProject, frame: Frames): ProjectFrame {
  const index = findSceneIndexAtFrame(compiled.starts, compiled.durations, frame);
  if (index < 0) return { frame, scenes: [] };
  const current = compiled.scenes[index]!;
  const sceneFrame = frame - compiled.starts[index]!;
  const tIn = current.timing.transitionIn;
  if (tIn && tIn.placement === 'overlap' && frame < tIn.endFrame && index > 0) {
    const prev = compiled.scenes[index - 1]!;
    const progressFrame = frame - tIn.startFrame;
    return {
      frame,
      scenes: [sampleScene(prev, frame - compiled.starts[index - 1]!, compiled.options), sampleScene(current, sceneFrame, compiled.options)],
      transition: { resolved: tIn, progressFrame, state: compiled.options.transitions.evaluate(tIn.transition, progressFrame, { box: current.canvas }) },
    };
  }
  return { frame, scenes: [sampleScene(current, sceneFrame, compiled.options)] };
}
