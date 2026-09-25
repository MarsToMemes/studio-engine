/**
 * Loudness of a rendered mix or a voice file (bible MUS-01, MUS-09), measured
 * with FFmpeg's `loudnorm` filter (EBU R128 / ITU-R BS.1770), which every
 * FFmpeg build has, including Remotion's. This module only parses and judges:
 * running FFmpeg is the caller's job (packages/remotion/scripts/loudness.mjs,
 * or montage.py in the local engine).
 */

export interface LoudnessTarget {
  /** Integrated loudness, LUFS. */
  integrated: number;
  /** Accepted distance to `integrated`, LU. */
  tolerance: number;
  /** Maximum true peak, dBTP. */
  truePeak: number;
  /** Loudness range used by loudnorm when normalising, LU. */
  lra: number;
  rule: string;
}

/** The final mix: YouTube plays at -14 LUFS (MUS-09). The voice alone: -16 LUFS (MUS-01). */
export const LOUDNESS_TARGETS = {
  master: { integrated: -14, tolerance: 1, truePeak: -1, lra: 11, rule: 'MUS-09' },
  voice: { integrated: -16, tolerance: 1, truePeak: -1.5, lra: 7, rule: 'MUS-01' },
} as const satisfies Record<string, LoudnessTarget>;

export interface LoudnessMeasure {
  integrated: number;
  truePeak: number;
  lra: number;
  /** Gating threshold, needed by loudnorm's second pass. */
  threshold: number;
  /** loudnorm's `target_offset`, needed by the second pass. */
  offset: number;
}

/** Reads the JSON block that `loudnorm=print_format=json` writes to stderr. */
export function parseLoudnorm(stderr: string): LoudnessMeasure {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no loudnorm JSON in the FFmpeg output');
  const j = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  const n = (k: string) => {
    const v = Number(j[k]);
    if (!Number.isFinite(v)) throw new Error(`loudnorm: ${k} is "${j[k]}" (silent input?)`);
    return v;
  };
  return { integrated: n('input_i'), truePeak: n('input_tp'), lra: n('input_lra'), threshold: n('input_thresh'), offset: n('target_offset') };
}

export interface LoudnessIssue {
  code: 'mix.loudness' | 'mix.truePeak' | 'voice.loudness' | 'voice.truePeak';
  rule: string;
  message: string;
}

export interface LoudnessVerdict {
  pass: boolean;
  /** Gain that brings the integrated loudness on target, dB. */
  gainToTargetDb: number;
  issues: LoudnessIssue[];
}

export function judgeLoudness(m: LoudnessMeasure, target: LoudnessTarget, kind: 'mix' | 'voice' = 'mix'): LoudnessVerdict {
  const issues: LoudnessIssue[] = [];
  const gap = m.integrated - target.integrated;
  if (Math.abs(gap) > target.tolerance)
    issues.push({ code: `${kind}.loudness`, rule: target.rule, message: `${m.integrated.toFixed(1)} LUFS, target ${target.integrated} ±${target.tolerance} LU (${gap > 0 ? 'too loud' : 'too quiet'} by ${Math.abs(gap).toFixed(1)} LU)` });
  if (m.truePeak > target.truePeak) issues.push({ code: `${kind}.truePeak`, rule: target.rule, message: `true peak ${m.truePeak.toFixed(1)} dBTP, maximum ${target.truePeak} dBTP` });
  return { pass: issues.length === 0, gainToTargetDb: Number((target.integrated - m.integrated).toFixed(2)), issues };
}

/** loudnorm filter of the second (linear) pass, from the first pass measure. */
export function loudnormSecondPass(m: LoudnessMeasure, target: LoudnessTarget): string {
  return [
    `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.lra}`,
    `measured_I=${m.integrated}:measured_TP=${m.truePeak}:measured_LRA=${m.lra}:measured_thresh=${m.threshold}:offset=${m.offset}`,
    'linear=true:print_format=json',
  ].join(':');
}
