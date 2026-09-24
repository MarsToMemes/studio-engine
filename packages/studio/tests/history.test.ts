import { describe, expect, it } from 'vitest';
import { commit, createHistory, HISTORY_LIMIT, redo, seal, undo } from '../src/state/history';
import { computePeaks, peakBetween } from '../src/audio/peaks';

describe('history', () => {
  it('undoes and redoes', () => {
    let h = createHistory('a');
    h = commit(h, 'b');
    h = commit(h, 'c');
    h = undo(h);
    expect(h.present).toBe('b');
    h = undo(undo(h));
    expect(h.present).toBe('a');
    h = redo(h);
    expect(h.present).toBe('b');
    h = commit(h, 'x');
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it('coalesces a group (typing, one drag) into one step until sealed', () => {
    let h = createHistory('');
    for (const v of ['M', 'Mc', 'McD']) h = commit(h, v, 'text:hook');
    expect(h.past).toEqual(['']);
    h = commit(seal(h), 'McDo', 'text:hook');
    expect(h.past).toEqual(['', 'McD']);
    expect(undo(h).present).toBe('McD');
    expect(commit(h, h.present)).toBe(h);
  });

  it('is bounded', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) h = commit(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});

describe('waveform peaks', () => {
  it('keeps the max amplitude per bucket across channels', () => {
    const left = new Float32Array(400).fill(0.1);
    const right = new Float32Array(400);
    right[150] = -0.8;
    const p = computePeaks([left, right], 400, 4); // 100 samples per bucket
    expect(Array.from(p.data)).toEqual([expect.closeTo(0.1), expect.closeTo(0.8), expect.closeTo(0.1), expect.closeTo(0.1)]);
    expect(p.durationInSeconds).toBe(1);
    expect(peakBetween(p, 0.25, 0.5)).toBeCloseTo(0.8);
    expect(peakBetween(p, 2, 3)).toBe(0);
    expect(peakBetween(p, 1.25, 1.5, true)).toBeCloseTo(0.8); // looped track
  });
});
