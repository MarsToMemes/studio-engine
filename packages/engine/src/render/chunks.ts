/**
 * Chunked rendering with a cache: the video is rendered in chunks of a few
 * scenes, each identified by a key built from everything that can change
 * its pixels. After an edit, only the chunks whose key changed are
 * re-rendered; the others come from the cache. Pure functions: hashing and
 * files are the Node renderer's job (@studio-engine/render).
 */
import { getSceneStartFrames, getTimelineDuration } from '../timing/timeline.js';
import { collectSceneAssetReferences } from '../assets/library.js';
import type { VideoProject } from '../model/scene.js';

export interface RenderChunk {
  index: number;
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
  /** Scenes that start in the chunk. */
  sceneIds: string[];
  /** Scenes seen in the chunk: its own, and the previous one while a transition overlaps its start. */
  dependsOn: string[];
}

export interface ChunkPlanOptions {
  /** Average scenes per chunk (content-defined, see below). Default 3. */
  groupSize?: number;
  /** Hard maximum of scenes per chunk. Default 8. */
  maxScenes?: number;
}

/** FNV-1a 32-bit: a stable, fast hash of a string (not for security). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Chunks of consecutive scenes. A chunk ends after a scene whose id hashes to
 * a multiple of `groupSize` (content-defined boundaries, like rsync): inserting
 * or removing a scene only changes the chunk around it, the later chunks keep
 * their scenes and therefore their keys.
 */
export function planRenderChunks(project: Pick<VideoProject, 'scenes'>, options: ChunkPlanOptions = {}): RenderChunk[] {
  const groupSize = Math.max(1, options.groupSize ?? 3);
  const maxScenes = Math.max(1, options.maxScenes ?? 8);
  const scenes = project.scenes;
  const starts = getSceneStartFrames(scenes);
  const total = getTimelineDuration(scenes);
  const groups: number[][] = [];
  let current: number[] = [];
  scenes.forEach((scene, i) => {
    current.push(i);
    if (fnv1a(scene.id) % groupSize === 0 || current.length >= maxScenes) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length) groups.push(current);
  return groups.map((g, index) => {
    const first = g[0]!;
    const startFrame = starts[first]!;
    const next = groups[index + 1];
    const endFrame = next ? starts[next[0]!]! : total;
    const prev = first > 0 ? first - 1 : undefined;
    const overlaps = prev !== undefined && starts[prev]! + scenes[prev]!.durationInFrames > startFrame;
    const ids = g.map((i) => scenes[i]!.id);
    return { index, startFrame, endFrame, sceneIds: ids, dependsOn: overlaps ? [scenes[prev!]!.id, ...ids] : ids };
  });
}

/** JSON with sorted keys: the same data always gives the same text. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export interface ChunkKeyContext {
  /** Version of the rendering code (e.g. a hash of the Remotion bundle): a code change invalidates every chunk. */
  rendererVersion: string;
  /** Fingerprint of an asset's content (e.g. size + hash of the file). Default: its `checksum` or `src`. */
  assetFingerprint?: (assetId: string) => string;
  /** Render settings that change pixels (codec, CRF, scale…). */
  settings?: Record<string, unknown>;
}

/**
 * Everything that decides a chunk's pixels, as stable text (hash it for the
 * cache key): its length, the scenes it shows with their offset in the chunk,
 * the assets they use, the canvas, the renderer version and the settings.
 * Absolute positions are left out, so a chunk that only moved in time (an
 * earlier scene got longer) keeps its key.
 */
export function chunkKeyMaterial(project: VideoProject, chunk: RenderChunk, context: ChunkKeyContext): string {
  const starts = getSceneStartFrames(project.scenes);
  const index = new Map(project.scenes.map((s, i) => [s.id, i]));
  const scenes = chunk.dependsOn.map((id) => {
    const i = index.get(id)!;
    return { offset: starts[i]! - chunk.startFrame, scene: project.scenes[i] };
  });
  const assetIds = [...new Set(chunk.dependsOn.flatMap((id) => collectSceneAssetReferences(project.scenes[index.get(id)!]!, 's').map((r) => r.assetId)))].sort();
  const fingerprint = context.assetFingerprint ?? ((id: string) => project.assets[id]?.checksum ?? project.assets[id]?.src ?? 'missing');
  return stableStringify({
    v: 1,
    renderer: context.rendererVersion,
    settings: context.settings ?? {},
    canvas: { fps: project.fps, dimensions: project.dimensions, background: project.background },
    length: chunk.endFrame - chunk.startFrame,
    scenes,
    assets: assetIds.map((id) => ({ id, asset: project.assets[id], content: fingerprint(id) })),
  });
}
