import { describe, expect, it } from 'vitest';
import { compileShotPlan, loadAssetManifest, skillGalleryPlan, skillPreviewPlan, createMotionSkillRegistry, BUILT_IN_SKILLS, defaultMotionSkillRegistry, validateShotPlan, type Shot, type ShotPlan, type VideoProject } from '../src/index';
import { buildEpisodePlan } from './fixtures/shotplan-episode';

const reg = defaultMotionSkillRegistry;

/** Compiles one shot with one skill and returns its scene. */
function run(shot: Shot, extra: Partial<ShotPlan> = {}) {
  const plan: ShotPlan = { ...buildEpisodePlan(), narration: undefined, captions: undefined, music: undefined, shots: [shot], ...extra };
  const r = compileShotPlan(plan);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const scene = r.project.scenes[0]!;
  return { scene, extra: scene.metadata!.extra!, notes: r.notes, project: r.project as VideoProject };
}
const layer = (scene: { layers: Array<{ id: string }> }, suffix: string) => scene.layers.find((l) => l.id.endsWith(suffix)) as Record<string, any> | undefined;

describe('registry API v2 (brief §9)', () => {
  it('getMotionSkill, getCompatibleSkills, getFallbackSkill', () => {
    expect(reg.getMotionSkill('number_pop')).toMatchObject({ id: 'number_pop', category: 'numbers', defaultDuration: 0.8, family: 'number_pop', implementation: 'remotion' });
    expect(reg.getMotionSkill('bar_animation')!.implementation).toBe('svg');
    expect(reg.getMotionSkill('city_zoom')!.implementation).toBe('maplibre');
    expect(reg.getMotionSkill('nope')).toBeUndefined();
    const forMaps = reg.getCompatibleSkills('map').map((s) => s.id);
    expect(forMaps).toEqual(expect.arrayContaining(['map_zoom', 'flight_route', 'city_zoom']));
    expect(forMaps).not.toContain('number_pop');
    expect(reg.getFallbackSkill('glitch_reveal', 'revelation')!.id).toBe('zoom_reveal');
    expect(reg.getFallbackSkill('city_zoom', 'map')!.id).toBe('map_zoom');
    // Unknown skill: no chain → safe fallback of the shot type.
    expect(reg.getFallbackSkill('cinematic_money_explosion_v4', 'number')!.id).toBe('number_count');
    // Renderer without MapLibre: city_zoom is not available, the AI is never offered it.
    const noTiles = createMotionSkillRegistry({ graphicKinds: new Set(['map', 'counter', 'barChart']) });
    expect(noTiles.isAvailable('city_zoom')).toBe(false);
    expect(noTiles.getCompatibleSkills('map').map((s) => s.id)).not.toContain('city_zoom');
  });

  it('families group near-duplicates for the repetition manager (REP-01)', () => {
    expect(reg.getMotionSkill('pan_left')!.family).toBe(reg.getMotionSkill('pan_right')!.family);
    expect(reg.getMotionSkill('counter_roll')!.family).toBe(reg.getMotionSkill('odometer')!.family);
    const pans: Shot[] = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, type: 'image', media: 'landscape', durationInFrames: 90, motionSkill: i % 2 ? 'pan_left' : 'pan_right' }));
    const plan = { ...buildEpisodePlan(), narration: undefined, captions: undefined, music: undefined, shots: pans };
    const withCatalog = validateShotPlan(plan, { skillCatalog: reg });
    expect(withCatalog.warnings.find((w) => w.code === 'repetition.skill')).toMatchObject({ rule: 'REP-01', message: expect.stringContaining('"pan" treatments') });
  });

  it('every built-in skill has an implementation matching what it needs', () => {
    for (const s of BUILT_IN_SKILLS) {
      const kinds = s.requires?.graphicKinds ?? [];
      if (kinds.includes('mapTiles')) expect(s.implementation, s.id).toBe('maplibre');
      else if (kinds.length) expect(s.implementation, s.id).toBe('svg');
      else expect(s.implementation, s.id).toBe('remotion');
    }
  });
});

describe('the 16 skills of registry v2', () => {
  it('kinetic_statement: typographic hierarchy, the key word biggest', () => {
    const { scene } = run({ id: 's', type: 'text', durationInFrames: 90, text: 'The REAL BUSINESS of it', highlightedWords: ['REAL', 'BUSINESS'], motionSkill: 'kinetic_statement' });
    const text = layer(scene, ':text')!;
    expect(text.wordScales).toHaveLength(5);
    const [the, real, business, of] = text.wordScales as number[];
    expect(the!).toBeLessThan(of! + 0.0001);
    expect(real!).toBeGreaterThan(1);
    expect(business!).toBeGreaterThan(real!);
  });

  it('counter_roll / odometer: digit strips on the counter', () => {
    for (const [skill, style] of [['counter_roll', 'roll'], ['odometer', 'odometer']] as const) {
      const { scene, extra } = run({ id: 'n', type: 'number', durationInFrames: 75, number: { value: 61, suffix: '%' }, motionSkill: skill });
      expect(extra.appliedSkill).toBe(skill);
      expect(layer(scene, ':number')!.data).toMatchObject({ style });
    }
  });

  it('depth_zoom / cinematic_push: camera-style moves on the media', () => {
    const d = run({ id: 'i', type: 'image', media: 'landscape', durationInFrames: 120, motionSkill: 'depth_zoom', focus: { x: 70, y: 40 } });
    expect(layer(d.scene, ':media')!.animations).toContainEqual(expect.objectContaining({ type: 'zoom', easing: 'easeInCubic', origin: { x: 0.7, y: 0.4 } }));
    const c = run({ id: 'i', type: 'image', media: 'landscape', durationInFrames: 120, motionSkill: 'cinematic_push' });
    expect(layer(c.scene, ':media')!.animations).toContainEqual(expect.objectContaining({ type: 'camera', move: 'dolly' }));
    // Both control the camera: a shot camera is ignored (CAM-02).
    const both = run({ id: 'i', type: 'image', media: 'landscape', durationInFrames: 120, motionSkill: 'depth_zoom', camera: 'pan_left' });
    expect(both.notes.join()).toContain('[CAM-02]');
  });

  const doc: Shot = { id: 'd', type: 'document', media: 'report', durationInFrames: 150, document: { source: 'Annual report 2023', highlights: [{ x: 10, y: 30, width: 70, height: 6, at: 40 }] } };

  it('document_focus: the page darkens around the passage, the camera goes to it', () => {
    const { scene, extra } = run({ ...doc, motionSkill: 'document_focus' });
    expect(extra.appliedSkill).toBe('document_focus');
    const dims = scene.layers.filter((l) => l.id.includes(':focus-'));
    expect(dims.map((l) => l.id.split('-').pop()).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(dims[0]!.animations[0]).toMatchObject({ type: 'fade', startFrame: 40 });
    expect(extra.events).toEqual([{ kind: 'highlight', at: 40 }]);
  });

  it('redaction_reveal: black bars over the passages pull away when they are read', () => {
    const { scene, extra } = run({ ...doc, motionSkill: 'redaction_reveal' });
    const bar = layer(scene, ':redaction-1')!;
    expect(bar.fill).toBe('#0B0B0B');
    expect(bar.animations[0]).toMatchObject({ type: 'keyframes', startFrame: 40 });
    expect(extra.events).toEqual([{ kind: 'reveal', at: 40 }]);
  });

  it('ranking_animation: sorted horizontal bars with ranks', () => {
    const { scene } = run({ id: 'c', type: 'chart', durationInFrames: 120, chart: { kind: 'barChart', labels: ['A', 'B', 'C'], values: [3, 9, 5] }, motionSkill: 'ranking_animation' });
    expect(layer(scene, ':chart')!).toMatchObject({ kind: 'barChart', data: { horizontal: true, sorted: true, ranks: true } });
  });

  it('percentage_bar: a bar fills to the share (percentages only)', () => {
    const { scene, extra } = run({ id: 'n', type: 'number', durationInFrames: 75, number: { value: 61, suffix: '%', label: 'of revenue' }, motionSkill: 'percentage_bar' });
    expect(layer(scene, ':progress')!).toMatchObject({ kind: 'progress', data: { value: 61, max: 100 } });
    expect(extra.appliedSkill).toBe('percentage_bar');
    // Not a percentage: falls back.
    const notPct = run({ id: 'n', type: 'number', durationInFrames: 75, number: { value: 12 }, motionSkill: 'percentage_bar' });
    expect(notPct.extra.appliedSkill).not.toBe('percentage_bar');
  });

  it('flight_route: route with a moving head; city_zoom: MapLibre only with a style', () => {
    const route: Shot = { id: 'm', type: 'map', durationInFrames: 150, map: { center: [0, 30], zoom: 1, route: [[-87.6, 41.9], [139.7, 35.7]] }, motionSkill: 'flight_route' };
    expect(layer(run(route).scene, ':map')!.data.animation).toMatchObject({ plane: true });
    const withStyle = run({ id: 'm', type: 'map', durationInFrames: 150, map: { center: [2.35, 48.86], zoom: 14, style: 'https://tiles.example/style.json', attribution: '© OpenStreetMap contributors' }, motionSkill: 'city_zoom' });
    expect(layer(withStyle.scene, ':map')!).toMatchObject({ kind: 'mapTiles', data: { zoomTo: 14, attribution: '© OpenStreetMap contributors' } });
    const noStyle = run({ id: 'm', type: 'map', durationInFrames: 150, map: { center: [2.35, 48.86], zoom: 3 }, motionSkill: 'city_zoom' });
    expect(noStyle.extra.appliedSkill).toBe('map_zoom');
    expect(noStyle.notes.join()).toContain('"city_zoom" has nothing to animate');
  });

  it('light_reveal / impact_reveal', () => {
    const light = run({ id: 'r', type: 'revelation', durationInFrames: 75, text: 'They own the land', motionSkill: 'light_reveal' });
    expect(layer(light.scene, ':light')!.fill).toMatchObject({ kind: 'linear' });
    const impact = run({ id: 'r', type: 'revelation', durationInFrames: 75, text: 'They own the land', motionSkill: 'impact_reveal' });
    expect(layer(impact.scene, ':flash')).toBeDefined();
    expect(impact.scene.animations).toContainEqual(expect.objectContaining({ type: 'shake' }));
    expect(impact.extra.events).toEqual([{ kind: 'impact', at: 0 }]);
  });

  it('warning_card (red is for warnings), key_fact, timeline_event', () => {
    const warn = run({ id: 'w', type: 'text', durationInFrames: 90, text: 'The rent can double overnight', motionSkill: 'warning_card' });
    expect(layer(warn.scene, ':warning-bar')!.fill).toBe('#DA291C');
    const fact = run({ id: 'k', type: 'text', durationInFrames: 90, text: 'Franchisees pay the rent', motionSkill: 'key_fact' });
    expect(layer(fact.scene, ':fact-frame')!.stroke).toMatchObject({ color: '#FFC72C' });
    const tl = run({ id: 't', type: 'chart', durationInFrames: 150, chart: { kind: 'barChart', labels: ['1955', '1961', '1965'], values: [1, 2, 3], title: 'Key dates' }, motionSkill: 'timeline_event' });
    expect(layer(tl.scene, ':chart')!.kind).toBe('timeline');
  });
});

describe('Motion Library previews and asset manifest', () => {
  it('every available skill has a preview shot on which it actually applies', () => {
    const plan = skillGalleryPlan(reg);
    expect(plan.shots).toHaveLength(reg.getAvailableMotionSkills().length);
    const r = compileShotPlan(plan);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    r.project.scenes.forEach((scene, i) => expect(scene.metadata!.extra!.appliedSkill, plan.shots[i]!.id).toBe(plan.shots[i]!.id));
  });

  it('a single skill preview is a valid one-shot plan', () => {
    const plan = skillPreviewPlan(reg.getMotionSkill('city_zoom')!);
    expect(plan.shots).toHaveLength(1);
    expect(plan.shots[0]).toMatchObject({ type: 'map', map: { style: 'offline:natural-earth' } });
    expect(compileShotPlan(plan).ok).toBe(true);
  });

  it('the asset manifest keeps only assets with recorded commercial rights', () => {
    const own = { provider: 'own production', license: 'own', commercialUse: true };
    const loaded = loadAssetManifest({
      version: 1,
      assets: [
        { id: 'whoosh', category: 'sfx', kind: 'audio', src: 'sfx/whoosh.wav', source: own, tags: ['transition'] },
        { id: 'lt', category: 'lower_third', kind: 'lottie', src: 'lt.json', source: { license: 'CC-BY 4.0', commercialUse: true, attributionRequired: true, attribution: 'by Jane' } },
        { id: 'nolicense', category: 'overlay', kind: 'video', src: 'grain.mp4' },
        { id: 'nc', category: 'icon', kind: 'svg', src: 'i.svg', source: { license: 'CC-BY-NC', commercialUse: false } },
        { id: 'noattr', category: 'background', kind: 'image', src: 'b.png', source: { license: 'CC-BY', commercialUse: true, attributionRequired: true } },
        { id: 'whoosh', category: 'sfx', kind: 'audio', src: 'sfx/other.wav', source: own },
      ],
    });
    expect(Object.keys(loaded.assets)).toEqual(['whoosh', 'lt']);
    expect(loaded.assets.whoosh!.metadata).toEqual({ category: 'sfx', tags: ['transition'] });
    expect(loaded.byCategory).toEqual({ sfx: ['whoosh'], lower_third: ['lt'] });
    expect(loaded.rejected.map((r) => [r.id, r.reason])).toEqual([
      ['nolicense', expect.stringContaining('no recorded license')],
      ['nc', 'not usable commercially'],
      ['noattr', expect.stringContaining('attribution required')],
      ['whoosh', 'duplicate id'],
    ]);
  });
});
