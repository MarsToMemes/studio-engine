import { describe, expect, it } from 'vitest';
import {
  animationProgressAt,
  createLayer,
  findSceneIndexAtFrame,
  framesToSeconds,
  getLayerDuration,
  getLayerEndFrame,
  getSceneDuration,
  getSceneEndFrame,
  getSceneStartFrame,
  getSceneStartFrames,
  getTimelineDuration,
  getTransitionBetween,
  resolveAnimationWindow,
  resolveSceneTiming,
  resolveTimeline,
  secondsToFrames,
  type Transition,
} from '../src/index.js';
import { simpleProject } from './helpers.js';

const fade = (d: number): Transition => ({ type: 'crossfade', durationInFrames: d });

describe('frame conversions', () => {
  it('rounds seconds to integer frames and never goes negative', () => {
    expect(secondsToFrames(1.5, 30)).toBe(45);
    expect(secondsToFrames(0.26, 30)).toBe(8);
    expect(secondsToFrames(-1, 30)).toBe(0);
    expect(framesToSeconds(45, 30)).toBe(1.5);
  });
});

describe('scene timing', () => {
  it('lays scenes back to back without transitions', () => {
    const { scenes } = simpleProject([90, 60, 30]);
    expect(getSceneStartFrames(scenes)).toEqual([0, 90, 150]);
    expect(getTimelineDuration(scenes)).toBe(180);
    expect(getSceneDuration(scenes[1]!)).toBe(60);
    expect(getSceneEndFrame(scenes, 1)).toBe(150);
  });

  it('subtracts transition overlaps like <TransitionSeries>', () => {
    const { scenes } = simpleProject([90, 60, 30], [undefined, fade(15), fade(10)]);
    expect(getSceneStartFrames(scenes)).toEqual([0, 75, 125]);
    expect(getTimelineDuration(scenes)).toBe(180 - 25);
    expect(getSceneStartFrame(scenes, 2)).toBe(125);
    expect(getSceneEndFrame(scenes, 2)).toBe(155);
  });

  it('treats cuts as zero overlap even with a duration', () => {
    const { scenes } = simpleProject([90, 60], [undefined, { type: 'cut', durationInFrames: 12 }]);
    expect(getTimelineDuration(scenes)).toBe(150);
  });

  it('prefers the incoming transitionIn over the outgoing transitionOut', () => {
    const { scenes } = simpleProject([90, 60], [undefined, fade(20)]);
    scenes[0]!.transitionOut = fade(8);
    expect(getTransitionBetween(scenes[0]!, scenes[1]!)?.durationInFrames).toBe(20);
    delete scenes[1]!.transitionIn;
    expect(getTransitionBetween(scenes[0]!, scenes[1]!)?.durationInFrames).toBe(8);
    expect(getTimelineDuration(scenes)).toBe(142);
  });

  it('resolves overlap and edge transitions', () => {
    const { scenes } = simpleProject([90, 60], [fade(10), fade(15)]);
    scenes[1]!.transitionOut = fade(12);
    const first = resolveSceneTiming(scenes, 0);
    expect(first.transitionIn).toMatchObject({ placement: 'edge', startFrame: 0, endFrame: 10 });
    expect(first.transitionOut).toMatchObject({ placement: 'overlap', startFrame: 75, endFrame: 90, toSceneId: 's1' });
    const second = resolveSceneTiming(scenes, 1);
    expect(second).toMatchObject({ startFrame: 75, endFrame: 135 });
    expect(second.transitionIn).toMatchObject({ placement: 'overlap', startFrame: 75, endFrame: 90, fromSceneId: 's0' });
    expect(second.transitionOut).toMatchObject({ placement: 'edge', startFrame: 123, endFrame: 135 });
    // Edge transitions never change the total.
    expect(getTimelineDuration(scenes)).toBe(135);
  });

  it('throws on an out-of-range scene index', () => {
    const { scenes } = simpleProject([30]);
    expect(() => getSceneStartFrame(scenes, 1)).toThrow(RangeError);
  });

  it('finds the scene at a frame (incoming scene wins during overlaps)', () => {
    const { scenes } = simpleProject([90, 60, 30], [undefined, fade(15), fade(10)]);
    const starts = getSceneStartFrames(scenes);
    const durations = scenes.map((s) => s.durationInFrames);
    expect(findSceneIndexAtFrame(starts, durations, 0)).toBe(0);
    expect(findSceneIndexAtFrame(starts, durations, 74)).toBe(0);
    expect(findSceneIndexAtFrame(starts, durations, 75)).toBe(1);
    expect(findSceneIndexAtFrame(starts, durations, 154)).toBe(2);
    expect(findSceneIndexAtFrame(starts, durations, 155)).toBe(-1);
  });
});

describe('layer timing', () => {
  const scene = { durationInFrames: 100 };
  it('defaults to the rest of the scene', () => {
    const l = createLayer('shape', { shape: 'rect', startFrame: 30 });
    expect(getLayerDuration(l, scene)).toBe(70);
    expect(getLayerEndFrame(l, scene)).toBe(100);
  });
  it('clips layers that overflow the scene', () => {
    const l = createLayer('shape', { shape: 'rect', startFrame: 80, durationInFrames: 50 });
    expect(getLayerDuration(l, scene)).toBe(20);
    expect(getLayerEndFrame(l, scene)).toBe(100);
  });
});

describe('animation windows', () => {
  const ctx = { ownerDurationInFrames: 100, fps: 30 };
  it('in / during start from startFrame, default to the rest of the owner', () => {
    expect(resolveAnimationWindow({ type: 'fade', phase: 'in', durationInFrames: 15 }, ctx)).toEqual({ startFrame: 0, durationInFrames: 15, endFrame: 15, iterations: 1 });
    expect(resolveAnimationWindow({ type: 'fade', startFrame: 40 }, ctx)).toMatchObject({ startFrame: 40, durationInFrames: 60, endFrame: 100 });
  });
  it('out phase is anchored to the owner end', () => {
    expect(resolveAnimationWindow({ type: 'fade', phase: 'out', durationInFrames: 20 }, ctx)).toMatchObject({ startFrame: 80, endFrame: 100 });
    expect(resolveAnimationWindow({ type: 'fade', phase: 'out', durationInFrames: 20, startFrame: 10 }, ctx)).toMatchObject({ startFrame: 70, endFrame: 90 });
  });
  it('handles repeat and loop', () => {
    expect(resolveAnimationWindow({ type: 'rotate', durationInFrames: 20, repeat: 2 }, ctx)).toMatchObject({ endFrame: 60, iterations: 3 });
    expect(resolveAnimationWindow({ type: 'rotate', durationInFrames: 20, loop: true }, ctx)).toMatchObject({ endFrame: 100, iterations: Infinity });
  });
  it('keyframes default to their last keyframe', () => {
    const w = resolveAnimationWindow({ type: 'keyframes', tracks: [{ property: 'scale', keyframes: [{ frame: 0, value: 1 }, { frame: 45, value: 1.2 }] }] }, ctx);
    expect(w.durationInFrames).toBe(45);
  });
  it('typewriter derives its duration from characters per second', () => {
    const w = resolveAnimationWindow({ type: 'typewriter', charactersPerSecond: 30 }, { ...ctx, text: 'x'.repeat(45) });
    expect(w.durationInFrames).toBe(45);
  });
  it('counts units with the split of each animation', () => {
    const text = 'Hello big world';
    const words = resolveAnimationWindow({ type: 'kineticTypography', style: 'pop', split: 'words', each: 2, durationInFrames: 10 }, { ...ctx, text });
    const chars = resolveAnimationWindow({ type: 'kineticTypography', style: 'pop', split: 'characters', each: 2, durationInFrames: 10 }, { ...ctx, text });
    expect(words.endFrame).toBe(10 + 2 * 2);
    expect(chars.endFrame).toBe(10 + 2 * 14);
  });
  it('stagger spans every unit', () => {
    const w = resolveAnimationWindow({ type: 'stagger', each: 5, animation: { type: 'fade', durationInFrames: 10 } }, { ...ctx, unitCount: 4 });
    expect(w).toMatchObject({ durationInFrames: 10, endFrame: 25 });
  });
  it('progress handles delay, repeat and yoyo', () => {
    const w = { startFrame: 10, durationInFrames: 20, iterations: 2 };
    expect(animationProgressAt({}, w, 5)).toBe(0);
    expect(animationProgressAt({}, w, 20)).toBeCloseTo(0.5);
    expect(animationProgressAt({}, w, 35)).toBeCloseTo(0.25);
    expect(animationProgressAt({ yoyo: true }, w, 35)).toBeCloseTo(0.75);
    expect(animationProgressAt({ yoyo: true }, w, 100)).toBe(0);
    expect(animationProgressAt({}, w, 100)).toBe(1);
    expect(animationProgressAt({}, w, 25, 10)).toBeCloseTo(0.25);
  });
});

describe('resolveTimeline', () => {
  it('derives absolute frames for layers, audio, captions and exposes tracks', () => {
    const project = simpleProject([90, 60], [undefined, fade(15)]);
    project.assets = { vo: { id: 'vo', kind: 'audio', src: 'vo.mp3', durationInSeconds: 1 }, m: { id: 'm', kind: 'audio', src: 'm.mp3' } };
    const s1 = project.scenes[1]!;
    s1.layers[0]!.startFrame = 10;
    s1.layers[0]!.animations = [{ type: 'fade', phase: 'in', durationInFrames: 12 }];
    s1.voiceover = { id: 'v', assetId: 'vo', durationInFrames: 50, startFrame: 5 };
    s1.captions = { id: 'c', cues: [{ id: 'q', text: 'hi', startFrame: 5, endFrame: 40 }] };
    project.audio = [{ id: 'music', assetId: 'm', role: 'music' }];

    const t = resolveTimeline(project);
    expect(t.durationInFrames).toBe(135);
    const rs = t.scenes[1]!;
    expect(rs.startFrame).toBe(75);
    expect(rs.layers[0]).toMatchObject({ localStartFrame: 10, startFrame: 85, endFrame: 135, durationInFrames: 50 });
    expect(rs.layers[0]!.animations[0]).toMatchObject({ absoluteStartFrame: 85, absoluteEndFrame: 97 });
    // An explicit durationInFrames wins over the asset length.
    expect(rs.voiceover).toMatchObject({ startFrame: 80, endFrame: 130 });
    expect(rs.captions).toMatchObject({ startFrame: 80, endFrame: 115, cueCount: 1 });
    expect(t.audio.find((a) => a.id === 'music')).toMatchObject({ startFrame: 0, endFrame: 135 });
    expect(t.tracks.map((x) => x.id)).toEqual(expect.arrayContaining(['scenes', 'transitions', 'layers:z0', 'voiceover', 'captions', 'audio:music']));
    expect(t.clips.find((c) => c.kind === 'transition')).toMatchObject({ startFrame: 75, endFrame: 90 });
  });

  it('clamps audio without explicit duration to the asset length', () => {
    const project = simpleProject([300]);
    project.assets = { sfx: { id: 'sfx', kind: 'audio', src: 'sfx.mp3', durationInSeconds: 2 } };
    project.scenes[0]!.audio = [{ id: 'a', assetId: 'sfx', role: 'sfx', startFrame: 30, trim: { startFrom: 15 } }];
    expect(resolveTimeline(project).scenes[0]!.audio[0]).toMatchObject({ startFrame: 30, durationInFrames: 45 });
  });
});
