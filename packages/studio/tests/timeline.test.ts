import { describe, expect, it } from 'vitest';
import { buildShotPlanDemoProject, shotPlanDemo } from '@studio-engine/remotion';
import { getShotPlanDuration } from '@studio-engine/scene-engine';
import {
  addSfxAt,
  deleteShot,
  dropIndex,
  duplicateShot,
  fitZoom,
  formatTime,
  layoutTimeline,
  moveShot,
  moveSfx,
  removeSfx,
  shotAtFrame,
  snapFrame,
  snapTargets,
  trimShotEnd,
} from '../src/state/timeline';
import { setHighlightedWords } from '../src/state/plan';

const plan = shotPlanDemo;
const ids = (p: typeof plan) => p.shots.map((s) => s.id);
const block = (p: typeof plan, id: string) => layoutTimeline(p).shots.find((s) => s.id === id)!;

describe('timeline layout', () => {
  it('derives blocks, transition overlaps, sfx markers and narration words', () => {
    const layout = layoutTimeline(plan, buildShotPlanDemoProject());
    expect(layout.durationInFrames).toBe(getShotPlanDuration(plan));
    expect(layout.shots.map((s) => s.id)).toEqual(ids(plan));
    expect(layout.shots[0]!.transitionInFrames).toBe(0);
    // kitchen comes in with a dissolve: it starts before the previous shot ends.
    const counter = layout.shots.find((s) => s.id === 'counter')!;
    const kitchen = layout.shots.find((s) => s.id === 'kitchen')!;
    expect(kitchen.transitionInFrames).toBeGreaterThan(0);
    expect(kitchen.startFrame).toBe(counter.startFrame + counter.durationInFrames - kitchen.transitionInFrames);
    // SFX in absolute frames: stat has an impact 10 frames in.
    const stat = layout.shots.find((s) => s.id === 'stat')!;
    expect(layout.sfx).toContainEqual({ shotId: 'stat', index: 0, sfx: 'sfx-impact', frame: stat.startFrame + 10, gainDb: -6 });
    expect(layout.words.length).toBe(plan.narration!.words!.length);
    // Skill events come from the compiled project (number landing, keyword…).
    expect(stat.events.length).toBeGreaterThan(0);
    expect(stat.events.every((e) => e.frame >= stat.startFrame && e.frame < stat.startFrame + stat.durationInFrames)).toBe(true);
  });

  it('flags highlighted words the voice does not say during the shot', () => {
    expect(block(plan, 'hook').offSyncWords).toEqual([]);
    expect(block(setHighlightedWords(plan, 'hook', 'burger, Tokyo'), 'hook').offSyncWords).toEqual(['Tokyo']);
  });

  it('finds the shot under a frame (incoming shot wins in an overlap)', () => {
    const layout = layoutTimeline(plan);
    const kitchen = layout.shots.find((s) => s.id === 'kitchen')!;
    expect(shotAtFrame(layout.shots, 0)!.id).toBe('hook');
    expect(shotAtFrame(layout.shots, kitchen.startFrame)!.id).toBe('kitchen');
    expect(shotAtFrame(layout.shots, kitchen.startFrame - 1)!.id).toBe('counter');
  });
});

describe('trim', () => {
  it('roll edit moves the cut and keeps the episode length (voice sync)', () => {
    const next = trimShotEnd(plan, 'hook', 15);
    expect(block(next, 'hook').durationInFrames).toBe(81);
    expect(block(next, 'counter').startFrame).toBe(block(plan, 'counter').startFrame + 15);
    expect(block(next, 'counter').durationInFrames).toBe(block(plan, 'counter').durationInFrames - 15);
    expect(block(next, 'kitchen').startFrame).toBe(block(plan, 'kitchen').startFrame);
    expect(getShotPlanDuration(next)).toBe(getShotPlanDuration(plan));
  });

  it('ripple edit changes the length and pushes the following shots', () => {
    const next = trimShotEnd(plan, 'hook', -6, 'ripple');
    expect(block(next, 'hook').durationInFrames).toBe(60);
    expect(block(next, 'kitchen').startFrame).toBe(block(plan, 'kitchen').startFrame - 6);
    expect(getShotPlanDuration(next)).toBe(getShotPlanDuration(plan) - 6);
  });

  it('never makes a shot shorter than 0.5 s', () => {
    expect(block(trimShotEnd(plan, 'hook', -1000), 'hook').durationInFrames).toBe(15);
    const rolled = trimShotEnd(plan, 'hook', 1000);
    expect(block(rolled, 'counter').durationInFrames).toBe(15);
    expect(block(rolled, 'hook').durationInFrames).toBe(66 + 105 - 15);
    expect(trimShotEnd(plan, 'hook', 0)).toBe(plan);
    expect(trimShotEnd(plan, 'nope', 10)).toBe(plan);
  });

  it('the last shot has no next shot to roll into: it ripples', () => {
    const last = plan.shots[plan.shots.length - 1]!;
    expect(getShotPlanDuration(trimShotEnd(plan, last.id, 30))).toBe(getShotPlanDuration(plan) + 30);
  });
});

describe('shot operations', () => {
  it('reorders shots', () => {
    const next = moveShot(plan, 'hook', 2);
    expect(ids(next).slice(0, 3)).toEqual(['counter', 'kitchen', 'hook']);
    expect(moveShot(plan, 'hook', 0)).toBe(plan);
    expect(ids(moveShot(plan, 'hook', 99)).at(-1)).toBe('hook');
  });

  it('computes the drop index from the dragged block centre', () => {
    const layout = layoutTimeline(plan);
    const kitchen = layout.shots.find((s) => s.id === 'kitchen')!;
    expect(dropIndex(layout, 'hook', 0)).toBe(0);
    expect(dropIndex(layout, 'hook', kitchen.startFrame + kitchen.durationInFrames - 1)).toBe(2);
  });

  it('duplicates with a unique id and deletes (never the last shot)', () => {
    const d = duplicateShot(plan, 'stat');
    expect(d.id).toBe('stat-2');
    expect(ids(d.plan)[ids(d.plan).indexOf('stat') + 1]).toBe('stat-2');
    expect(duplicateShot(d.plan, 'stat-2').id).toBe('stat-3');
    expect(d.plan.shots.find((s) => s.id === 'stat-2')!.sfx).not.toBe(plan.shots.find((s) => s.id === 'stat')!.sfx);
    const del = deleteShot(plan, 'counter');
    expect(ids(del.plan)).not.toContain('counter');
    expect(del.selectId).toBe('kitchen');
    const single = { ...plan, shots: [plan.shots[0]!] };
    expect(deleteShot(single, 'hook').plan).toBe(single);
  });
});

describe('sfx operations', () => {
  it('moves an event within its shot', () => {
    const stat = block(plan, 'stat');
    const next = moveSfx(plan, 'stat', 0, stat.startFrame + 30);
    expect(next.shots.find((s) => s.id === 'stat')!.sfx).toEqual([{ sfx: 'sfx-impact', at: 30 }]);
  });

  it('re-attaches an event to the shot it is dropped on', () => {
    const report = block(plan, 'report');
    const next = moveSfx(plan, 'stat', 0, report.startFrame + 40);
    expect(next.shots.find((s) => s.id === 'stat')!.sfx).toBeUndefined();
    expect(next.shots.find((s) => s.id === 'report')!.sfx).toEqual([{ sfx: 'sfx-impact', at: 40 }]);
    expect(layoutTimeline(next).sfx.find((m) => m.shotId === 'report')!.frame).toBe(report.startFrame + 40);
  });

  it('adds at a frame and removes', () => {
    const added = addSfxAt(plan, 'sfx-glitch', block(plan, 'rent').startFrame + 12);
    expect(added.shots.find((s) => s.id === 'rent')!.sfx).toEqual([{ sfx: 'sfx-glitch', at: 12 }]);
    expect(removeSfx(added, 'rent', 0).shots.find((s) => s.id === 'rent')!.sfx).toBeUndefined();
  });
});

describe('geometry', () => {
  it('snaps to shot edges and words within the threshold', () => {
    const layout = layoutTimeline(plan);
    const targets = snapTargets(layout);
    const cut = block(plan, 'counter').startFrame;
    expect(targets).toContain(cut);
    expect(targets).toContain(layoutTimeline(plan).words[5]!.startFrame);
    expect(snapFrame(cut + 2, [cut, cut + 10], 3)).toBe(cut);
    expect(snapFrame(cut + 6, [cut, cut + 10], 5)).toBe(cut + 10); // nearest wins
    expect(snapFrame(cut + 2, [cut], 1)).toBe(cut + 2);
    expect(snapFrame(cut + 1, [cut], 3, cut)).toBe(cut + 1); // excluded target (the cut being dragged)
  });

  it('fits the episode in the width and formats time', () => {
    expect(fitZoom(1000, 800)).toBeCloseTo(0.8);
    expect(formatTime(0, 30)).toBe('0:00.0');
    expect(formatTime(95 * 30 + 15, 30)).toBe('1:35.5');
  });
});
