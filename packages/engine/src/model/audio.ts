/**
 * Audio lives outside the layer stack: it has no position and must be mixed,
 * not composited. Scene audio is relative to the scene start; project audio
 * (music beds spanning several scenes) is absolute.
 */
import type { AssetId } from './assets.js';
import type { Frames } from './primitives.js';
import type { MediaTrim } from './layer.js';

export type AudioRole = 'music' | 'sfx' | 'ambience' | 'voiceover' | 'source';

export interface AudioTrack {
  id: string;
  assetId: AssetId;
  role: AudioRole;
  /** Relative to the owner (scene or project). Defaults to 0. */
  startFrame?: Frames;
  /** Defaults to the asset length or the owner's remaining duration, whichever is shorter. */
  durationInFrames?: Frames;
  trim?: MediaTrim;
  /** 0..1 */
  volume?: number;
  fadeInFrames?: Frames;
  fadeOutFrames?: Frames;
  loop?: boolean;
  playbackRate?: number;
  /**
   * Lower this track while a voiceover is playing. `amount` is the volume
   * multiplier while ducked (0.25 = 25% of the normal volume).
   */
  ducking?: { amount: number; attackFrames?: Frames; releaseFrames?: Frames };
  muted?: boolean;
}

/**
 * The slice of the narration that belongs to a scene. When a project has one
 * long narration file, every scene points at the same asset with a different
 * `trim` window.
 */
export interface VoiceoverSegment {
  id: string;
  assetId: AssetId;
  /** Relative to the scene start. Defaults to 0. */
  startFrame?: Frames;
  durationInFrames: Frames;
  trim?: MediaTrim;
  volume?: number;
  /** Script text spoken in this segment. */
  text?: string;
  /** Caption track generated from this segment, if any. */
  captionTrackId?: string;
}
