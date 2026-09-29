import { describe, expect, it } from 'vitest';
import {
  EXPLAINING_NEEDS,
  fromTimeline,
  getBibleRule,
  MEDIA_NATURES,
  MEDIA_NEED_TIERS,
  MEDIA_NEEDS,
  MEDIA_TIERS,
  NATURE_TIER,
  REAL_SUBJECT_NEEDS,
  toTimeline,
  validateShotPlan,
  type ShotPlan,
} from '../src/index';
import { buildEpisodePlan } from './fixtures/shotplan-episode';

describe('media selection vocabulary (bible §27)', () => {
  it('orders the scale from the most authentic to pure motion design', () => {
    expect(MEDIA_TIERS).toEqual(['real_video', 'real_photo', 'document', 'data_viz', 'generated', 'motion']);
    for (const n of MEDIA_NATURES) expect(MEDIA_TIERS).toContain(NATURE_TIER[n]);
  });

  it('gives every need its preferred media, taken from the scale', () => {
    for (const need of MEDIA_NEEDS) {
      expect(MEDIA_NEED_TIERS[need].length, need).toBeGreaterThan(0);
      for (const t of MEDIA_NEED_TIERS[need]) expect(MEDIA_TIERS).toContain(t);
    }
    // Explaining starts with data or motion, showing reality never offers a generated visual.
    for (const need of EXPLAINING_NEEDS) expect(['data_viz', 'motion']).toContain(MEDIA_NEED_TIERS[need][0]);
    for (const need of REAL_SUBJECT_NEEDS) expect(MEDIA_NEED_TIERS[need]).not.toContain('generated');
  });

  it('is written in the bible', () => {
    for (let i = 1; i <= 8; i++) expect(getBibleRule(`MED-0${i}`), `MED-0${i}`).toBeDefined();
    expect(getBibleRule('MED-07')!.enforcement).toBe('auto');
  });
});

describe('validation of the media fields', () => {
  const withShots = (patch: (plan: ShotPlan) => void): ShotPlan => {
    const plan = buildEpisodePlan();
    patch(plan);
    return plan;
  };

  it('refuses an unknown need or level', () => {
    const r = validateShotPlan(withShots((p) => Object.assign(p.shots[0]!, { mediaNeed: 'decoration', mediaTier: 'stock' })));
    expect(r.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['media.need.invalid', 'media.tier.invalid']));
  });

  it('warns when a generated visual stands for reality (MED-07)', () => {
    const plan = withShots((p) => {
      p.assets.landscape = { ...p.assets.landscape!, source: { provider: 'AI', license: 'own', commercialUse: true, syntheticMedia: true } };
      Object.assign(p.shots[1]!, { mediaNeed: 'introduce_entity', mediaTier: 'generated' });
    });
    const issue = validateShotPlan(plan).warnings.find((w) => w.code === 'media.generated.real');
    expect(issue).toMatchObject({ path: 'shots[1].media', rule: 'MED-07' });
    expect(issue!.message).toContain('introduce entity');
  });

  it('accepts a generated visual for an atmosphere, and a real photo for a person', () => {
    const generatedMood = withShots((p) => {
      p.assets.landscape = { ...p.assets.landscape!, nature: 'generated' };
      Object.assign(p.shots[1]!, { mediaNeed: 'atmosphere', mediaTier: 'generated' });
    });
    const realPerson = withShots((p) => {
      p.assets.landscape = { ...p.assets.landscape!, nature: 'real_photo' };
      Object.assign(p.shots[1]!, { mediaNeed: 'introduce_entity', mediaTier: 'real_photo' });
    });
    for (const plan of [generatedMood, realPerson]) expect(validateShotPlan(plan).warnings.some((w) => w.code === 'media.generated.real')).toBe(false);
  });

  it('keeps the media fields through the Timeline view', () => {
    const plan = withShots((p) => {
      p.version = 2;
      Object.assign(p.shots[3]!, { mediaNeed: 'explain_number', mediaTier: 'data_viz', reasons: { shot: 'The figure builds up.', media: 'Explained figure: data first.' } });
    });
    expect(fromTimeline(toTimeline(plan), { assets: plan.assets }).plan.shots[3]).toMatchObject({ mediaNeed: 'explain_number', mediaTier: 'data_viz', reasons: { media: 'Explained figure: data first.' } });
  });
});
