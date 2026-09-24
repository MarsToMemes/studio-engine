import type { Frames } from './primitives.js';

export interface CaptionWord {
  text: string;
  /** Relative to the scene start. */
  startFrame: Frames;
  endFrame: Frames;
  confidence?: number;
}

export interface CaptionCue {
  id: string;
  text: string;
  /** Relative to the scene start. */
  startFrame: Frames;
  /** Exclusive. */
  endFrame: Frames;
  words?: CaptionWord[];
  speaker?: string;
}

export interface CaptionTrack {
  id: string;
  language?: string;
  cues: CaptionCue[];
}
