import { describe, expect, it } from 'vitest';
import { audioVolumeAt, buildRemotionPlan, sanitizeCompositionId, SceneValidationError } from '../src/index.js';
import { simpleProject } from './helpers.js';

function withAudio() {
  const p = simpleProject([90, 90, 90], [{ type: 'crossfade', durationInFrames: 10 }, { type: 'whip', durationInFrames: 8 }, { type: 'push', durationInFrames: 12, direction: 'left' }]);
  p.name = 'My Doc: Episode #1';
  p.assets = {
    vo: { id: 'vo', kind: 'audio', src: 'vo.mp3', durationInSeconds: 20 },
    music: { id: 'music', kind: 'audio', src: 'music.mp3', durationInSeconds: 60 },
    unused: { id: 'unused', kind: 'image', src: 'u.png' },
  };
  p.scenes[0]!.voiceover = { id: 'v0', assetId: 'vo', startFrame: 10, durationInFrames: 40 };
  p.scenes[2]!.voiceover = { id: 'v2', assetId: 'vo', durationInFrames: 60, trim: { startFrom: 40 } };
  p.scenes[2]!.transitionOut = { type: 'crossfade', durationInFrames: 20 };
  p.audio = [{ id: 'bed', assetId: 'music', role: 'music', volume: 0.8, fadeInFrames: 10, fadeOutFrames: 20, ducking: { amount: 0.25, attackFrames: 5, releaseFrames: 10 } }];
  return p;
}

describe('buildRemotionPlan', () => {
  const plan = buildRemotionPlan(withAudio());

  it('describes the composition', () => {
    expect(plan.composition).toEqual({ id: 'My-Doc-Episode-1', width: 1920, height: 1080, fps: 30, durationInFrames: 270 - 8 - 12 });
  });

  it('alternates sequences and transitions like <TransitionSeries>', () => {
    expect(plan.series.map((i) => i.kind)).toEqual(['sequence', 'transition', 'sequence', 'transition', 'sequence']);
    const [first, whip, , push, last] = plan.series;
    expect(first).toMatchObject({ kind: 'sequence', durationInFrames: 90, edgeIn: { durationInFrames: 10 } });
    expect(whip).toMatchObject({ kind: 'transition', presentation: { kind: 'custom', name: 'whip' }, timing: { kind: 'linear', durationInFrames: 8 } });
    expect(push).toMatchObject({ presentation: { kind: 'builtin', name: 'slide', props: { direction: 'from-right' } } });
    expect(last).toMatchObject({ kind: 'sequence', startFrame: 160, edgeOut: { durationInFrames: 20 } });
    expect(plan.customPresentations).toEqual(['whip']);
  });

  it('places audio in absolute frames with trims and ducking windows', () => {
    const v2 = plan.audio.find((a) => a.id === 'v2')!;
    expect(v2).toMatchObject({ from: 160, durationInFrames: 60, startFrom: 40, src: 'vo.mp3' });
    const bed = plan.audio.find((a) => a.id === 'bed')!;
    expect(bed).toMatchObject({ from: 0, durationInFrames: 250 });
    expect(bed.envelope.ducking).toEqual([
      { startFrame: 10, endFrame: 50, amount: 0.25, attackFrames: 5, releaseFrames: 10 },
      { startFrame: 160, endFrame: 220, amount: 0.25, attackFrames: 5, releaseFrames: 10 },
    ]);
  });

  it('computes volume envelopes (fades + ducking)', () => {
    const bed = plan.audio.find((a) => a.id === 'bed')!;
    expect(audioVolumeAt(bed, 0)).toBe(0);
    expect(audioVolumeAt(bed, 5)).toBeCloseTo(0.4);
    expect(audioVolumeAt(bed, 100)).toBeCloseTo(0.8);
    expect(audioVolumeAt(bed, 30)).toBeCloseTo(0.2); // fully ducked
    expect(audioVolumeAt(bed, 55)).toBeCloseTo(0.8 * (1 - 0.5 * 0.75)); // half released
    expect(audioVolumeAt(bed, 249)).toBeLessThan(0.1); // fading out
    expect(audioVolumeAt(plan.audio.find((a) => a.id === 'v0')!, 20)).toBe(1); // voiceover itself is never ducked
  });

  it('preloads only used assets, once', () => {
    expect(plan.preload.map((p) => p.assetId)).toEqual(['vo', 'music']);
  });

  it('refuses invalid projects', () => {
    const bad = withAudio();
    bad.scenes[1]!.transitionIn = { type: 'crossfade', durationInFrames: 500 };
    expect(() => buildRemotionPlan(bad)).toThrow(SceneValidationError);
  });

  it('sanitizes composition ids', () => {
    expect(sanitizeCompositionId('  ')).toBe('Video');
    expect(sanitizeCompositionId('a_b.c')).toBe('a-b-c');
  });
});
