import type { Frames, Seconds } from '../model/primitives.js';

export function secondsToFrames(seconds: Seconds, fps: number): Frames {
  return Math.max(0, Math.round(seconds * fps));
}

export function framesToSeconds(frames: Frames, fps: number): Seconds {
  return frames / fps;
}

export function clampFrame(frame: number, min: Frames, max: Frames): Frames {
  return Math.min(max, Math.max(min, frame));
}
