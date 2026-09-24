/**
 * Asset registry helpers. Assets are stored once and referenced by id; adding
 * the same media twice (same checksum, or same kind + src) returns the
 * existing id instead of creating a duplicate.
 */
import type { Asset, AssetId, AssetRegistry } from '../model/assets.js';
import type { Layer } from '../model/layer.js';
import type { Scene, VideoProject } from '../model/scene.js';
import { randomIds, type IdGenerator } from '../core/ids.js';

const keyOf = (a: Pick<Asset, 'kind' | 'src' | 'checksum'>) => (a.checksum ? `sum:${a.checksum}` : `src:${a.kind}:${a.src}`);

export class AssetLibrary {
  private readonly assets = new Map<AssetId, Asset>();
  private readonly index = new Map<string, AssetId>();

  constructor(
    initial: AssetRegistry = {},
    private readonly ids: IdGenerator = randomIds,
  ) {
    for (const asset of Object.values(initial)) {
      this.assets.set(asset.id, asset);
      this.index.set(keyOf(asset), asset.id);
    }
  }

  /** Add an asset, or return the id of an identical one already present. */
  add(asset: Omit<Asset, 'id'> & { id?: AssetId }): AssetId {
    const existing = this.index.get(keyOf(asset));
    if (existing) return existing;
    const id = asset.id ?? this.ids(asset.kind);
    if (this.assets.has(id)) throw new Error(`Asset id "${id}" already used by another asset`);
    const stored: Asset = { ...asset, id };
    this.assets.set(id, stored);
    this.index.set(keyOf(stored), id);
    return id;
  }

  get(id: AssetId): Asset | undefined {
    return this.assets.get(id);
  }

  get size(): number {
    return this.assets.size;
  }

  toRegistry(): AssetRegistry {
    return Object.fromEntries(this.assets);
  }
}

export interface AssetReference {
  assetId: AssetId;
  /** JSON path of the reference, e.g. `scenes[2].layers[0].assetId`. */
  path: string;
}

function layerRefs(layer: Layer, base: string, out: AssetReference[]): void {
  switch (layer.type) {
    case 'video':
    case 'image':
      out.push({ assetId: layer.assetId, path: `${base}.assetId` });
      break;
    case 'lottie':
      if (layer.source.kind === 'asset') out.push({ assetId: layer.source.assetId, path: `${base}.source.assetId` });
      break;
    case 'overlay':
      if (layer.assetId) out.push({ assetId: layer.assetId, path: `${base}.assetId` });
      break;
    case 'background':
      if (layer.background.type === 'image' || layer.background.type === 'video') out.push({ assetId: layer.background.assetId, path: `${base}.background.assetId` });
      break;
    default:
      break;
  }
  if (layer.mask?.type === 'asset') out.push({ assetId: layer.mask.assetId, path: `${base}.mask.assetId` });
  layer.effects.forEach((e, i) => {
    if (e.type === 'lut') out.push({ assetId: e.assetId, path: `${base}.effects[${i}].assetId` });
  });
}

export function collectSceneAssetReferences(scene: Scene, base: string, out: AssetReference[] = []): AssetReference[] {
  if (scene.background.type === 'image' || scene.background.type === 'video') out.push({ assetId: scene.background.assetId, path: `${base}.background.assetId` });
  scene.layers.forEach((l, i) => layerRefs(l, `${base}.layers[${i}]`, out));
  scene.audio.forEach((a, i) => out.push({ assetId: a.assetId, path: `${base}.audio[${i}].assetId` }));
  if (scene.voiceover) out.push({ assetId: scene.voiceover.assetId, path: `${base}.voiceover.assetId` });
  scene.effects.forEach((e, i) => {
    if (e.type === 'lut') out.push({ assetId: e.assetId, path: `${base}.effects[${i}].assetId` });
  });
  return out;
}

/** Every asset reference in the project, with its location. */
export function collectAssetReferences(project: Pick<VideoProject, 'scenes' | 'audio' | 'background'>): AssetReference[] {
  const out: AssetReference[] = [];
  if (project.background.type === 'image' || project.background.type === 'video') out.push({ assetId: project.background.assetId, path: 'background.assetId' });
  project.scenes.forEach((s, i) => collectSceneAssetReferences(s, `scenes[${i}]`, out));
  project.audio.forEach((a, i) => out.push({ assetId: a.assetId, path: `audio[${i}].assetId` }));
  return out;
}

/** Ids of the assets actually used, in first-use order (useful for preloading). */
export function getUsedAssetIds(project: Pick<VideoProject, 'scenes' | 'audio' | 'background'>): AssetId[] {
  return [...new Set(collectAssetReferences(project).map((r) => r.assetId))];
}

/** Copy of the project without unreferenced assets. */
export function pruneUnusedAssets(project: VideoProject): VideoProject {
  const used = new Set(getUsedAssetIds(project));
  return { ...project, assets: Object.fromEntries(Object.entries(project.assets).filter(([id]) => used.has(id))) };
}
