/** Container and stream checks of a rendered file (bible TECH-07), from ffprobe's JSON. */

export interface RenderProbe {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  durationSeconds: number;
  /** Frames of the video stream (the container duration also counts audio priming). */
  frameCount?: number;
  audioCodec?: string;
  audioSampleRate?: number;
  audioChannels?: number;
}

/** Reads `ffprobe -show_streams -show_format -of json`. */
export function parseFfprobe(json: string): RenderProbe {
  const j = JSON.parse(json) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const video = j.streams?.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('no video stream');
  const audio = j.streams?.find((s) => s.codec_type === 'audio');
  const [num, den] = String(video.avg_frame_rate ?? video.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    width: Number(video.width),
    height: Number(video.height),
    fps: den ? num! / den : num!,
    videoCodec: String(video.codec_name),
    durationSeconds: Number(video.duration ?? j.format?.duration ?? 0),
    ...(Number(video.nb_frames) > 0 ? { frameCount: Number(video.nb_frames) } : {}),
    ...(audio ? { audioCodec: String(audio.codec_name), audioSampleRate: Number(audio.sample_rate), audioChannels: Number(audio.channels) } : {}),
  };
}
