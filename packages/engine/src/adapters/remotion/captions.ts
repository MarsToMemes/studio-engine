/**
 * Conversion between engine captions and `@remotion/captions`' `Caption` type,
 * without depending on the package (the shape is structural).
 *
 *   transcription (Whisper, ElevenLabs…) → Caption[] → fromRemotionCaptions → TranscriptWord[] → ShotPlan.narration.words
 *   scene CaptionTrack → toRemotionCaptions → createTikTokStyleCaptions() → pages
 */
import type { CaptionTrack } from '../../model/captions.js';
import type { TranscriptWord } from '../../shotplan/types.js';

/** Structural copy of `Caption` from `@remotion/captions`. */
export interface RemotionCaption {
  /** Remotion convention: words carry their leading space (" word"). */
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
}

const frameToMs = (frame: number, fps: number) => (frame / fps) * 1000;

/**
 * Word-level captions for a scene track. Times are relative to the scene
 * start plus `offsetFrames` (pass the scene's absolute start for episode-level
 * captions). Cues without word timings become one caption each.
 */
export function toRemotionCaptions(track: CaptionTrack, fps: number, offsetFrames = 0): RemotionCaption[] {
  return track.cues.flatMap((cue) => {
    const items = cue.words && cue.words.length > 0 ? cue.words : [{ text: cue.text, startFrame: cue.startFrame, endFrame: cue.endFrame }];
    return items.map((w) => ({
      text: ` ${w.text.trim()}`,
      startMs: frameToMs(w.startFrame + offsetFrames, fps),
      endMs: frameToMs(w.endFrame + offsetFrames, fps),
      timestampMs: null,
      confidence: 'confidence' in w && typeof w.confidence === 'number' ? w.confidence : null,
    }));
  });
}

/** Transcription output (e.g. `toCaptions()` from @remotion/install-whisper-cpp) → narration words. */
export function fromRemotionCaptions(captions: readonly RemotionCaption[]): TranscriptWord[] {
  return captions
    .map((c) => ({ text: c.text.trim(), startMs: c.startMs, endMs: c.endMs, ...(c.confidence !== null ? { confidence: c.confidence } : {}) }))
    .filter((w) => w.text !== '');
}
