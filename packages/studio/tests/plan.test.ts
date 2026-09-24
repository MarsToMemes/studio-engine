import { describe, expect, it } from 'vitest';
import { shotPlanDemo } from '@studio-engine/remotion';
import {
  compilePreview,
  mediaOptions,
  setHighlightedWords,
  setIntensity,
  setMapZoom,
  setShotSeconds,
  setSfx,
  setSkill,
  setTransition,
  sfxOptions,
  posterFrame,
  shotRange,
  shotStartFrame,
  skillOptions,
  updateShot,
} from '../src/state/plan';

const plan = shotPlanDemo;
const shot = (p: typeof plan, id: string) => p.shots.find((s) => s.id === id)!;

describe('plan editing', () => {
  it('is immutable and removes emptied fields', () => {
    const edited = updateShot(plan, 'hook', { text: 'New hook', subtext: '' });
    expect(shot(edited, 'hook').text).toBe('New hook');
    expect(shot(plan, 'hook').text).not.toBe('New hook');
    expect('subtext' in shot(edited, 'hook')).toBe(false);
  });

  it('edits durations in seconds and moves the following shots', () => {
    const edited = setShotSeconds(plan, 'counter', 5);
    expect(shot(edited, 'counter').durationInFrames).toBe(150);
    expect(shotStartFrame(edited, 'kitchen')).toBe(shotStartFrame(plan, 'kitchen') + 45);
    expect(shot(setShotSeconds(plan, 'counter', 0), 'counter').durationInFrames).toBe(15); // min 0.5 s
  });

  it('edits skills, intensity, transitions, highlights, sfx and map zoom', () => {
    const s1 = setSkill(updateShot(plan, 'stat', { motionParams: { currency: '€' } }), 'stat', 'currency_reveal');
    expect(shot(s1, 'stat')).toMatchObject({ motionSkill: 'currency_reveal' });
    expect('motionParams' in shot(s1, 'stat')).toBe(false);
    expect('intensity' in shot(setIntensity(plan, 'stat', ''), 'stat')).toBe(false);
    expect('transition' in shot(setTransition(plan, 'kitchen', 'hard_cut'), 'kitchen')).toBe(false);
    expect(shot(setHighlightedWords(plan, 'hook', ' burger , company,'), 'hook').highlightedWords).toEqual(['burger', 'company']);
    expect(shot(setSfx(plan, 'hook', []), 'hook').sfx).toBeUndefined();
    expect(shot(setMapZoom(plan, 'world', 40), 'world').map!.zoom).toBe(12);
  });

  it('offers only compatible options', () => {
    expect(mediaOptions(plan, 'video')).toEqual(['clip']);
    expect(mediaOptions(plan, 'document')).toEqual(['landscape', 'report']);
    expect(mediaOptions(plan, 'text')).toEqual([]);
    expect(sfxOptions(plan)).toEqual(['sfx-impact', 'sfx-glitch']);
    const numberSkills = skillOptions('number').map((s) => s.id);
    expect(numberSkills).toContain('number_pop');
    expect(numberSkills).not.toContain('map_zoom');
  });

  it('previews a shot after its entrance, not on an empty first frame', () => {
    const project = compilePreview(plan).project!;
    const [start, end] = shotRange(plan, 'hook');
    const hookPoster = posterFrame(plan, project, 'hook');
    // keyword_pop lands on the spoken keyword; the poster frame is after it.
    const keywordAt = (project.scenes[0]!.metadata!.extra!.events as Array<{ at: number }>)[0]!.at;
    expect(hookPoster).toBeGreaterThan(start + keywordAt);
    expect(hookPoster).toBeLessThan(end);
    // After a 15-frame push transition, the poster frame is past the overlap.
    const [worldStart] = shotRange(plan, 'world');
    expect(posterFrame(plan, project, 'world')).toBeGreaterThan(worldStart + 15);
  });

  it('compiles the edited plan for preview, reporting errors instead of throwing', () => {
    const ok = compilePreview(setShotSeconds(plan, 'hook', 2));
    expect(ok.project).toBeDefined();
    expect(ok.errors).toEqual([]);
    const broken = compilePreview(updateShot(plan, 'counter', { media: 'missing' }));
    expect(broken.project).toBeUndefined();
    expect(broken.errors.map((e) => e.code)).toContain('asset.missing');
  });
});
