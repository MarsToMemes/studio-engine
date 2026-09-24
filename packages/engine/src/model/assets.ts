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
  source?: { provider?: string; id?: string; license?: string; attribution?: string };
  metadata?: JsonObject;
}

export type AssetRegistry = Record<AssetId, Asset>;
