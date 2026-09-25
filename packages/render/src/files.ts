/** Where an asset's file is, and what identifies its content (cache keys). */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Asset } from '@studio-engine/scene-engine';

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Local path of an asset, or its URL when it is remote. Relative sources live in `publicDir` (as for Remotion's staticFile). */
export function assetLocation(asset: Pick<Asset, 'src'>, publicDir: string): { path?: string; url?: string } {
  const src = asset.src;
  if (/^https?:\/\//.test(src)) return { url: src };
  if (src.startsWith('file://')) return { path: fileURLToPath(src) };
  return { path: isAbsolute(src) ? src : join(publicDir, src) };
}

/**
 * Content fingerprint: the declared checksum, else size + modification time
 * of the file (cheap; a copied file is only a cache miss), else the URL.
 */
export function assetFingerprint(asset: Asset | undefined, publicDir: string): string {
  if (!asset) return 'missing';
  if (asset.checksum) return `sum:${asset.checksum}`;
  const loc = assetLocation(asset, publicDir);
  if (loc.url) return `url:${loc.url}`;
  if (!loc.path || !existsSync(loc.path)) return `absent:${asset.src}`;
  const s = statSync(loc.path);
  return `file:${s.size}:${Math.round(s.mtimeMs)}`;
}

/** Hash of the JavaScript of a Remotion bundle: the version of the rendering code. */
export function bundleVersion(bundleDir: string): string {
  const files = readdirSync(bundleDir).filter((f) => f.endsWith('.js')).sort();
  return sha256(files.map((f) => `${f}:${sha256(readFileSync(join(bundleDir, f)))}`).join('\n')).slice(0, 16);
}
