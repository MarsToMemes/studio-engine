import type { VideoLayer } from '../model/layer.js';
import type { AudioTrack, VoiceoverSegment } from '../model/audio.js';

export interface MediaPlayback {
  /** Source frame to start from (Remotion `startFrom` / `trimBefore`). */
  startFrom: number;
  /** Source frame to stop at, exclusive (Remotion `endAt` / `trimAfter`). */
  endAt?: number;
  playbackRate: number;
  loop: boolean;
  volume: number;
  muted: boolean;
}

export function getMediaPlayback(media: Pick<VideoLayer, 'trim' | 'playbackRate' | 'loop' | 'volume' | 'muted'> | AudioTrack | VoiceoverSegment): MediaPlayback {
  const m = media as Partial<VideoLayer & AudioTrack>;
  return {
    startFrom: m.trim?.startFrom ?? 0,
    ...(m.trim?.endAt !== undefined ? { endAt: m.trim.endAt } : {}),
    playbackRate: m.playbackRate ?? 1,
    loop: m.loop ?? false,
    volume: m.volume ?? 1,
    muted: m.muted ?? false,
  };
}
