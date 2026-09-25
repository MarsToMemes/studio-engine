/**
 * The last step: the video and the mix are put together, the mix brought to
 * -14 LUFS / -1 dBTP (bible MUS-09) in two linear loudnorm passes (one gain:
 * silences and dynamics are kept). The video stream is copied, not re-encoded.
 */
import { judgeLoudness, LOUDNESS_TARGETS, loudnormSecondPass, parseLoudnorm, type LoudnessMeasure, type LoudnessTarget } from '@studio-engine/scene-engine';
import { runFfmpeg, type FfmpegTools } from './ffmpeg.js';

export function measureLoudness(tools: FfmpegTools, file: string, target: LoudnessTarget = LOUDNESS_TARGETS.master): LoudnessMeasure {
  return parseLoudnorm(runFfmpeg(tools, ['-i', file, '-vn', '-af', `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.lra}:print_format=json`, '-f', 'null', '-']));
}

export interface MuxOptions {
  /** Normalise to the target (default true). */
  master?: boolean;
  target?: LoudnessTarget;
  audioBitrate?: string;
}

export function muxAndMaster(tools: FfmpegTools, video: string, mix: string, output: string, options: MuxOptions = {}) {
  const target = options.target ?? LOUDNESS_TARGETS.master;
  // A silent mix has no loudness (-inf): it is muxed as is.
  let before: LoudnessMeasure | undefined;
  try {
    before = measureLoudness(tools, mix, target);
  } catch {
    before = undefined;
  }
  const filter = options.master === false || !before ? [] : ['-af', loudnormSecondPass(before, target)];
  runFfmpeg(tools, ['-y', '-i', video, '-i', mix, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', ...filter, '-ar', '48000', '-c:a', 'aac', '-b:a', options.audioBitrate ?? '320k', '-movflags', '+faststart', output]);
  if (!before) return undefined;
  const after = measureLoudness(tools, output, target);
  return { before, after, verdict: judgeLoudness(after, target) };
}
