import { describe, expect, it } from 'vitest';
import { compileShotPlan, defaultMotionSkillRegistry, EDITORIAL_GRAMMAR, EDITORIAL_INTENTS, validateShotPlan, type Shot, type ShotPlan } from '../src/index';
import { buildEditorialPlan } from './fixtures/editorial-episode';
import { buildEpisodePlan } from './fixtures/shotplan-episode';

const withCatalog = { skillIds: defaultMotionSkillRegistry.availableIds(), skillCatalog: defaultMotionSkillRegistry };
const found = (plan: ShotPlan, code: string) => {
  const r = validateShotPlan(plan, withCatalog);
  return [...r.errors, ...r.warnings].filter((i) => i.code === code);
};
const text = (id: string, extra: Partial<Shot> = {}): Shot => ({ id, type: 'text', durationInFrames: 75, text: 'Short statement here', ...extra });
const image = (id: string, extra: Partial<Shot> = {}): Shot => ({ id, type: 'image', durationInFrames: 90, media: 'landscape', ...extra });
const plan = (shots: Shot[]): ShotPlan => ({ ...buildEpisodePlan(), narration: undefined, music: undefined, captions: undefined, shots });

describe('grammar (GRAM-01)', () => {
  it('covers every intent with installed alternatives', () => {
    const installed = defaultMotionSkillRegistry.availableIds();
    for (const intent of EDITORIAL_INTENTS) {
      const g = EDITORIAL_GRAMMAR[intent];
      expect(g.shotTypes.length, intent).toBeGreaterThan(0);
      expect(g.why.length, intent).toBeGreaterThan(10);
      expect(g.skills.filter((s) => installed.has(s)).length, intent).toBeGreaterThan(0);
    }
  });

  it('a skill outside the grammar of its intent needs a reason', () => {
    const p = buildEditorialPlan();
    const stat = p.shots.find((s) => s.id === 'stat')!;
    stat.motionSkill = 'typewriter';
    delete stat.reasons!.motion;
    expect(found(p, 'grammar.skill')[0]).toMatchObject({ rule: 'GRAM-01' });
    stat.reasons!.motion = 'The figure is typed like a bank statement.';
    expect(found(p, 'grammar.skill')).toEqual([]);
  });
});

describe('repetition (REP)', () => {
  it('REP-01: a skill more than 3 times in 10 shots', () => {
    const shots = ['a', 'b', 'c', 'd', 'e'].flatMap((id) => [text(id, { motionSkill: 'keyword_pop', highlightedWords: ['statement'] }), image(`${id}-img`)]);
    expect(found(plan(shots), 'repetition.skill')).toEqual([expect.objectContaining({ rule: 'REP-01', path: 'shots[6].motionSkill' })]);
  });

  it('REP-02: a transition more than twice in 10 cuts', () => {
    const shots = ['a', 'b', 'c', 'd', 'e'].map((id, i) => image(id, i ? { transition: 'dissolve', motionSkill: 'slow_zoom' } : {}));
    expect(found(plan(shots), 'repetition.transition')[0]).toMatchObject({ rule: 'REP-02', path: 'shots[3].transition' });
  });

  it('REP-03: a sound effect more than 3 times a minute', () => {
    const shots = ['a', 'b', 'c', 'd', 'e'].map((id) => image(id, { camera: 'push_in', sfx: [{ sfx: 'sfx-impact' }] }));
    expect(found(plan(shots), 'repetition.sfx')[0]).toMatchObject({ rule: 'REP-03' });
  });

  it('REP-04: the same camera on more than 3 shots in a row', () => {
    const shots = ['a', 'b', 'c', 'd'].map((id) => image(id, { camera: 'push_in' }));
    expect(found(plan(shots), 'repetition.camera')[0]).toMatchObject({ rule: 'REP-04', path: 'shots[3].camera' });
    const alternating = ['a', 'b', 'c', 'd'].map((id, i) => image(id, { camera: i % 2 ? 'pan_left' : 'push_in' }));
    expect(found(plan(alternating), 'repetition.camera')).toEqual([]);
  });

  it('REP-05: the same text treatment on 3 typographic shots in a row', () => {
    const shots = ['a', 'b', 'c'].map((id) => text(id, { motionSkill: 'word_reveal' }));
    expect(found(plan(shots), 'repetition.typography')[0]).toMatchObject({ rule: 'REP-05', path: 'shots[2].motionSkill' });
  });
});

describe('contrast, restraint, intensity', () => {
  it('VAR-02: fewer than 3 visual types in 10 shots', () => {
    const shots = Array.from({ length: 10 }, (_, i) => (i % 2 ? text(`t${i}`, { motionSkill: i % 4 === 1 ? 'word_reveal' : 'scale_text' }) : image(`i${i}`, { camera: i % 4 ? 'pan_left' : 'push_in' })));
    expect(found(plan(shots), 'variety.window')[0]).toMatchObject({ rule: 'VAR-02' });
  });

  it('MOT-03: at least 2 of 10 shots without content animation (with the skill catalog)', () => {
    const skills = ['word_reveal', 'scale_text', 'mask_reveal', 'blur_reveal', 'slide_text'];
    const shots = Array.from({ length: 10 }, (_, i) => (i % 2 ? text(`t${i}`, { motionSkill: skills[i % 5] }) : { id: `n${i}`, type: 'number' as const, durationInFrames: 75, number: { value: i }, motionSkill: i % 4 ? 'number_pop' : 'number_count' }));
    expect(found(plan(shots), 'motion.restraint')[0]).toMatchObject({ rule: 'MOT-03' });
    // Without a catalog the rule is not checked (it needs skill categories).
    expect(validateShotPlan(plan(shots)).warnings.map((w) => w.code)).not.toContain('motion.restraint');
  });

  it('MOT-02: strong is rare and reserved for the hook, revelations and the climax', () => {
    const p = buildEditorialPlan();
    p.shots.find((s) => s.id === 'counter')!.intensity = 'strong';
    expect(found(p, 'intensity.strong.intent')[0]).toMatchObject({ rule: 'MOT-02', path: 'shots[1].intensity' });
    expect(found(p, 'intensity.strong.ratio')[0]).toMatchObject({ rule: 'MOT-02' }); // 3 of 10
  });

  it('CAM-07: at most 3 shakes per video', () => {
    const shots = ['a', 'b', 'c', 'd'].map((id) => image(id, { camera: 'shake' }));
    expect(found(plan(shots), 'camera.shake.max')[0]).toMatchObject({ rule: 'CAM-07' });
  });
});

describe('typography, documents, data, maps, sound', () => {
  it('TYPO-02 / TYPO-03', () => {
    const p = plan([text('long', { text: 'One two three four five six seven eight nine ten eleven twelve thirteen', highlightedWords: ['one', 'two', 'three'] })]);
    expect(found(p, 'typography.words')[0]).toMatchObject({ rule: 'TYPO-02' });
    expect(found(p, 'typography.emphasis')[0]).toMatchObject({ rule: 'TYPO-03' });
  });

  it('DOC-01 / DOC-05', () => {
    const p = plan([{ id: 'doc', type: 'document', durationInFrames: 120, media: 'report' }]);
    expect(found(p, 'document.static')[0]).toMatchObject({ rule: 'DOC-01' });
    expect(found(p, 'document.source')[0]).toMatchObject({ rule: 'DOC-05' });
    const ok = plan([{ id: 'doc', type: 'document', durationInFrames: 120, media: 'report', camera: 'push_in', document: { source: 'Annual report 2023' } }]);
    expect([...found(ok, 'document.static'), ...found(ok, 'document.source')]).toEqual([]);
  });

  it('CHART-04 / MAP-03', () => {
    const labels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const p = plan([
      { id: 'c', type: 'chart', durationInFrames: 90, chart: { kind: 'barChart', labels, values: labels.map((_, i) => i + 1) }, motionSkill: 'bar_animation' },
      { id: 'm', type: 'map', durationInFrames: 90, map: { center: [0, 0], markers: Array.from({ length: 9 }, () => ({ coordinates: [0, 0] as [number, number] })) }, motionSkill: 'map_zoom' },
    ]);
    expect(found(p, 'chart.categories')[0]).toMatchObject({ rule: 'CHART-04' });
    expect(found(p, 'map.labels')[0]).toMatchObject({ rule: 'MAP-03' });
  });

  it('SND-03: no burst of sound effects', () => {
    const p = plan([image('a', { camera: 'push_in', sfx: [{ sfx: 'sfx-impact' }, { sfx: 'sfx-glitch', at: 10 }, { sfx: 'sfx-impact', at: 20 }, { sfx: 'sfx-glitch', at: 30 }] })]);
    expect(found(p, 'sound.density')[0]).toMatchObject({ rule: 'SND-03' });
  });
});

describe('captions never repeat the on-screen text (CAP-03)', () => {
  it('skips captions on a shot whose title is what is being said', () => {
    const r = compileShotPlan(buildEpisodePlan());
    if (!r.ok) throw new Error('compile failed');
    expect(r.project.scenes.find((s) => s.id === 'counter')!.captions).toBeUndefined();
    expect(r.notes).toContain('counter: [CAP-03] no captions, the on-screen text already says it');
    expect(r.project.scenes.find((s) => s.id === 'kitchen')!.captions).toBeDefined();
  });
});

describe('captions follow sentences', () => {
  it('a cue never runs across the end of a sentence', () => {
    const r = compileShotPlan(buildEditorialPlan());
    if (!r.ok) throw new Error('compile failed');
    const cues = r.project.scenes.flatMap((s) => s.captions?.cues ?? []);
    expect(cues.length).toBeGreaterThan(0);
    for (const c of cues) expect(c.text.slice(0, -1), c.text).not.toMatch(/[.!?]\s/);
  });
});
