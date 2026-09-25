/**
 * Sound design at render (bible §12, §13): the music follows its cues, and
 * controlled silences are really silent. Everything becomes gain automation
 * on the audio tracks (`AudioTrack.automation`), so the Remotion render, the
 * preview and the local FFmpeg mix all hear the same thing.
 */
import type { GainPoint } from '../model/audio.js';
import type { ResolvedSilence } from './editorial.js';
import type { MusicCue } from './types.js';
import type { MusicState, SilenceKind } from './vocabulary.js';

const dbToGain = (db: number): number => Math.pow(10, db / 20);

/**
 * Level of each music state relative to the bed (`music.gainDb`), and how fast
 * the music gets there. It rises slowly while the story builds, withdraws after
 * a revelation (MUS-04). A cue's own `gainDb` / `fadeInFrames` wins.
 */
export const MUSIC_STATE_LEVELS: Record<MusicState, { db: number; rampSeconds: number }> = {
  calm: { db: 0, rampSeconds: 1.5 },
  build: { db: 2, rampSeconds: 4 },
  tension: { db: 1, rampSeconds: 1 },
  reveal: { db: 3, rampSeconds: 0.1 },
  aftermath: { db: -4, rampSeconds: 1.5 },
};

/** How fast a controlled silence drops the sound: short, but never a click. */
export const SILENCE_DROP_SECONDS = 0.12;

export interface SilenceWindow {
  startFrame: number;
  endFrame: number;
  kinds: SilenceKind[];
}

export const silenceWindows = (silences: readonly ResolvedSilence[]): SilenceWindow[] =>
  silences.map((s) => ({ startFrame: s.startFrame, endFrame: s.endFrame, kinds: s.silence.kinds }));

/** True when an absolute frame falls in a silence of this kind. */
export function inSilence(frame: number, windows: readonly SilenceWindow[], kind: SilenceKind): boolean {
  return windows.some((w) => w.kinds.includes(kind) && frame >= w.startFrame && frame < w.endFrame);
}

/** Gain points that cut a bed during the silences of one kind, then give back `levelAt(end)` on the hit. */
function silencePoints(windows: readonly SilenceWindow[], kind: SilenceKind, fps: number, levelAt: (frame: number) => number): GainPoint[] {
  return windows
    .filter((w) => w.kinds.includes(kind))
    .flatMap((w) => [
      { frame: w.startFrame, gain: 0, rampFrames: Math.max(1, Math.min(Math.round(fps * SILENCE_DROP_SECONDS), Math.floor((w.endFrame - w.startFrame) / 2))) },
      { frame: w.endFrame, gain: levelAt(w.endFrame), rampFrames: 0 },
    ]);
}

/**
 * Music automation, in absolute frames: one point per cue (its state level,
 * ramped), and the `music_drop` silences. Levels are relative to the bed.
 */
export function musicAutomation(cues: readonly MusicCue[], windows: readonly SilenceWindow[], options: { fps: number; bedDb: number }): GainPoint[] {
  const { fps, bedDb } = options;
  const sorted = [...cues].sort((a, b) => a.atFrame - b.atFrame);
  // Automation gains stay within +12 dB of the bed (the audio track accepts 0..4).
  const gainOf = (c: MusicCue) => Math.min(4, c.gainDb !== undefined ? dbToGain(c.gainDb - bedDb) : dbToGain(MUSIC_STATE_LEVELS[c.state].db));
  const levelAt = (frame: number) => {
    const cue = [...sorted].reverse().find((c) => c.atFrame <= frame);
    return cue ? gainOf(cue) : 1;
  };
  const dropped = (frame: number) => inSilence(frame, windows, 'music_drop');
  const points: GainPoint[] = sorted
    .filter((c) => !dropped(c.atFrame))
    // The first state is the starting level (the music's own fade-in brings it in); later ones ramp.
    .map((c, i) => ({ frame: c.atFrame, gain: gainOf(c), rampFrames: c.fadeInFrames ?? (i === 0 ? 0 : Math.round(fps * MUSIC_STATE_LEVELS[c.state].rampSeconds)) }));
  points.push(...silencePoints(windows, 'music_drop', fps, levelAt));
  // At one frame, the silence (or its end) wins over a cue.
  return points.sort((a, b) => a.frame - b.frame || (a.gain === 0 ? 1 : 0) - (b.gain === 0 ? 1 : 0));
}

/** Ambience automation: silent during the `ambient_drop` silences. */
export function ambienceAutomation(windows: readonly SilenceWindow[], fps: number): GainPoint[] {
  return silencePoints(windows, 'ambient_drop', fps, () => 1);
}
