/**
 * Asset manifest of the Motion Library (`motion-library/assets/manifest.json`):
 * the licensed packs (transitions, lower thirds, overlays, icons, backgrounds,
 * Lottie, SFX, music) the local engine may use. Nothing is ever downloaded
 * automatically: a person adds the file and its entry, with its rights.
 * An entry without recorded rights, or not usable commercially, is rejected
 * (bible SRC-01), so the AI is never offered it.
 */
import type { Asset, AssetRegistry } from '../model/assets.js';

export const ASSET_PACK_CATEGORIES = ['transition', 'lower_third', 'overlay', 'icon', 'background', 'lottie', 'sfx', 'music', 'footage', 'image'] as const;
export type AssetPackCategory = (typeof ASSET_PACK_CATEGORIES)[number];

export interface AssetManifestEntry extends Asset {
  category: AssetPackCategory;
  tags?: string[];
}

export interface AssetManifest {
  version: 1;
  assets: AssetManifestEntry[];
}

export interface ManifestRejection {
  id: string;
  reason: string;
}

export interface LoadedAssetManifest {
  /** Usable assets, ready to merge into a plan's `assets`. */
  assets: AssetRegistry;
  /** Entries by category (ids), for pickers and the AI's asset choices. */
  byCategory: Partial<Record<AssetPackCategory, string[]>>;
  rejected: ManifestRejection[];
}

function rejectionOf(entry: AssetManifestEntry, seen: Set<string>): string | undefined {
  if (!entry.id) return 'no id';
  if (seen.has(entry.id)) return 'duplicate id';
  if (!ASSET_PACK_CATEGORIES.includes(entry.category)) return `unknown category "${String(entry.category)}"`;
  if (!entry.src) return 'no src';
  const s = entry.source;
  if (!s?.license || typeof s.commercialUse !== 'boolean') return 'no recorded license (source.license and source.commercialUse)';
  if (!s.commercialUse) return 'not usable commercially';
  if (s.attributionRequired && !s.attribution) return 'attribution required but no attribution text';
  return undefined;
}

/** Checks the rights of every entry and returns the usable ones. */
export function loadAssetManifest(manifest: AssetManifest): LoadedAssetManifest {
  const assets: AssetRegistry = {};
  const byCategory: LoadedAssetManifest['byCategory'] = {};
  const rejected: ManifestRejection[] = [];
  const seen = new Set<string>();
  if (manifest.version !== 1) return { assets, byCategory, rejected: [{ id: '*', reason: `unsupported manifest version ${String(manifest.version)}` }] };
  for (const entry of manifest.assets ?? []) {
    const reason = rejectionOf(entry, seen);
    if (entry.id) seen.add(entry.id);
    if (reason) {
      rejected.push({ id: entry.id ?? '?', reason });
      continue;
    }
    const { category, tags, ...asset } = entry;
    assets[entry.id] = { ...asset, metadata: { ...asset.metadata, category, ...(tags ? { tags } : {}) } };
    (byCategory[category] ??= []).push(entry.id);
  }
  return { assets, byCategory, rejected };
}
