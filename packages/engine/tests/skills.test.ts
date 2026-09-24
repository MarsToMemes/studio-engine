import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SKILLS,
  compileProject,
  compileShotPlan,
  createMotionSkillRegistry,
  defaultMotionSkillRegistry,
  getAvailableMotionSkills,
  sampleLayerUnits,
  sampleScene,
  validateProject,
  validateShotPlan,
  type Intensity,
  type ShotPlan,
  type Scene,
} from '../src/index.js';
import { buildEpisodePlan, transcript } from './fixtures/shotplan-episode.js';

const SPEC_SKILLS = {
  text: ['keyword_pop', 'word_reveal', 'character_reveal', 'typewriter', 'slide_text', 'scale_text', 'blur_reveal', 'mask_reveal', 'highlight_word', 'underline_word'],
  numbers: ['number_pop', 'number_count', 'percentage_reveal', 'currency_reveal', 'stat_card'],
  images: ['slow_zoom', 'slow_push', 'punch_in', 'punch_out', 'pan_left', 'pan_right', 'parallax', 'blur_transition', 'camera_shake'],
  documents: ['document_highlight', 'document_zoom', 'document_pan', 'source_reveal'],
  data: ['chart_growth', 'chart_reveal', 'bar_animation', 'line_animation', 'pie_reveal', 'comparison_graph'],
  maps: ['map_zoom', 'map_route', 'location_pin', 'country_highlight', 'business_expansion'],
  reveals: ['glitch_reveal', 'flash_reveal', 'blackout_reveal', 'zoom_reveal', 'text_reveal'],
  editorial: ['chapter_card', 'source_card', 'quote_card', 'lower_third', 'full_screen_statement'],
};

/** One-shot plan helper: the episode fixture with a single shot replaced. */
function planWith(shotId: string, patch: Partial<ShotPlan['shots'][number]>): ShotPlan {
  const plan = buildEpisodePlan();
  plan.shots = plan.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s));
  return plan;
}

function compiled(plan: ShotPlan, options: Parameters<typeof compileShotPlan>[1] = {}) {
  const r = compileShotPlan(plan, options);
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 2));
  return r;
}

const scene = (r: ReturnType<typeof compiled>, id: string): Scene => r.project.scenes.find((s) => s.id === id)!;

describe('Motion Skill Registry: catalog', () => {
  it('ships exactly the specified skills, with complete metadata', () => {
    for (const [category, ids] of Object.entries(SPEC_SKILLS)) {
      expect(getAvailableMotionSkills({ category: category as never }).map((s) => s.id).sort(), category).toEqual([...ids].sort());
    }
    expect(BUILT_IN_SKILLS).toHaveLength(49);
    for (const s of getAvailableMotionSkills()) {
      expect(s.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.description.length).toBeGreaterThan(20);
      expect(['subtle', 'medium', 'strong']).toContain(s.intensity);
      expect(s.duration.min).toBeGreaterThan(0);
      expect(s.duration.max).toBeGreaterThanOrEqual(s.duration.min);
      expect(s.compatibleShotTypes.length).toBeGreaterThan(0);
      for (const f of s.fallback) expect(defaultMotionSkillRegistry.has(f), `${s.id} → ${f}`).toBe(true);
      expect(JSON.parse(JSON.stringify(s))).toEqual(s); // metadata is plain JSON for the AI
    }
  });

  it('matches the spec example for number_pop', () => {
    expect(getAvailableMotionSkills({ query: 'number_pop' })[0]).toMatchObject({ id: 'number_pop', category: 'numbers', intensity: 'medium', duration: { min: 0.4, max: 1.2 } });
  });

  it('filters by category, shot type, intensity and text query', () => {
    expect(getAvailableMotionSkills({ shotType: 'map' }).every((s) => s.compatibleShotTypes.includes('map'))).toBe(true);
    expect(getAvailableMotionSkills({ intensity: 'strong' }).map((s) => s.id)).toContain('glitch_reveal');
    expect(getAvailableMotionSkills({ query: 'highlighter' }).map((s) => s.id)).toContain('highlight_word');
  });

  it('never lists skills the renderer cannot draw', () => {
    const noMaps = createMotionSkillRegistry({ graphicKinds: new Set(['counter', 'barChart']) });
    const ids = noMaps.getAvailableMotionSkills().map((s) => s.id);
    expect(ids).not.toContain('map_zoom');
    expect(ids).not.toContain('stat_card');
    expect(ids).not.toContain('line_animation');
    expect(ids).toContain('bar_animation');
    expect(validateShotPlan(buildEpisodePlan(), { skillIds: noMaps.availableIds() }).warnings.map((w) => w.path)).toContain('shots[6].motionSkill'); // map_zoom
  });
});

describe('Motion Skill Registry: fallbacks (render never fails)', () => {
  const revelation = buildEpisodePlan();

  it('an invented skill leaves the shot without motion and says so', () => {
    const r = compiled(planWith('reveal', { motionSkill: 'cinematic_money_explosion_v4' }));
    expect(r.notes.find((n) => n.startsWith('reveal:'))).toMatch(/not installed; no fallback applies/);
    expect(scene(r, 'reveal').metadata!.extra).not.toHaveProperty('appliedSkill');
  });

  it('glitch_reveal → zoom_reveal → … → nothing, even when skills are not installed', () => {
    const without = (...ids: string[]) => createMotionSkillRegistry(undefined, BUILT_IN_SKILLS.filter((s) => !ids.includes(s.id)));
    const applied = (ids: string[]) => scene(compiled(revelation, { skills: without(...ids) }), 'reveal').metadata!.extra!.appliedSkill;
    expect(applied([])).toBe('glitch_reveal');
    expect(applied(['glitch_reveal'])).toBe('zoom_reveal');
    expect(applied(['glitch_reveal', 'zoom_reveal'])).toBe('text_reveal');
    expect(applied(['glitch_reveal', 'zoom_reveal', 'text_reveal', 'mask_reveal', 'scale_text', 'slide_text'])).toBeUndefined();
  });

  it('falls back when the shot has nothing for the skill to animate', () => {
    // keyword_pop needs highlighted words; this image overlay has none → scale_text.
    const r = compiled(planWith('counter', { motionSkill: 'keyword_pop' }));
    expect(scene(r, 'counter').metadata!.extra!.appliedSkill).toBe('scale_text');
    expect(r.notes.find((n) => n.startsWith('counter:') && n.includes('fell back'))).toMatch(/nothing to animate.*fell back to "scale_text"/);
  });

  it('falls back when the renderer lacks the component', () => {
    const noMaps = createMotionSkillRegistry({ graphicKinds: new Set(['counter', 'barChart']) });
    const r = compiled(buildEpisodePlan(), { skills: noMaps });
    expect(scene(r, 'world').metadata!.extra).not.toHaveProperty('appliedSkill');
    expect(r.notes.find((n) => n.startsWith('world:'))).toMatch(/renderer feature/);
  });

  it('is cycle-safe', () => {
    const r = defaultMotionSkillRegistry.resolve('highlight_word', { shot: { id: 'x', type: 'text', durationInFrames: 30 }, scene: { layers: [] } as unknown as Scene, roles: {} });
    expect(r.skill).toBeUndefined();
    expect(new Set(r.tried).size).toBe(r.tried.length);
  });
});

describe('Motion skills: behaviour', () => {
  it('slow_zoom stays within 5–10 % by intensity', () => {
    const peak = (intensity: Intensity) => {
      const media = scene(compiled(planWith('counter', { motionSkill: 'slow_zoom', intensity })), 'counter').layers.find((l) => l.id === 'counter:media')!;
      return (media.animations[0] as { to: number }).to;
    };
    expect([peak('subtle'), peak('medium'), peak('strong')]).toEqual([1.05, 1.075, 1.1]);
  });

  it('punch_in goes 100 % → 112 % → 100 %', () => {
    const media = scene(compiled(planWith('counter', { motionSkill: 'punch_in', intensity: 'medium' })), 'counter').layers.find((l) => l.id === 'counter:media')!;
    expect((media.animations[0] as { tracks: Array<{ keyframes: Array<{ value: number }> }> }).tracks[0]!.keyframes.map((k) => k.value)).toEqual([1, 1.12, 1]);
  });

  it('keyword_pop makes the keyword appear exactly when the voice says it', () => {
    const plan = buildEpisodePlan();
    // Put "BILLIONS" at 1.0 s into the last shot.
    const billions = plan.shots.find((s) => s.id === 'billions')!;
    const r0 = compiled(plan);
    const tl = compileProject(r0.project).timeline.scenes.find((s) => s.sceneId === 'billions')!;
    plan.narration!.words = transcript('filler words before', 1).concat([{ text: 'BILLIONS', startMs: Math.round(((tl.startFrame + 30) / 30) * 1000), endMs: Math.round(((tl.startFrame + 40) / 30) * 1000) }]);
    const r = compiled(plan);
    const s = scene(r, 'billions');
    const text = s.layers.find((l) => l.id === 'billions:text')!;
    const pop = text.animations.find((a) => a.type === 'kineticTypography')!;
    expect(pop).toMatchObject({ units: [2], startFrame: 30 });
    expect(s.metadata!.extra!.events).toEqual([{ kind: 'keyword', at: 30 }]);

    const cp = compileProject(r.project);
    const cs = cp.scenes.find((x) => x.scene.id === 'billions')!;
    const layer = cs.layers.find((l) => l.layer.id === 'billions:text')!;
    const words = billions.text!.split(/\s+/).length;
    const before = sampleLayerUnits(layer, 29, words, cs, cp.options);
    const after = sampleLayerUnits(layer, 60, words, cs, cp.options);
    expect(before[2]!.opacity).toBe(0); // keyword hidden until spoken
    expect(before[0]!.opacity).toBe(1); // the rest of the sentence is untouched
    expect(after[2]!.opacity).toBe(1);
    expect(after[2]!.scaleX).toBeCloseTo(1, 2);
  });

  it('keeps word-synced effects visible when the word is spoken just before the cut', () => {
    const plan = buildEpisodePlan();
    const r0 = compiled(plan);
    const tl = compileProject(r0.project).timeline.scenes.find((s) => s.sceneId === 'billions')!;
    plan.narration!.words = [{ text: 'BILLIONS', startMs: Math.round(((tl.startFrame + 72) / 30) * 1000), endMs: Math.round(((tl.startFrame + 74) / 30) * 1000) }];
    const s = scene(compiled(plan), 'billions');
    expect(s.metadata!.extra!.events).toEqual([{ kind: 'keyword', at: 75 - 15 }]); // 75-frame shot, 0.5 s = 15 frames
  });

  it('highlight_word and underline_word add timed decorations on keywords', () => {
    const r = compiled(planWith('hook', { motionSkill: 'underline_word' }));
    expect(scene(r, 'hook').layers.find((l) => l.id === 'hook:text')).toMatchObject({ decorations: [{ kind: 'underline', words: [3], color: '#FFC72C' }] });
    const marker = compiled(planWith('hook', { motionSkill: 'highlight_word' }));
    expect(scene(marker, 'hook').layers.find((l) => l.id === 'hook:text')).toMatchObject({ decorations: [{ kind: 'marker', color: '#FFC72C', textColor: '#121212' }] });
  });

  it('document_zoom moves the whole page towards the highlighted passage', () => {
    const s = scene(compiled(buildEpisodePlan()), 'report');
    const zoom = s.animations.find((a) => a.type === 'zoom') as { origin: { x: number; y: number } };
    const hl = s.layers.find((l) => l.id === 'report:highlight-0')!;
    expect(zoom.origin.x).toBeCloseTo((hl.position.x + hl.position.width! / 2) / 1920, 5);
    expect(zoom.origin.y).toBeCloseTo((hl.position.y + hl.position.height! / 2) / 1080, 5);
  });

  it('data and map skills configure the renderer components', () => {
    expect(scene(compiled(planWith('rent', { motionSkill: 'line_animation' })), 'rent').layers.find((l) => l.id === 'rent:chart')).toMatchObject({ kind: 'lineChart', data: { growInFrames: 30 } });
    expect(scene(compiled(planWith('rent', { motionSkill: 'comparison_graph' })), 'rent').layers.find((l) => l.id === 'rent:chart')).toMatchObject({ kind: 'comparison' });
    const map = scene(compiled(buildEpisodePlan()), 'world').layers.find((l) => l.id === 'world:map')!;
    expect(map).toMatchObject({ kind: 'map', data: { animation: { zoomFrom: 0.5, zoomInFrames: 54 } } });
  });

  it('uses motionParams and reports invalid ones without failing', () => {
    const r = compiled(planWith('stat', { motionSkill: 'currency_reveal', motionParams: { currency: '€' }, number: { value: 6500000 } }));
    expect(scene(r, 'stat').layers.find((l) => l.id === 'stat:number')).toMatchObject({ data: { prefix: '€', separator: ',' } });
    const bad = compiled(planWith('stat', { motionSkill: 'currency_reveal', motionParams: { color: 'red' } }));
    expect(bad.notes.find((n) => n.startsWith('stat:'))).toMatch(/invalid motionParams/);
  });

  it('records editorial events for automatic sound design', () => {
    const r = compiled(buildEpisodePlan());
    expect(scene(r, 'stat').metadata!.extra!.events).toEqual([{ kind: 'number', at: 0 }]);
    expect(scene(r, 'reveal').metadata!.extra!.events).toEqual([{ kind: 'glitch', at: 0 }]);
  });
});

describe('Motion skills: every skill on every compatible shot renders a valid project', () => {
  const sampleShot: Record<string, string> = { text: 'hook', image: 'counter', video: 'kitchen', number: 'stat', document: 'report', chart: 'rent', map: 'world', chapter: 'chapter-2', revelation: 'reveal' };
  for (const skill of defaultMotionSkillRegistry.getAvailableMotionSkills()) {
    it(skill.id, () => {
      for (const type of skill.compatibleShotTypes) {
        const id = sampleShot[type]!;
        const r = compileShotPlan(planWith(id, { motionSkill: skill.id, intensity: 'strong' }));
        expect(r.ok, `${skill.id} on ${type}`).toBe(true);
        if (!r.ok) continue;
        expect(validateProject(r.project).errors, `${skill.id} on ${type}`).toEqual([]);
        const cp = compileProject(r.project);
        const cs = cp.scenes.find((s) => s.scene.id === id)!;
        for (const f of [0, 5, 15, Math.floor(cs.timing.durationInFrames / 2), cs.timing.durationInFrames - 1]) {
          const frame = sampleScene(cs, f, cp.options);
          for (const style of [frame.cameraStyle, ...frame.layers.map((l) => l.style)]) {
            for (const v of Object.values(style)) expect(String(v), `${skill.id} on ${type} @${f}`).not.toMatch(/NaN|Infinity/);
          }
        }
      }
    });
  }
});
