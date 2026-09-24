/**
 * Waveform peaks for the timeline, decoded with the Web Audio API (no extra
 * dependency). Peaks are computed once per file at a fixed resolution and
 * cached; drawing picks the max over the pixels' time range.
 */
export const PEAKS_PER_SECOND = 100;

export interface Peaks {
  /** Max absolute amplitude per bucket, 0..1. */
  data: Float32Array;
  perSecond: number;
  durationInSeconds: number;
}

/** Max |sample| over fixed buckets, merged across channels. */
export function computePeaks(channels: readonly Float32Array[], sampleRate: number, perSecond = PEAKS_PER_SECOND): Peaks {
  const length = channels[0]?.length ?? 0;
  const bucket = Math.max(1, Math.round(sampleRate / perSecond));
  const data = new Float32Array(Math.ceil(length / bucket));
  for (const ch of channels) {
    for (let i = 0; i < length; i++) {
      const v = Math.abs(ch[i]!);
      const b = (i / bucket) | 0;
      if (v > data[b]!) data[b] = v;
    }
  }
  return { data, perSecond: sampleRate / bucket, durationInSeconds: length / sampleRate };
}

/** Max peak over [fromSec, toSec), wrapping when the track loops. */
export function peakBetween(peaks: Peaks, fromSec: number, toSec: number, loop = false): number {
  const n = peaks.data.length;
  if (!n) return 0;
  let a = Math.floor(fromSec * peaks.perSecond);
  let b = Math.max(a + 1, Math.ceil(toSec * peaks.perSecond));
  if (!loop && a >= n) return 0;
  let max = 0;
  for (let i = a; i < b; i++) {
    const k = loop ? ((i % n) + n) % n : i;
    if (k >= n) break;
    const v = peaks.data[k]!;
    if (v > max) max = v;
  }
  return max;
}

const cache = new Map<string, Promise<Peaks>>();

export function loadPeaks(url: string): Promise<Peaks> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      return computePeaks(channels, buffer.sampleRate);
    })();
    // A failed load can be retried later (e.g. the file was being generated).
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
