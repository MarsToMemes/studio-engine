/**
 * Picture checks on a rendered video, from small grayscale frames (e.g.
 * 96×54, decoded by FFmpeg): black / empty frames (bible TECH-03) and frozen
 * picture (RHY-03). Pure functions: decoding is the caller's job.
 */
import { getShotStartFrames, resolveShotTransitions } from '../shotplan/timeline.js';
import type { ShotPlan } from '../shotplan/types.js';

export interface FrameStats {
  /** Mean luma, 0..1. */
  mean: number;
  /** Share of pixels brighter than 0.15 (text, highlights). */
  bright: number;
}

/** Stats of one 8-bit grayscale frame. */
export function frameStats(gray: Uint8Array): FrameStats {
  let sum = 0;
  let bright = 0;
  for (const v of gray) {
    sum += v;
    if (v > 38) bright++;
  }
  return { mean: sum / gray.length / 255, bright: bright / gray.length };
}

/** Mean absolute difference between two grayscale frames, 0..1. */
export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
  return d / a.length / 255;
}

export type DarkKind = 'black' | 'empty';

/** `black`: true black (mean < 3.5 %). `empty`: a uniform dark frame with nothing on it (the theme background). */
export function darkKind(s: FrameStats): DarkKind | undefined {
  if (s.bright > 0.001) return undefined;
  if (s.mean < 0.035) return 'black';
  if (s.mean < 0.1) return 'empty';
  return undefined;
}

export interface FrameRun {
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
}

/** Runs of consecutive frames for which `test` holds. */
export function runsOf<T>(items: readonly T[], test: (item: T, index: number) => boolean): FrameRun[] {
  const runs: FrameRun[] = [];
  let start = -1;
  items.forEach((item, i) => {
    if (test(item, i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push({ startFrame: start, endFrame: i });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ startFrame: start, endFrame: items.length });
  return runs;
}

export interface ExpectedWindow extends FrameRun {
  reason: string;
}

/** Shot types on a dark background whose content enters after the cut. */
const TYPOGRAPHIC = new Set(['text', 'revelation', 'number', 'chart', 'chapter']);

/**
 * Where a dark or empty picture is intended: chapter cards, dips to black,
 * blackout reveals, the entrance of typographic shots, the very start and end.
 */
export function expectedDarkWindows(plan: ShotPlan): ExpectedWindow[] {
  const starts = getShotStartFrames(plan);
  const transitions = resolveShotTransitions(plan);
  const entrance = Math.round(plan.fps * 0.8);
  const end = starts.length ? starts[starts.length - 1]! + plan.shots[plan.shots.length - 1]!.durationInFrames : 0;
  const out: ExpectedWindow[] = [
    { startFrame: 0, endFrame: Math.round(plan.fps * 0.5), reason: 'opening' },
    { startFrame: Math.max(0, end - Math.round(plan.fps * 0.5)), endFrame: end, reason: 'ending' },
  ];
  plan.shots.forEach((shot, i) => {
    const start = starts[i]!;
    const stop = start + shot.durationInFrames;
    if (shot.type === 'chapter') out.push({ startFrame: start, endFrame: stop, reason: `chapter card "${shot.id}"` });
    else if (shot.motionSkill === 'blackout_reveal') out.push({ startFrame: start, endFrame: stop, reason: `blackout reveal "${shot.id}"` });
    else if (TYPOGRAPHIC.has(shot.type)) out.push({ startFrame: start, endFrame: start + entrance, reason: `entrance of "${shot.id}"` });
    const t = transitions[i]!;
    if (t.id === 'fade' && t.transition) {
      const d = t.transition.durationInFrames;
      out.push({ startFrame: Math.max(0, start - d), endFrame: start + d, reason: `dip to black before "${shot.id}"` });
    }
  });
  return out.sort((a, b) => a.startFrame - b.startFrame);
}

/** Frames of a run that no expected window covers, as runs. */
export function uncoveredRuns(run: FrameRun, windows: readonly FrameRun[]): FrameRun[] {
  const covered = (f: number) => windows.some((w) => f >= w.startFrame && f < w.endFrame);
  const frames = Array.from({ length: run.endFrame - run.startFrame }, (_, k) => run.startFrame + k);
  return runsOf(frames, (f) => !covered(f)).map((r) => ({ startFrame: frames[r.startFrame]!, endFrame: frames[r.endFrame - 1]! + 1 }));
}
