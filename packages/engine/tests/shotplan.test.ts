import { describe, expect, it } from 'vitest';
import {
  buildRemotionPlan,
  compileShotPlan,
  dbToGain,
  emphasisIndices,
  fromRemotionCaptions,
  fromTimeline,
  runShotPlanCli,
  getShotPlanDuration,
  resolveShotTransitions,
  toRemotionCaptions,
  toTimeline,
  validateProject,
  validateShotPlan,
  type ShotPlan,
} from '../src/index.js';
import { buildEpisodePlan } from './fixtures/shotplan-episode.js';
import { codes } from './helpers.js';

const errorsOf = (p: unknown) => codes(validateShotPlan(p).errors);
const warningsOf = (p: unknown, opts = {}) => codes(validateShotPlan(p, opts).warnings);
const edit = (fn: (p: ShotPlan) => void) => {
  const p = buildEpisodePlan();
  fn(p);
  return p;
};

describe('Timeline view (flat format)', () => {
  const plan = buildEpisodePlan();
  const timeline = toTimeline(plan);

  it('has the exact Timeline shape with derived start frames', () => {
    expect(Object.keys(timeline).sort()).toEqual(['durationInFrames', 'fps', 'height', 'shots', 'width']);
    expect(timeline.shots[0]).toMatchObject({ id: 'hook', startFrame: 0, durationInFrames: 60, type: 'text', transition: 'hard_cut', sfx: 'sfx-impact', intensity: 'strong' });
    // dissolve (15 f) into "kitchen": overlap shifts it back
    expect(timeline.shots[2]).toMatchObject({ id: 'kitchen', startFrame: 60 + 105 - 15, transition: 'dissolve' });
    for (let i = 1; i < timeline.shots.length; i++) expect(timeline.shots[i]!.startFrame).toBeGreaterThan(timeline.shots[i - 1]!.startFrame);
  });

  it('defaults to hard_cut and computes the total with overlaps', () => {
    const transitions = resolveShotTransitions(plan);
    const overlaps = transitions.slice(1).reduce((n, t) => n + (t.transition?.durationInFrames ?? 0), 0);
    const sum = plan.shots.reduce((n, s) => n + s.durationInFrames, 0);
    expect(timeline.durationInFrames).toBe(sum - overlaps);
    expect(getShotPlanDuration(plan)).toBe(timeline.durationInFrames);
    expect(transitions.filter((t) => t.id === 'hard_cut').length).toBeGreaterThanOrEqual(5);
  });

  it('is lossless: fromTimeline(toTimeline(plan)) gives the plan back', () => {
    const { plan: back, startFrameMismatches } = fromTimeline(timeline, { assets: plan.assets, narration: plan.narration!, music: plan.music!, captions: plan.captions!, metadata: plan.metadata! });
    expect(startFrameMismatches).toEqual([]);
    expect(back).toEqual(plan);
  });

  it('treats startFrame from external tools as a hint only', () => {
    const t = toTimeline(plan);
    t.shots[3]!.startFrame = 9999;
    const { plan: back, startFrameMismatches } = fromTimeline(t, { assets: plan.assets });
    expect(startFrameMismatches).toEqual([{ id: 'stat', declared: 9999, derived: timeline.shots[3]!.startFrame }]);
    expect(toTimeline(back).shots[3]!.startFrame).toBe(timeline.shots[3]!.startFrame);
  });

  it('changing one duration moves every following shot', () => {
    const p = edit((x) => void (x.shots[1]!.durationInFrames += 30));
    const t = toTimeline(p);
    expect(t.shots[5]!.startFrame).toBe(timeline.shots[5]!.startFrame + 30);
  });
});

describe('ShotPlan validation', () => {
  it('accepts the episode', () => {
    const r = validateShotPlan(buildEpisodePlan());
    expect(r.errors).toEqual([]);
  });

  it('rejects structurally broken plans', () => {
    expect(errorsOf(null)).toEqual(['plan.invalid']);
    expect(errorsOf(edit((p) => void (p.width = 1921)))).toContain('plan.size.odd');
    expect(errorsOf(edit((p) => void (p.shots = [])))).toContain('plan.shots');
    expect(errorsOf(edit((p) => void (p.shots[1]!.id = 'hook')))).toContain('shot.id.duplicate');
    expect(errorsOf(edit((p) => void ((p.shots[1] as { type: string }).type = 'meme')))).toContain('shot.type');
    expect(errorsOf(edit((p) => void (p.shots[1]!.durationInFrames = 0)))).toContain('shot.duration');
    expect(errorsOf(edit((p) => void delete p.shots[1]!.media))).toContain('asset.id.invalid');
    expect(errorsOf(edit((p) => void (p.shots[1]!.media = 'ghost')))).toContain('asset.missing');
    expect(errorsOf(edit((p) => void (p.shots[2]!.media = 'landscape')))).toContain('asset.kind.mismatch');
    expect(errorsOf(edit((p) => void delete p.shots[0]!.text))).toContain('shot.text.required');
    expect(errorsOf(edit((p) => void delete p.shots[3]!.number))).toContain('shot.number.required');
    expect(errorsOf(edit((p) => void (p.shots[5]!.chart!.values = [1])))).toContain('shot.chart.invalid');
    expect(errorsOf(edit((p) => void (p.shots[6]!.map!.center = [1] as never)))).toContain('shot.map.invalid');
    expect(errorsOf(edit((p) => void (p.shots[4]!.document!.highlights![0]!.width = 140)))).toContain('shot.document.region');
    expect(errorsOf(edit((p) => void (p.narration!.words![3]!.startMs = 0)))).toContain('narration.word.order');
  });

  it('lints the documentary pacing', () => {
    expect(warningsOf(edit((p) => void (p.shots[0]!.durationInFrames = 120)))).toContain('pacing.hook');
    const still = (seconds: number) => edit((p) => {
      delete p.shots[4]!.motionSkill;
      p.shots[4]!.durationInFrames = seconds * 30;
    });
    expect(warningsOf(still(5))).toContain('pacing.static'); // 5 s document without movement
    expect(warningsOf(still(4))).not.toContain('pacing.static'); // the rule is "more than 4 s"
    expect(warningsOf(buildEpisodePlan())).not.toContain('pacing.static');
  });

  it('lints transitions: unknown, too long, spectacular abuse', () => {
    expect(warningsOf(edit((p) => void (p.shots[2]!.transition = 'star_wipe')))).toContain('transition.unknown');
    expect(warningsOf(edit((p) => void (p.shots[2]!.transitionDurationInFrames = 200)))).toContain('transition.shortened');
    const glitchy = edit((p) => p.shots.forEach((s, i) => i > 0 && (s.transition = 'glitch')));
    expect(warningsOf(glitchy)).toEqual(expect.arrayContaining(['transition.spectacular.adjacent', 'transition.spectacular.ratio']));
    expect(warningsOf(edit((p) => void (p.shots[1]!.transition = 'whip')))).toContain('transition.spectacular.subtle');
    expect(warningsOf(buildEpisodePlan())).not.toContain('transition.spectacular.ratio');
  });

  it('checks highlights, skills and sfx without blocking', () => {
    expect(warningsOf(edit((p) => void (p.shots[0]!.highlightedWords = ['pizza'])))).toContain('shot.highlight.notFound');
    expect(warningsOf(buildEpisodePlan(), { skillIds: new Set(['slow_zoom']) })).toContain('skill.unknown');
    expect(warningsOf(edit((p) => void (p.shots[0]!.sfx = [{ sfx: 'whoosh' }])))).toContain('shot.sfx.unresolved');
    expect(validateShotPlan(edit((p) => void (p.shots[0]!.sfx = [{ sfx: 'whoosh' }]))).valid).toBe(true);
  });
});

describe('ShotPlan → VideoProject', () => {
  const plan = buildEpisodePlan();
  const result = compileShotPlan(plan);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  const { project } = result;
  const scene = (id: string) => project.scenes.find((s) => s.id === id)!;

  it('produces a valid project, one scene per shot, same ids and same timing', () => {
    expect(validateProject(project).errors).toEqual([]);
    expect(project.scenes.map((s) => s.id)).toEqual(plan.shots.map((s) => s.id));
    expect(project.scenes.map((s) => s.type)).toEqual(['text', 'image', 'video', 'statistic', 'screenshot', 'chart', 'map', 'title', 'text', 'text']);
    expect(buildRemotionPlan(project).composition.durationInFrames).toBe(toTimeline(plan).durationInFrames);
    expect(project.dimensions).toEqual({ width: 1920, height: 1080 });
    expect(project.background).toEqual({ type: 'color', color: '#121212' });
  });

  it('applies the documentary palette: yellow keywords, red revelations', () => {
    const hookText = scene('hook').layers.find((l) => l.id === 'hook:text');
    expect(hookText).toMatchObject({ type: 'text', emphasis: [3], style: { color: '#FFFFFF', highlight: { color: '#FFC72C' } } });
    expect(scene('reveal').layers.find((l) => l.id === 'reveal:text')).toMatchObject({ emphasis: [3], style: { highlight: { color: '#DA291C' } } });
    expect(scene('stat').layers.find((l) => l.id === 'stat:number')).toMatchObject({ kind: 'counter', data: { to: 61, suffix: '%' }, style: { color: '#FFC72C' } });
    expect(emphasisIndices("McDonald's makes BILLIONS, really", ['billions'])).toEqual([2]);
  });

  it('places document highlights on the displayed page and times them', () => {
    const doc = scene('report').layers.find((l) => l.id === 'report:document')!;
    const hl = scene('report').layers.find((l) => l.id === 'report:highlight-0')!;
    expect(doc).toMatchObject({ fit: 'contain' });
    // 1000x1400 portrait page contained in a 1498x842 box → 601 px wide, centered.
    expect(hl.position.units).toBe('px');
    expect(hl.position.width).toBeCloseTo(0.7 * 842 * (1000 / 1400), 0);
    expect(hl.animations[0]).toMatchObject({ type: 'reveal', direction: 'right', startFrame: 30 });
    expect(scene('report').layers.find((l) => l.id === 'report:source')).toMatchObject({ text: 'Source: Annual report 2023' });
  });

  it('maps transitions, defaulting to cuts', () => {
    expect(scene('hook').transitionIn).toBeUndefined();
    expect(scene('counter').transitionIn).toBeUndefined();
    expect(scene('kitchen').transitionIn).toMatchObject({ type: 'crossfade' });
    expect(scene('reveal').transitionIn).toMatchObject({ type: 'glitch' });
    expect(scene('chapter-2').transitionIn).toMatchObject({ type: 'fade' });
  });

  it('turns SFX events into sfx tracks with gains in dB', () => {
    expect(scene('reveal').audio).toEqual([
      { id: 'reveal:sfx-0', assetId: 'sfx-glitch', role: 'sfx', startFrame: 0, volume: dbToGain(-6) },
      { id: 'reveal:sfx-1', assetId: 'sfx-impact', role: 'sfx', startFrame: 6, volume: dbToGain(-3) },
    ]);
  });

  it('mixes a continuous narration and a ducked music bed', () => {
    expect(project.audio.find((a) => a.id === 'narration')).toMatchObject({ role: 'voiceover', startFrame: 0, volume: 1 });
    const music = project.audio.find((a) => a.id === 'music')!;
    expect(music.volume).toBeCloseTo(0.126, 3); // -18 dB
    expect(music.ducking!.amount).toBeCloseTo(0.501, 3); // -6 dB more under the voice → -24 dB
    const bed = buildRemotionPlan(project).audio.find((a) => a.id === 'music')!;
    expect(bed.envelope.ducking.length).toBeGreaterThan(0);
  });

  it('does not repeat full-screen typography as captions by default', () => {
    expect(project.scenes.filter((s) => s.captions).map((s) => s.id)).toEqual(['counter', 'kitchen', 'report', 'rent', 'world']);
  });

  it('slices word-timed captions per shot, with no word lost or duplicated', () => {
    const everywhere = compileShotPlan({ ...plan, captions: { ...plan.captions!, showOn: ['image', 'video', 'text', 'number', 'document', 'chart', 'map', 'revelation', 'chapter'] } });
    if (!everywhere.ok) throw new Error('compile failed');
    const words = everywhere.project.scenes.flatMap((s) => s.captions?.cues.flatMap((c) => c.words!.map((w) => w.text)) ?? []);
    const spoken = plan.narration!.words!.filter((w) => (w.startMs / 1000) * 30 < toTimeline(plan).durationInFrames).map((w) => w.text);
    expect(words).toEqual(spoken);
    for (const s of project.scenes) {
      if (!s.captions) continue;
      expect(s.layers.some((l) => l.type === 'caption' && l.trackId === s.captions!.id)).toBe(true);
      for (const c of s.captions.cues) expect(c.endFrame).toBeLessThanOrEqual(s.durationInFrames);
    }
  });

  it('never fails on skills: reports them until a registry is plugged in', () => {
    expect(result.notes).toContain('counter: motion skill "slow_zoom" not applied (no skill registry)');
    const seen: string[] = [];
    const withRegistry = compileShotPlan(plan, {
      applySkill: ({ shot, roles }) => {
        seen.push(`${shot.motionSkill}:${Object.keys(roles).sort().join('+')}`);
        return shot.motionSkill === 'glitch_reveal' ? { applied: 'zoom_reveal', note: 'glitch_reveal unavailable, fell back to zoom_reveal' } : { applied: shot.motionSkill! };
      },
    });
    expect(withRegistry.ok).toBe(true);
    expect(seen).toContain('number_pop:number+text'); // no captions over full-screen numbers
    expect(seen).toContain('document_zoom:captions+document+highlight+source');
    if (withRegistry.ok) {
      expect(withRegistry.project.scenes.find((s) => s.id === 'reveal')!.metadata!.extra).toMatchObject({ motionSkill: 'glitch_reveal', appliedSkill: 'zoom_reveal' });
      expect(withRegistry.notes).toContain('reveal: glitch_reveal unavailable, fell back to zoom_reveal');
    }
  });

  it('is deterministic and refuses invalid plans without throwing', () => {
    expect(compileShotPlan(buildEpisodePlan())).toEqual(result);
    const bad = compileShotPlan(edit((p) => void (p.shots[1]!.media = 'ghost')));
    expect(bad.ok).toBe(false);
  });
});

describe('@remotion/captions interop', () => {
  it('converts scene captions to Remotion Caption[] and back', () => {
    const r = compileShotPlan(buildEpisodePlan());
    if (!r.ok) throw new Error('compile failed');
    const s = r.project.scenes[1]!;
    const captions = toRemotionCaptions(s.captions!, 30, 60);
    expect(captions[0]).toMatchObject({ text: expect.stringMatching(/^ \S/), timestampMs: null });
    expect(captions[0]!.startMs).toBeGreaterThanOrEqual(2000);
    const words = fromRemotionCaptions(captions);
    expect(words.map((w) => w.text)).toEqual(s.captions!.cues.flatMap((c) => c.words!.map((w) => w.text)));
  });
});

describe('shotplan CLI (for external pipelines such as montage.py)', () => {
  const run = (args: string[], input: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runShotPlanCli(args, { readInput: () => input, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const plan = JSON.stringify(buildEpisodePlan());

  it('validate / timeline / compile', () => {
    expect(run(['validate', '-'], plan)).toMatchObject({ code: 0 });
    const t = run(['timeline', 'plan.json'], plan);
    expect(t.code).toBe(0);
    expect(JSON.parse(t.out)).toEqual(toTimeline(buildEpisodePlan()));
    const c = run(['compile', '-'], plan);
    expect(c.code).toBe(0);
    expect(JSON.parse(c.out)).toMatchObject({ format: 'studio-engine/project', project: { scenes: expect.any(Array) } });
    expect(c.err).toMatch(/note: counter: motion skill "slow_zoom" not applied/);
  });

  it('reports usage, unreadable input and invalid plans with distinct exit codes', () => {
    expect(run(['render', '-'], plan).code).toBe(2);
    expect(run(['timeline', '-'], '{oops').code).toBe(2);
    const bad = JSON.parse(plan);
    bad.shots[1].media = 'ghost';
    const r = run(['timeline', '-'], JSON.stringify(bad));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/asset.missing/);
  });
});
