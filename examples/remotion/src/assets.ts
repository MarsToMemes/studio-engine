import { staticFile } from 'remotion';
import type { Asset } from '@studio-engine/scene-engine';

/** Absolute URLs pass through; relative paths are served from `public/`. */
export function resolveSrc(src: string): string {
  return /^(https?:|data:|blob:|\/)/.test(src) ? src : staticFile(src);
}

export const assetSrc = (asset: Asset | undefined): string | undefined => (asset ? resolveSrc(asset.src) : undefined);
