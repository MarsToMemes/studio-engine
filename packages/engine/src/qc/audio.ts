/**
 * Sound checks on a rendered mix, from decoded PCM: the voice is really
 * there (TECH-01), controlled silences are silent (SIL), no unwanted gap
 * (TECH-08), no clipped sample (TECH-05). Pure functions.
 */

export interface AudioFrame {
  /** RMS level over the video frame, dBFS (-120 for digital silence). */
  rmsDb: number;
  /** Highest absolute sample, 0..1. */
  peak: number;
}

/** Per video frame levels of mono samples in -1..1. */
export function audioFrames(samples: Float32Array, sampleRate: number, fps: number): AudioFrame[] {
  const per = sampleRate / fps;
  const n = Math.floor(samples.length / per);
  const out: AudioFrame[] = [];
  for (let f = 0; f < n; f++) {
    const a = Math.round(f * per);
    const b = Math.round((f + 1) * per);
    let sum = 0;
    let peak = 0;
    for (let i = a; i < b; i++) {
      const v = samples[i]!;
      sum += v * v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    out.push({ rmsDb: sum > 0 ? Math.max(-120, 10 * Math.log10(sum / (b - a))) : -120, peak });
  }
  return out;
}

/** Mean power over a frame range, dBFS. */
export function meanLevelDb(frames: readonly AudioFrame[], startFrame: number, endFrame: number): number {
  const slice = frames.slice(Math.max(0, startFrame), Math.min(frames.length, endFrame));
  if (!slice.length) return -120;
  const power = slice.reduce((s, f) => s + Math.pow(10, f.rmsDb / 10), 0) / slice.length;
  return power > 0 ? Math.max(-120, 10 * Math.log10(power)) : -120;
}

/** Share of frames of a range whose level is over `db` (robust to a loud instant in a silent range). */
export function activeShare(frames: readonly AudioFrame[], startFrame: number, endFrame: number, db: number): number {
  const slice = frames.slice(Math.max(0, startFrame), Math.min(frames.length, endFrame));
  return slice.length ? slice.filter((f) => f.rmsDb > db).length / slice.length : 0;
}

/** Thresholds of the audio checks (dBFS). */
export const AUDIO_QC = {
  /** A voice segment is heard when at least `voiceMinShare` of its frames are over `voiceMissingDb`. */
  voiceMissingDb: -45,
  voiceMinShare: 0.3,
  /** Over this, a controlled silence is not silent. */
  silenceMaxDb: -45,
  /** A gap: under this level… */
  gapDb: -60,
  /** …for longer than this. */
  gapSeconds: 1.5,
  /** A sample at or over this is clipped. */
  clipPeak: 0.999,
} as const;
