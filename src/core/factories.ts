/**
 * Factories that create valid model objects with explicit defaults.
 * They are plain functions: no global state, no hidden registries.
 */
import type { Background } from '../model/background.js';
import type { Layer, LayerOfType, LayerType } from '../model/layer.js';
import type { AspectRatio } from '../model/primitives.js';
import type { Scene, SceneType, VideoProject } from '../model/scene.js';
import { secondsToFrames } from '../timing/frames.js';
import { dimensionsForAspectRatio } from './aspectRatio.js';
import { randomIds, type IdGenerator } from './ids.js';
import { FULL_FRAME } from './layout.js';
import { defaultSceneTypeRegistry, type SceneTypeRegistry } from './sceneTypes.js';

export const SCHEMA_VERSION = 1;
export const DEFAULT_FPS = 30;

export interface CreateProjectOptions {
  id?: string;
  name?: string;
  fps?: number;
  aspectRatio?: AspectRatio;
  /** Short side of the canvas, defaults to 1080. Ignored when `dimensions` is set. */
  resolution?: number;
  dimensions?: { width: number; height: number };
  background?: Background;
  ids?: IdGenerator;
}

export function createProject(options: CreateProjectOptions = {}): VideoProject {
  const ids = options.ids ?? randomIds;
  const aspectRatio = options.aspectRatio ?? '16:9';
  return {
    id: options.id ?? ids('project'),
    ...(options.name ? { name: options.name } : {}),
    schemaVersion: SCHEMA_VERSION,
    fps: options.fps ?? DEFAULT_FPS,
    dimensions: options.dimensions ?? dimensionsForAspectRatio(aspectRatio, options.resolution),
    aspectRatio,
    background: options.background ?? { type: 'color', color: '#000000' },
    scenes: [],
    assets: {},
    audio: [],
  };
}

export type SceneInit = Partial<Omit<Scene, 'type'>>;

export interface FactoryContext {
  fps?: number;
  ids?: IdGenerator;
  sceneTypes?: SceneTypeRegistry;
}

export function createScene(type: SceneType, init: SceneInit = {}, ctx: FactoryContext = {}): Scene {
  const ids = ctx.ids ?? randomIds;
  const fps = ctx.fps ?? init.fps ?? DEFAULT_FPS;
  const def = (ctx.sceneTypes ?? defaultSceneTypeRegistry).get(type);
  const scene: Scene = {
    id: init.id ?? ids('scene'),
    type,
    durationInFrames: init.durationInFrames ?? secondsToFrames(def?.defaultDurationInSeconds ?? 4, fps),
    background: init.background ?? { type: 'none' },
    layers: init.layers ?? [],
    audio: init.audio ?? [],
    animations: init.animations ?? [],
    effects: init.effects ?? [],
  };
  if (init.startFrame !== undefined) scene.startFrame = init.startFrame;
  if (init.fps !== undefined) scene.fps = init.fps;
  if (init.aspectRatio !== undefined) scene.aspectRatio = init.aspectRatio;
  if (init.voiceover) scene.voiceover = init.voiceover;
  if (init.captions) scene.captions = init.captions;
  if (init.transitionIn) scene.transitionIn = init.transitionIn;
  if (init.transitionOut) scene.transitionOut = init.transitionOut;
  const role = init.metadata?.role ?? def?.defaultRole;
  if (init.metadata || role) scene.metadata = { ...(role ? { role } : {}), ...init.metadata };
  return scene;
}

/** Fields every layer has a default for. */
type LayerDefaults = 'id' | 'type' | 'zIndex' | 'position' | 'scale' | 'rotation' | 'opacity' | 'animations' | 'effects';

export type LayerInit<T extends LayerType> = Omit<LayerOfType<T>, LayerDefaults> & Partial<Pick<LayerOfType<T>, Exclude<LayerDefaults, 'type'>>>;

export function createLayer<T extends LayerType>(type: T, init: LayerInit<T>, ctx: Pick<FactoryContext, 'ids'> = {}): LayerOfType<T> {
  const ids = ctx.ids ?? randomIds;
  return {
    zIndex: 0,
    position: { ...FULL_FRAME },
    scale: 1,
    rotation: 0,
    opacity: 1,
    animations: [],
    effects: [],
    ...init,
    id: init.id ?? ids('layer'),
    type,
  } as unknown as LayerOfType<T>;
}

/** Next free zIndex on top of the existing layers. */
export function nextZIndex(layers: readonly Layer[]): number {
  let max = -1;
  for (const l of layers) max = Math.max(max, l.zIndex);
  return max + 1;
}
