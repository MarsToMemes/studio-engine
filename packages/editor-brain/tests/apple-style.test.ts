import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getShotStartFrames, validateShotPlan, type ShotPlan } from '@studio-engine/scene-engine';
import { directEpisode, groupRuns, locateTokens, narrationTimeline, runBrainCli, titleSpec, unitWordStarts, type BrainInput } from '../src/index';

const episode = (f: string) => new URL(`../../../episodes/mcdonalds-30s/${f}`, import.meta.url);
const input = JSON.parse(readFileSync(episode('input.json'), 'utf8')) as BrainInput;
const hand = JSON.parse(readFileSync(episode('plan-apple.json'), 'utf8')) as ShotPlan;
const apple = () => directEpisode({ ...input, style: 'apple' });
const shot = (plan: ShotPlan, id: string) => plan.shots.find((s) => s.id === id)!;
const nums = (v: unknown) => String(v ?? '').split(',').filter(Boolean).map(Number);

describe('timing on the voice', () => {
  const r = directEpisode(input);
  const unit = (id: string) => r.analysis.find((u) => u.id === id)!;

  it('maps a moment of the voice file to the timeline through its segment, even when segments are shifted', () => {
    // u7 is played from 22.24 s of the file at frame 722 (after a controlled silence).
    expect(narrationTimeline(r.plan, 22240, 'u7')).toBeCloseTo(722 / 30, 6);
    expect(narrationTimeline(r.plan, 23180, 'u7')).toBeCloseTo(722 / 30 + 0.94, 6);
    // Overlapping segments (u5 ends at 17.07 s, u6 starts at 16.95 s): the unit's own segment wins.
    expect(narrationTimeline(r.plan, 16950, 'u6')).toBeCloseTo(552 / 30, 6);
    expect(narrationTimeline({ fps: 30 }, 1500)).toBe(1.5);
  });

  it('snaps figures written as digits to the first spoken number word', () => {
    const u5 = unit('u5');
    const starts = unitWordStarts(u5, input.narration!.words);
    expect(u5.words[4]).toBe('$9.8');
    const spoken = (text: string) => input.narration!.words.find((w) => w.text.startsWith(text) && w.startMs > u5.startMs)!.startMs;
    expect(starts[4]).toBe(spoken('nine')); // 14.26 s, where the brain interpolated 13.91 s
    expect(starts[7]).toBe(spoken('twenty')); // "2023."
  });

  it('finds a shot text that starts mid-sentence on a common word', () => {
    const u6 = unit('u6');
    const at = locateTokens(['The', 'restaurants', 'sit'], u6.words, u6.wordStartsMs);
    expect(at).toEqual([u6.wordStartsMs[8], u6.wordStartsMs[9], u6.wordStartsMs[10]]);
  });
});

describe('titles', () => {
  it('splits a soft lead-in at the comma and golds the punch line', () => {
    expect(titleSpec('Behind every counter, there is something else.', ['counter'])).toMatchObject({ text: 'Behind every counter,|there is *something else.*', soft: '0' });
  });
  it('keeps a quantifier with its figure and a conjugated verb out of the gold', () => {
    expect(titleSpec('They own the land under more than half of them.', ['half'], { maxLines: 3, maxChars: 20 }).text).toBe('They own the land|under *more than half*|of them.');
    expect(titleSpec('And rent keeps growing:', []).text).toBe('Rent keeps *growing.*');
  });
  it('makes a short gold ending the main line, and balances long lines otherwise', () => {
    expect(titleSpec('the restaurants sit on prime land', []).text).toBe('The restaurants sit on|*prime land.*');
    expect(titleSpec("McDonald's makes billions from real estate.", ['estate']).text).toBe("McDonald's makes billions|from *real estate.*");
  });
});

describe('runs: one block across shots', () => {
  const d = (index: number, kind: string, unit?: string, sceneId = 's1') => ({ index, kind, shot: { id: `s${index}`, sceneId, metadata: unit ? { unit } : {} } });
  it('merges a lead-in with its chart, a chapter card with its map, and a data block continued in a scene', () => {
    const runs = groupRuns([d(0, 'title', 'u1'), d(1, 'bars', 'u1'), d(2, 'chapter'), d(3, 'map', 'u2'), d(4, 'stat', 'u3'), d(5, 'stat', 'u4'), d(6, 'stat', 'u5', 's2')] as never, []);
    expect(runs.map((r) => r.map((x) => x.index))).toEqual([[0, 1], [2, 3], [4, 5], [6]]);
  });
  it('does not merge a title with the chart of another sentence', () => {
    expect(groupRuns([d(0, 'title', 'u1'), d(1, 'bars', 'u2')] as never, []).length).toBe(2);
  });
});

describe('style apple on the McDonald episode', () => {
  const r = apple();

  it('draws the same blocks as the hand-made edit, with the same cues (±0.05 s)', () => {
    for (const h of hand.shots) {
      const a = shot(r.plan, h.id);
      expect(a.block?.item, h.id).toBe(h.block?.item);
      expect(a.block?.startAt ?? 0, h.id).toBeCloseTo(h.block?.startAt ?? 0, 3);
      const av = a.block!.variables as Record<string, unknown>;
      const hv = h.block!.variables as Record<string, unknown>;
      for (const k of ['cues', 'labelCues', 'barCues', 'highlightCues', 'rowsAt']) {
        if (hv[k] === undefined) continue;
        const x = nums(av[k]);
        const y = nums(hv[k]);
        expect(x.length, `${h.id}.${k}`).toBe(y.length);
        x.forEach((t, i) => expect(Math.abs(t - y[i]!), `${h.id}.${k}[${i}]`).toBeLessThanOrEqual(0.05));
      }
      for (const k of ['kickerAt', 'countAt', 'litAt', 'deltaAt', 'strikeAt']) {
        if (hv[k] !== undefined) expect(Math.abs(Number(av[k]) - Number(hv[k])), `${h.id}.${k}`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('cuts hard without moving any shot, turns captions off, keeps the media for the QC', () => {
    const plain = directEpisode(input).plan;
    expect(getShotStartFrames(r.plan)).toEqual(getShotStartFrames(plain));
    expect(r.plan.shots.every((s) => (s.transition ?? 'hard_cut') === 'hard_cut')).toBe(true);
    expect(r.plan.captions?.enabled).toBe(false);
    expect(shot(r.plan, 'u2').media).toBe('counter');
    expect(shot(r.plan, 'u4').media).toBe('report');
    expect(r.plan.shots.every((s) => !s.motionSkill)).toBe(true);
    expect(validateShotPlan(r.plan, { stage: 'final' }).errors).toEqual([]);
    expect(r.qc.valid).toBe(true);
  });

  it('never invents facts: without the hints the document and the share keep the engine composition', () => {
    const bare = { ...input, style: 'apple' as const, script: input.script.map((b) => (b.kind === 'text' && b.hints ? { ...b, hints: { ...b.hints, documentCard: undefined, share: undefined } } : b)) };
    const p = directEpisode(bare).plan;
    expect(shot(p, 'u4').block).toBeUndefined();
    expect(shot(p, 'u4').type).toBe('document');
    expect(shot(p, 'u7').block?.item).toBe('studio-title');
  });

  it('leaves the default style unchanged', () => {
    const plain = directEpisode(input).plan;
    expect(plain.shots.some((s) => s.block)).toBe(false);
    expect(plain.captions?.enabled).toBe(true);
  });

  it('is reachable from the CLI', async () => {
    const out: string[] = [];
    const io = { readInput: () => JSON.stringify(input), stdout: (t: string) => out.push(t), stderr: () => {} };
    expect(await runBrainCli(['direct', 'in.json', '--plan', '--style', 'apple'], io)).toBe(0);
    expect((JSON.parse(out[0]!) as ShotPlan).shots[0]!.block?.item).toBe('studio-title');
    expect(await runBrainCli(['direct', 'in.json', '--style=fancy'], { ...io, stdout: () => {} })).toBe(2);
  });
});
