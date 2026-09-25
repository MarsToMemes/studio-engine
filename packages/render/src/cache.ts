/**
 * The render cache (.studio-cache): chunks (Remotion), draft segments,
 * decoded sources, mixes. A file used by a render is touched, so pruning
 * removes what has not been used for the longest time.
 */
import { existsSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = ['chunks', 'draft', 'decoded', 'mix'] as const;

/** Marks a cache file as used now. */
export function touch(file: string): void {
  const now = new Date();
  try {
    utimesSync(file, now, now);
  } catch {
    // a cache file that vanished is only a miss next time
  }
}

export interface CacheEntry {
  kind: (typeof KINDS)[number];
  file: string;
  bytes: number;
  usedMs: number;
}

export function listCache(cacheDir: string): CacheEntry[] {
  return KINDS.flatMap((kind) => {
    const dir = join(cacheDir, kind);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => !f.includes('.tmp.'))
      .map((f) => {
        const s = statSync(join(dir, f));
        return { kind, file: join(dir, f), bytes: s.size, usedMs: s.mtimeMs };
      });
  });
}

/** Removes the least recently used files until the cache is under `maxBytes`. */
export function pruneCache(cacheDir: string, maxBytes: number): { removed: number; freedBytes: number; keptBytes: number } {
  const entries = listCache(cacheDir).sort((a, b) => a.usedMs - b.usedMs);
  let total = entries.reduce((s, e) => s + e.bytes, 0);
  let removed = 0;
  let freed = 0;
  for (const e of entries) {
    if (total <= maxBytes) break;
    rmSync(e.file, { force: true });
    total -= e.bytes;
    freed += e.bytes;
    removed++;
  }
  rmSync(join(cacheDir, 'work'), { recursive: true, force: true });
  return { removed, freedBytes: freed, keptBytes: total };
}
