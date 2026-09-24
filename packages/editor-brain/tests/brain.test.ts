import { describe, expect, it } from 'vitest';
import { compileShotPlan, getShotStartFrames, resolveNarration, validateShotPlan, type ShotPlan } from '@studio-engine/scene-engine';
import { alignSentences, analyzeScript, directEpisode, emphasisWords, findNumbers, findPlaces, runBrainCli, splitSentences, type BrainInput } from '../src/index';
import { mcdonaldsExample as mcdonaldsInput, transcript } from '../src/examples/mcdonalds';

const run = (overrides: Partial<BrainInput> = {}) => directEpisode(mcdonaldsInput(overrides));
const shotsOf = (plan: ShotPlan, unit: string) => plan.shots.filter((s) => s.metadata?.unit === unit);

describe('language helpers', () => {
  it('finds figures written or spoken, in English and French', () => {
    expect(findNumbers('Over 61% of its revenue comes from franchisees.'.split(' '))).toEqual([{ value: 61, text: '61%', suffix: '%', wordIndex: 1, label: 'of its revenue comes from franchisees' }]);
    expect(findNumbers('Over sixty one percent of its revenue'.split(' '))[0]).toMatchObject({ value: 61, suffix: '%', text: 'sixty one percent' });
    expect(findNumbers('McDonald’s gagne 61 % de ses revenus'.split(' '))[0]).toMatchObject({ value: 61, suffix: '%' });
    expect(findNumbers('a profit of $2.5 billion in 2023'.split(' '))[0]).toMatchObject({ value: 2.5, prefix: '$', suffix: 'B' });
    expect(findNumbers('one of the largest landlords since 1955'.split(' '))).toEqual([]); // "one of", years
  });

  it('finds places, quotes, emphasis and sentences', () => {
    expect(findPlaces('From Chicago to Tokyo, from New York to São Paulo.'.split(' ')).map((p) => p.name)).toEqual(['Chicago', 'Tokyo', 'New York', 'São Paulo']);
    expect(findPlaces('a tokyo-style chicken'.split(' '))).toEqual([]); // lower case: not a place name
    expect(emphasisWords("McDonald's isn't a burger company.".split(' '), "McDonald's isn't a burger company.")).toEqual(['burger']);
    expect(emphasisWords('They make BILLIONS from real estate.'.split(' '), '')).toEqual(['BILLIONS']);
    expect(splitSentences('One. Two! Three? And four…')).toEqual(['One.', 'Two!', 'Three?', 'And four…']);
  });
});

describe('alignment', () => {
  it('times the script on the transcript even where the words differ ("61%" vs "sixty one percent")', () => {
    const script = [["McDonald's", "isn't", 'a', 'burger', 'company.'], ['Over', '61%', 'of', 'its', 'revenue', 'comes', 'from', 'franchisees.']];
    const words = transcript();
    const t = alignSentences(script, words);
    expect(t[0]!.startMs).toBe(words[0]!.startMs);
    const over = words.find((w) => w.text === 'Over')!;
    expect(t[1]!.startMs).toBe(over.startMs);
    // "61%" is interpolated between "Over" and "of".
    const of = words.find((w, i) => w.text === 'of' && words[i - 1]!.text === 'percent')!;
    expect(t[1]!.wordStartsMs[1]).toBeGreaterThan(over.startMs);
    expect(t[1]!.wordStartsMs[1]).toBeLessThan(of.startMs);
    expect(t[1]!.estimated).toBe(false);
  });

  it('estimates timing without a transcript', () => {
    const t = alignSentences([['a', 'b', 'c']], []);
    expect(t[0]).toMatchObject({ startMs: 0, estimated: true });
  });
});

describe('EDITORIAL ANALYZER + STORY ARCHITECT', () => {
  it('classifies every sentence with the evidence', () => {
    const units = analyzeScript(mcdonaldsInput());
    expect(units.map((u) => u.intent)).toEqual(['hook', 'contradiction', 'number', 'proof', 'statistic', 'location', 'revelation', 'aftermath', 'conclusion']);
    expect(units[1]!.why).toBe('contradiction cue "something else"');
    expect(units[3]!.why).toBe('refers to a source ("annual report")');
    expect(units[6]!.why).toBe('intent given by the author');
    // Ordinal heuristics, never decimals.
    for (const u of units) for (const v of [u.importance, u.analysis.surprise, u.analysis.tension]) expect([1, 2, 3, 4, 5]).toContain(v);
    expect(units[6]!.analysis.tension).toBe(5);
    expect(units[5]!.analysis.tension).toBe(4); // right before the revelation
  });

  it('builds chapters, scenes with a purpose, and beats', () => {
    const r = run();
    expect(r.structure.chapters.map((c) => c.title)).toEqual(['The real business', 'The real estate empire']);
    expect(r.structure.scenes.map((s) => s.purpose)).toEqual(["Hook the viewer: McDonald's isn't a burger company", 'Reveal: They own the land']);
    expect(Object.values(r.structure.beats)).toEqual(['setup', 'contradiction', 'escalation', 'proof', 'escalation', 'setup', 'revelation', 'aftermath', 'payoff']);
  });
});

describe('directEpisode: the McDonald’s episode', () => {
  const r = run();
  const plan = r.plan;

  it('produces a final-valid ShotPlan v2 with zero warnings', () => {
    expect(plan.version).toBe(2);
    expect(r.qc.errors).toEqual([]);
    expect(r.qc.warnings).toEqual([]);
    expect(r.qc.valid).toBe(true);
    expect(compileShotPlan(plan).ok).toBe(true);
  });

  it('every decision is explained (the inspectable "why")', () => {
    for (const s of plan.shots) {
      expect(s.reasons?.shot, s.id).toBeTruthy();
      expect(s.visualHierarchy?.primary, s.id).toBeTruthy();
      expect(s.decidedBy).toBe('rules');
      if (s.motionSkill) expect(s.reasons?.motion, s.id).toBeTruthy();
      if (s.camera) expect(s.reasons?.camera, s.id).toBeTruthy();
      if (s.sfx) expect(s.reasons?.sfx, s.id).toBeTruthy();
      if (s.transition) expect(s.reasons?.transition, s.id).toBeTruthy();
    }
  });

  it('follows the grammar: statement hook, figure, document proof, chart, map, revelation, callback', () => {
    const type = (unit: string) => shotsOf(plan, unit).map((s) => s.type);
    expect(type('u1')).toEqual(['text']);
    expect(type('u3')[0]).toBe('number');
    expect(shotsOf(plan, 'u3')[0]!.number).toMatchObject({ value: 61, suffix: '%' });
    expect(shotsOf(plan, 'u4')[0]).toMatchObject({ type: 'document', media: 'report', motionSkill: 'document_highlight' });
    expect(shotsOf(plan, 'u4')[0]!.document!.highlights).toHaveLength(1); // catalogued region read by the voice
    expect(shotsOf(plan, 'u5')[0]).toMatchObject({ type: 'chart', motionSkill: 'bar_animation' });
    expect(shotsOf(plan, 'u6')[0]!.map!.markers!.map((m) => m.label)).toEqual(['Chicago', 'Tokyo', 'London', 'Sydney']);
    expect(shotsOf(plan, 'u7')[0]).toMatchObject({ type: 'revelation', motionSkill: 'blackout_reveal', camera: 'punch_in', intensity: 'strong' });
    // The conclusion brings back the first image of the video (CALL-02), with a dissolve.
    const conclusion = shotsOf(plan, 'u9')[0]!;
    expect(conclusion).toMatchObject({ type: 'image', media: plan.memory!.visualMotifs![0]!.assetId, camera: 'pull_out', transition: 'dissolve' });
    expect(plan.memory!.callbackCandidates).toEqual([{ motifId: 'motif-1', callbackShotId: conclusion.id, note: expect.any(String) }]);
  });

  it('cuts on the voice: hook length, no cut inside a word, the figure on its word (J-cut)', () => {
    expect(plan.shots[0]!.durationInFrames / 30).toBeGreaterThanOrEqual(1.5);
    expect(plan.shots[0]!.durationInFrames / 30).toBeLessThanOrEqual(2.5);
    // "61" is on screen within ±6 frames of the spoken "sixty".
    const starts = getShotStartFrames(plan);
    const numberShot = plan.shots.findIndex((s) => s.type === 'number');
    const sixty = resolveNarration(plan).words.find((w) => w.text === 'sixty')!;
    expect(Math.abs(starts[numberShot]! - Math.round((sixty.startMs / 1000) * 30))).toBeLessThanOrEqual(6);
    expect(r.decisions).toContain('u3: J-cut, the number appears on “61%” (9 frames into the sentence)');
  });

  it('prepares the revelation: build, silence, reveal, aftermath', () => {
    expect(plan.silences).toEqual([{ id: 'silence-u7', beforeShotId: 'u7', durationInFrames: 12, kinds: ['music_drop'] }]);
    const states = plan.shots.map((s) => s.musicState);
    const reveal = plan.shots.findIndex((s) => s.id === 'u7');
    expect(states[reveal - 1]).toBe('build');
    expect(states[reveal]).toBe('reveal');
    expect(states[reveal + 1]).toBe('aftermath');
    expect(plan.shots[reveal]!.sfx).toEqual([expect.objectContaining({ sfx: 'sfx-impact' })]);
    // The chapter card is silent: no voice segment overlaps it.
    const card = plan.shots.findIndex((s) => s.type === 'chapter');
    const cardStart = getShotStartFrames(plan)[card]!;
    const spokenDuringCard = resolveNarration(plan).words.filter((w) => {
      const f = Math.round((w.startMs / 1000) * 30);
      return f >= cardStart + 12 && f < cardStart + plan.shots[card]!.durationInFrames;
    });
    expect(spokenDuringCard).toEqual([]);
  });

  it('sound design is restrained and says what is missing from the library', () => {
    const sfx = plan.shots.flatMap((s) => s.sfx ?? []);
    expect(sfx.length).toBeGreaterThan(0);
    expect(sfx.length).toBeLessThanOrEqual(Math.ceil(plan.shots.length / 2));
    expect(r.assetRequests.filter((a) => a.need === 'sfx').map((a) => a.description)).toContain('sound effects of category "pop" in the sound library');
    expect(run({ sfx: undefined }).decisions).toContain('no sound library given: no sound effects');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(run().plan)).toBe(JSON.stringify(plan));
  });
});

describe('visual callbacks (CALL-02)', () => {
  it('no callback is claimed when no image was introduced early', () => {
    const input = mcdonaldsInput();
    input.script = input.script.map((b) => (b.kind === 'text' && b.hints?.media ? { kind: 'text', text: b.text } : b));
    const r = directEpisode(input);
    const conclusion = r.plan.shots.find((s) => s.editorialIntent === 'conclusion')!;
    expect(conclusion.transition).toBeUndefined();
    expect(r.plan.memory?.callbackCandidates).toBeUndefined();
    expect(conclusion.reasons!.shot).not.toContain('callback');
  });
});

describe('never invents what it was not given', () => {
  it('no chart data → typography and a data request (no fake numbers)', () => {
    const input = mcdonaldsInput();
    input.script = input.script.map((b) => (b.kind === 'text' && b.hints?.chart ? { kind: 'text', text: b.text } : b));
    const r = directEpisode(input);
    expect(r.plan.shots.some((s) => s.type === 'chart')).toBe(false);
    expect(r.assetRequests).toContainEqual(expect.objectContaining({ need: 'chart-data' }));
  });

  it('no document → no proof shot, a document request instead', () => {
    const input = mcdonaldsInput();
    const { report: _report, ...assets } = input.assets;
    const r = directEpisode({ ...input, assets, catalog: input.catalog!.filter((c) => c.assetId !== 'report') });
    expect(r.plan.shots.some((s) => s.type === 'document')).toBe(false);
    expect(r.assetRequests).toContainEqual(expect.objectContaining({ unitId: 'u4', need: 'document' }));
    expect(r.qc.errors).toEqual([]);
  });

  it('unrelated images are never used as illustration (STORY-04)', () => {
    const input = mcdonaldsInput({ catalog: [{ assetId: 'restaurant', description: 'a mountain lake', tags: ['nature'] }] });
    // Only the brain's own choices: no media imposed by the author.
    input.script = input.script.map((b) => (b.kind === 'text' && b.hints?.media ? { kind: 'text', text: b.text } : b));
    const r = directEpisode(input);
    expect(r.plan.shots.some((s) => s.media === 'restaurant')).toBe(false);
  });
});

describe('robustness of the rules', () => {
  it('repetition manager and contrast on a monotonous script', () => {
    const facts = ['The FIRST store opened.', 'Then CAME the drive.', 'Then CAME the menu.', 'Then CAME the franchise.', 'Then CAME the real estate.', 'Then CAME the brand.', 'Then CAME the world.', 'Then CAME the stock.'];
    const r = directEpisode(mcdonaldsInput({ script: facts.map((text) => ({ kind: 'text' as const, text })), narration: undefined }));
    const codes = r.qc.warnings.map((w) => w.code);
    for (const c of ['repetition.skill', 'repetition.typography', 'repetition.camera', 'intensity.strong.ratio']) expect(codes, c).not.toContain(c);
    const skills = r.plan.shots.map((s) => s.motionSkill);
    for (let i = 1; i < skills.length; i++) expect(skills[i], `shot ${i}`).not.toBe(skills[i - 1]);
  });

  it('without narration: estimated timing, no segments, still valid', () => {
    const r = run({ narration: undefined });
    expect(r.plan.narration).toBeUndefined();
    expect(r.plan.captions).toBeUndefined();
    expect(r.plan.silences).toBeUndefined(); // nothing to pause
    expect(r.decisions[0]).toBe('no narration transcript: timing estimated at 156 words per minute');
    expect(validateShotPlan(r.plan, { stage: 'final' }).errors).toEqual([]);
  });

  it('pacing changes the length of the pauses, not the words', () => {
    const length = (pacing: BrainInput['pacing']) => getShotStartFrames(run({ pacing }).plan).length && run({ pacing }).plan.shots.reduce((s, x) => s + x.durationInFrames, 0);
    expect(length('dynamic')).toBeLessThan(length('standard'));
    expect(length('standard')).toBeLessThan(length('calm'));
  });
});

describe('CLI (for montage.py)', () => {
  const cli = (args: string[], input: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runBrainCli(args, { readInput: () => input, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  it('direct → full result or plan only; explains decisions on stderr', () => {
    const input = JSON.stringify(mcdonaldsInput());
    const full = cli(['direct', '-'], input);
    expect(full.code).toBe(0);
    expect(JSON.parse(full.out)).toHaveProperty('plan.version', 2);
    expect(full.err).toContain('decision: u3: J-cut');
    const plan = cli(['direct', 'input.json', '--plan'], input);
    expect(JSON.parse(plan.out)).toHaveProperty('shots');
    expect(cli(['direct', '-'], '{"script": 1}').code).toBe(2);
    expect(cli(['render', '-'], input).code).toBe(2);
  });
});
