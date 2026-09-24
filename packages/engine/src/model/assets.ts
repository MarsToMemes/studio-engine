/**
 * Assets are stored once per project in an id-keyed registry. Layers, audio
 * tracks and backgrounds only reference them by `assetId`, which keeps long
 * projects free of duplicated URLs / metadata and lets the renderer preload
 * each asset exactly once.
 */
import type { JsonObject, Seconds } from './primitives.js';

export type AssetId = string;

export type AssetKind = 'video' | 'image' | 'audio' | 'lottie' | 'dotlottie' | 'font' | 'svg' | 'json';

export interface Asset {
  id: AssetId;
  kind: AssetKind;
  /** URL, `staticFile()` path or any URI the renderer knows how to resolve. */
  src: string;
  mimeType?: string;
  width?: number;
  height?: number;
  /** Intrinsic duration of time-based media. */
  durationInSeconds?: Seconds;
  /** Intrinsic frame rate of video / Lottie assets. */
  fps?: number;
  /** Content hash, used for dedupe and cache keys. */
  checksum?: string;
  /** Licensing / provenance, e.g. stock provider id. */
  /** Provenance and rights (bible SRC-01): never use an asset whose rights are uncertain. */
  source?: AssetSource;
  metadata?: JsonObject;
}

export type AssetRegistry = Record<AssetId, Asset>;

export interface AssetSource {
  /** Where the asset comes from: "own production", "Pexels", "McDonald's IR", … */
  provider?: string;
  /** Id of the asset at the provider. */
  id?: string;
  url?: string;
  /** License name, e.g. "CC0", "Pexels License", "press use", "own". */
  license?: string;
  commercialUse?: boolean;
  attributionRequired?: boolean;
  /** Attribution text to publish when required. */
  attribution?: string;
  /** True for realistic AI-generated video (YouTube synthetic-content disclosure, bible SRC-04). */
  syntheticMedia?: boolean;
}
