import { describe, expect, it } from 'vitest';
import {
  buildRemotionPlan,
  compileShotPlan,
  defaultMotionSkillRegistry,
  deriveMusicCues,
  fromTimeline,
  getShotStartFrames,
  migrateShotPlan,
  resolveNarration,
  toTimeline,
  validateShotPlan,
  type Shot,
  type ShotPlan,
} from '../src/index';
import { buildEditorialPlan } from './fixtures/editorial-episode';
import { buildEpisodePlan } from './fixtures/shotplan-episode';
import { codes } from './helpers';

const shot = (p: ShotPlan, id: string) => p.shots.find((s) => s.id === id)!;
const issues = (p: unknown, stage: 'draft' | 'final' = 'draft') => {
  const r = validateShotPlan(p, { stage });
  return [...r.errors, ...r.warnings];
};
const issue = (p: unknown, code: string, stage: 'draft' | 'final' = 'draft') => issues(p, stage).find((i) => i.code === code);

describe('editorial plan (ShotPlan v2)', () => {
  it('the reference episode is a clean final plan', () => {
    const r = validateShotPlan(buildEditorialPlan(), { stage: 'final', skillIds: defaultMotionSkillRegistry.availableIds(), skillCatalog: defaultMotionSkillRegistry });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('version 1 plans keep working', () => {
    const r = validateShotPlan(buildEpisodePlan());
    expect(r.valid).toBe(true);
    expect(codes(r.errors)).toEqual([]);
    // No editorial layer → none of the v2 blocking rules apply.
    expect(codes(r.warnings)).not.toContain('editorial.intent.missing');
  });

  it('blocking editorial rules are warnings in draft and errors in final', () => {
    const plan = buildEditorialPlan();
    delete shot(plan, 'stat').reasons;
    delete shot(plan, 'rent').visualHierarchy;
    plan.scenes![0]!.purpose = '';
    plan.assets.report!.source = { provider: 'unknown' };
    const draft = validateShotPlan(plan, { stage: 'draft' });
    expect(draft.valid).toBe(true);
    expect(codes(draft.warnings)).toEqual(expect.arrayContaining(['editorial.reason.missing', 'hierarchy.primary.missing', 'scene.purpose.missing', 'asset.license.missing']));
    const final = validateShotPlan(plan, { stage: 'final' });
    expect(final.valid).toBe(false);
    expect(final.errors.map((e) => `${e.code}:${e.rule}`)).toEqual(
      expect.arrayContaining(['editorial.reason.missing:DIR-01', 'hierarchy.primary.missing:HIER-01', 'scene.purpose.missing:SCENE-01', 'asset.license.missing:SRC-01']),
    );
    // A plan that could not be compiled in final is still previewable in draft.
    expect(compileShotPlan(plan).ok).toBe(true);
    expect(compileShotPlan(plan, { stage: 'final' }).ok).toBe(false);
  });

  it('checks vocabularies and ordinal levels', () => {
    const plan = buildEditorialPlan();
    Object.assign(shot(plan, 'hook'), { editorialIntent: 'epic_moment', importance: 0.87, beat: 'climax', musicState: 'epic', framing: 'dutch' });
    Object.assign(shot(plan, 'counter'), { camera: 'dolly_zoom', analysis: { surprise: 0.9 } });
    const found = issues(plan);
    expect(codes(found)).toEqual(expect.arrayContaining(['editorial.intent.invalid', 'editorial.level', 'editorial.beat.invalid', 'music.state.invalid', 'shot.framing', 'camera.unknown']));
    expect(found.find((i) => i.code === 'camera.unknown')!).toMatchObject({ severity: 'warning', rule: 'DIR-03' });
    expect(found.find((i) => i.code === 'editorial.level')!.severity).toBe('error');
  });

  it('scenes and chapters are declared and contiguous (SCENE-01)', () => {
    const plan = buildEditorialPlan();
    shot(plan, 'report').sceneId = 'nowhere';
    shot(plan, 'rent').sceneId = 'empire'; // splits "empire" around chapter-2? no: moves rent into empire before chapter-2
    shot(plan, 'chapter-2').sceneId = 'business'; // → business is split
    const found = codes(issues(plan));
    expect(found).toContain('scene.unknown');
    expect(found).toContain('scene.contiguous');
    const noScenes = { ...buildEditorialPlan(), scenes: [] };
    expect(issue(noScenes, 'scene.missing', 'final')).toMatchObject({ severity: 'error', rule: 'SCENE-01' });
    const badChapter = buildEditorialPlan();
    badChapter.scenes![1]!.chapterId = 'c9';
    expect(codes(issues(badChapter))).toContain('chapter.unknown');
  });

  it('scenes need a setup and a resolution; revelations need a setup (SCENE-02, REV-02)', () => {
    const plan = buildEditorialPlan();
    shot(plan, 'world').beat = 'development';
    expect(issue(plan, 'scene.beats')).toMatchObject({ rule: 'SCENE-02' });
    expect(issue(plan, 'reveal.setup')).toMatchObject({ rule: 'REV-02' });
  });

  it('music changes happen at scene boundaries or around a revelation (MUS-03)', () => {
    const plan = buildEditorialPlan();
    expect(issue(plan, 'music.state.change')).toBeUndefined(); // reveal → aftermath is allowed
    shot(plan, 'report').musicState = 'calm';
    expect(issue(plan, 'music.state.change')).toMatchObject({ rule: 'MUS-03', path: 'shots[3].musicState' });
    delete shot(plan, 'rent').musicState;
    expect(issue(plan, 'music.state.missing')).toMatchObject({ rule: 'MUS-03' });
  });

  it('chapter cards, runs of the same type and intentional long shots', () => {
    const plan = buildEpisodePlan(); // v1: these rules apply to every plan
    expect(issue(plan, 'chapter.duration')).toMatchObject({ rule: 'CHAP-01' }); // 2 s card
    shot(plan, 'chapter-2').text = 'The incredible hidden real estate empire of McDonald';
    expect(issue(plan, 'chapter.title.long')).toMatchObject({ rule: 'CHAP-02' });

    const images: Shot[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'image', media: 'landscape', durationInFrames: 90, motionSkill: 'slow_zoom' }));
    const run = { ...buildEpisodePlan(), shots: images };
    expect(issue(run, 'variety.consecutive')).toMatchObject({ rule: 'VAR-01', path: 'shots[3]' });
    expect(issue({ ...run, shots: images.map((s) => ({ ...s, sequence: 'archive-montage' })) }, 'variety.consecutive')).toBeUndefined();

    const still: Shot = { id: 'still', type: 'image', media: 'landscape', durationInFrames: 180 };
    const one = (s: Shot) => ({ ...buildEpisodePlan(), shots: [shot(buildEpisodePlan(), 'hook'), s] });
    expect(issue(one(still), 'pacing.static')).toBeDefined();
    expect(issue(one({ ...still, camera: 'push_in' }), 'pacing.static')).toBeUndefined(); // a camera move is movement
    expect(issue(one({ ...still, hold: 'let the viewer read the plaque' }), 'pacing.static')).toBeUndefined();
    expect(issue(one({ ...still, hold: 'too long', durationInFrames: 300 }), 'pacing.hold.max')).toMatchObject({ rule: 'RHY-04' });
  });

  it('cuts never fall inside a spoken word (RHY-08)', () => {
    const plan = buildEditorialPlan();
    expect(issue(plan, 'pacing.cut.word')).toBeUndefined();
    shot(plan, 'hook').durationInFrames -= 10; // the cut now falls inside "company."
    const cut = issues(plan).find((i) => i.code === 'pacing.cut.word' && i.path === 'shots[1].durationInFrames');
    expect(cut).toMatchObject({ rule: 'RHY-08', message: expect.stringContaining('"company."') });
  });

  it('controlled silences (SIL-02, SIL-03, SIL-04) and the voice', () => {
    const plan = buildEditorialPlan();
    plan.silences = [{ id: 'long', beforeShotId: 'reveal', durationInFrames: 45, kinds: ['music_drop'] }];
    const found = issues(plan);
    expect(found.find((i) => i.code === 'silence.duration')).toMatchObject({ rule: 'SIL-02' });
    expect(codes(found)).toContain('silence.voice'); // 1.5 s before the reveal overlaps the end of the sentence
    plan.silences = [
      { id: 'a', beforeShotId: 'billions', durationInFrames: 12, kinds: ['sfx_drop'] },
      { id: 'b', beforeShotId: 'reveal', durationInFrames: 12, kinds: ['music_drop'] },
    ];
    const f2 = issues(plan);
    expect(f2.find((i) => i.code === 'silence.frequency')).toMatchObject({ rule: 'SIL-03' });
    expect(f2.find((i) => i.code === 'silence.payoff')).toBeUndefined(); // billions is an important fact
    plan.silences = [{ id: 'weak', beforeShotId: 'rent', durationInFrames: 12, kinds: ['music_drop'] }];
    expect(issue(plan, 'silence.payoff')).toMatchObject({ rule: 'SIL-04' });
    plan.silences = [{ id: 'x', beforeShotId: 'ghost', durationInFrames: 12, kinds: ['music_drop'] }];
    expect(issue(plan, 'silence.shot.unknown')!.severity).toBe('error');
  });

  it('rights of every asset (SRC-01, SRC-02) and glitch budget (TRANS-03)', () => {
    const plan = buildEditorialPlan();
    plan.assets.music!.source = { license: 'personal use', commercialUse: false };
    expect(issue(plan, 'asset.license.noncommercial', 'final')).toMatchObject({ severity: 'error', rule: 'SRC-02' });
    const glitchy = buildEpisodePlan();
    glitchy.shots.forEach((s, i) => i > 0 && i % 2 === 0 && (s.transition = 'glitch'));
    expect(issue(glitchy, 'transition.glitch.max')).toMatchObject({ rule: 'TRANS-03' });
  });
});

describe('robustness', () => {
  it('never throws on malformed editorial data (an AI can write anything)', () => {
    const plan = buildEditorialPlan() as unknown as Record<string, unknown>;
    const bad = {
      ...plan,
      narration: { assetId: 'narration', words: 'oops', segments: [null, { id: 'x' }] },
      silences: [null, { id: 's', beforeShotId: 'reveal', durationInFrames: 'long', kinds: 'music_drop' }],
      music: { assetId: 'music', cues: [null] },
      scenes: [null, { id: 'business', purpose: 'p' }],
      chapters: [null],
      assets: { ...(plan.assets as object), ghost: null },
    };
    expect(() => validateShotPlan(bad, { stage: 'final' })).not.toThrow();
    const r = validateShotPlan(bad);
    expect(codes(r.errors)).toEqual(expect.arrayContaining(['narration.words.invalid', 'narration.segment.invalid', 'silence.invalid', 'music.cue.invalid', 'scene.invalid', 'chapter.invalid']));
  });
});

describe('segmented narration', () => {
  it('places the words of each segment on the timeline', () => {
    const plan = buildEditorialPlan();
    const n = resolveNarration(plan);
    expect(n.segmented).toBe(true);
    expect(n.voice.map((v) => v.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
    // "They" is the first word of s7, placed where the reveal shot starts.
    const starts = getShotStartFrames(plan);
    const reveal = plan.shots.findIndex((s) => s.id === 'reveal');
    const they = n.words.find((w) => w.text === 'They')!;
    expect(Math.round((they.startMs / 1000) * plan.fps)).toBe(starts[reveal]);
    // Nothing is spoken during the silent chapter card.
    const card = plan.shots.findIndex((s) => s.id === 'chapter-2');
    const cardEnd = starts[card]! + plan.shots[card]!.durationInFrames;
    const cardWindowSpoken = n.words.filter((w) => {
      const f = Math.round((w.startMs / 1000) * plan.fps);
      return f >= starts[card]! + 18 && f < cardEnd; // after the fade overlap
    });
    expect(cardWindowSpoken).toEqual([]);
  });

  it('continuous narration (v1) is unchanged', () => {
    const plan = buildEpisodePlan();
    const n = resolveNarration(plan);
    expect(n.segmented).toBe(false);
    expect(n.words).toEqual(plan.narration!.words);
    expect(n.voice).toEqual([{ id: 'narration', startFrame: 0, sourceStartFrame: 0, durationInFrames: 1200 }]);
  });

  it('compiles one voice track per segment and ducks the music per segment (MUS-06)', () => {
    const plan = buildEditorialPlan();
    const r = compileShotPlan(plan);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const voices = r.project.audio.filter((a) => a.role === 'voiceover');
    expect(voices).toHaveLength(8);
    expect(voices[1]).toMatchObject({ id: 'narration:s2', startFrame: 75, trim: { startFrom: voices[1]!.trim!.startFrom, endAt: voices[1]!.trim!.startFrom! + voices[1]!.durationInFrames! } });
    const remotion = buildRemotionPlan(r.project);
    // What <Html5Audio> receives: each segment plays its own range of the file.
    const s2 = remotion.audio.find((a) => a.id === 'narration:s2')!;
    expect(s2).toMatchObject({ from: 75, startFrom: voices[1]!.trim!.startFrom, endAt: voices[1]!.trim!.endAt, durationInFrames: voices[1]!.durationInFrames });
    const music = remotion.audio.find((a) => a.role === 'music')!;
    expect(music.envelope.ducking).toHaveLength(8);
    // The music comes back up between sentences (e.g. during the chapter card).
    const gaps = music.envelope.ducking.slice(1).map((w, i) => w.startFrame - music.envelope.ducking[i]!.endFrame);
    expect(Math.max(...gaps)).toBeGreaterThan(30);
    // Captions follow the segments: the map shot carries "empire" from s6.
    const world = r.project.scenes.find((s) => s.id === 'world')!;
    expect(world.captions!.cues.map((c) => c.text).join(' ')).toContain('empire');
  });

  it('rejects overlapping segments', () => {
    const plan = buildEditorialPlan();
    plan.narration!.segments![2]!.startFrame = 100;
    expect(issue(plan, 'narration.segment.overlap')!.severity).toBe('error');
  });
});

describe('shot camera and framing', () => {
  const compiled = () => {
    const r = compileShotPlan(buildEditorialPlan());
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r;
  };

  it('moves the media with the requested camera, 5–10 % (CAM-03)', () => {
    const r = compiled();
    const counter = r.project.scenes.find((s) => s.id === 'counter')!;
    const media = counter.layers.find((l) => l.id === 'counter:media')!;
    expect(media.scale).toBe(1.15); // medium framing
    expect(media.animations).toContainEqual(expect.objectContaining({ type: 'camera', move: 'pushIn', intensity: 0.42 }));
    expect(counter.metadata!.extra!.camera).toBe('push_in');
    const conclusion = r.project.scenes.find((s) => s.id === 'conclusion')!;
    expect(conclusion.layers.find((l) => l.id === 'conclusion:media')!.animations).toContainEqual(expect.objectContaining({ type: 'camera', move: 'pullOut' }));
  });

  it('one camera move per shot: a skill that moves the camera wins (CAM-02)', () => {
    const r = compiled();
    expect(r.notes).toContain('report: [CAM-02] camera "push_in" ignored: skill "document_highlight" already moves the camera');
    expect(r.project.scenes.find((s) => s.id === 'report')!.metadata!.extra!.camera).toBeUndefined();
  });

  it('skill-based camera moves compose with a content skill', () => {
    const reveal = compiled().project.scenes.find((s) => s.id === 'reveal')!;
    expect(reveal.metadata!.extra).toMatchObject({ appliedSkill: 'blackout_reveal', camera: 'punch_in' });
  });

  it('reports what is not rendered yet instead of silently ignoring it', () => {
    const notes = compiled().notes.join('\n');
    expect(notes).toContain('music cues are part of the Timeline JSON but not rendered yet');
    expect(notes).toContain('controlled silences are validated but not rendered yet');
  });
});

describe('Timeline JSON v2', () => {
  it('exposes the editorial layer flat, with music cues and silences', () => {
    const plan = buildEditorialPlan();
    const t = toTimeline(plan);
    expect(t.version).toBe(2);
    expect(t.shots[0]).toMatchObject({ id: 'hook', editorialIntent: 'hook', importance: 5, sceneId: 'business', beat: 'setup', musicState: 'tension', transition: 'hard_cut', sfx: 'sfx-impact' });
    expect(t.shots[0]!.metadata!.reasons).toMatchObject({ shot: expect.stringContaining('contradiction') });
    expect(t.shots[1]).toMatchObject({ camera: 'push_in', framing: 'medium' });
    expect(t.musicCues!.map((c) => c.state)).toEqual(['tension', 'build', 'reveal', 'aftermath']);
    const revealStart = t.shots.find((s) => s.id === 'reveal')!.startFrame;
    expect(t.silences).toEqual([{ id: 'before-reveal', beforeShotId: 'reveal', durationInFrames: 12, kinds: ['music_drop'], startFrame: revealStart - 12 }]);
    expect(t.chapters).toHaveLength(2);
    expect(t.narrationSegments).toHaveLength(8);
  });

  it('is lossless', () => {
    const plan = buildEditorialPlan();
    const { narration, music, captions, metadata, assets } = plan;
    const back = fromTimeline(JSON.parse(JSON.stringify(toTimeline(plan))), { assets, narration: { ...narration!, segments: undefined as never }, music: music!, captions: captions!, metadata: metadata! });
    // Segments travel in the Timeline when `rest` does not provide them.
    delete back.plan.narration!.segments;
    back.plan.narration = { ...back.plan.narration!, segments: toTimeline(plan).narrationSegments! };
    expect(back.startFrameMismatches).toEqual([]);
    expect(back.plan).toEqual(plan);
  });

  it('explicit music cues win over derived ones', () => {
    const plan = buildEditorialPlan();
    plan.music!.cues = [{ id: 'late', atFrame: 300, state: 'build' }, { id: 'start', atFrame: 0, state: 'calm' }];
    expect(deriveMusicCues(plan, getShotStartFrames(plan)).map((c) => c.id)).toEqual(['start', 'late']);
    expect(validateShotPlan(plan).valid).toBe(true);
  });
});

describe('v1 → v2 migration', () => {
  it('upgrades without inventing reasoning', () => {
    const v1 = buildEpisodePlan();
    const v2 = migrateShotPlan(v1);
    expect(v2.version).toBe(2);
    expect(v2.shots.map((s) => s.editorialIntent)).toEqual(['hook', 'fact', 'context', 'number', 'proof', 'statistic', 'location', 'chapter', 'revelation', 'important_fact']);
    expect(v2.shots.every((s) => s.decidedBy === 'migration' && s.sceneId === 'scene-1' && s.reasons === undefined)).toBe(true);
    // Every v1 field is kept.
    expect(v2.shots.map(({ sceneId: _s, editorialIntent: _e, decidedBy: _d, ...rest }) => rest)).toEqual(v1.shots);
    // Previewable as a draft; the final check lists what the editor brain must fill in.
    expect(validateShotPlan(v2).valid).toBe(true);
    const final = codes(validateShotPlan(v2, { stage: 'final' }).errors);
    expect(final).toEqual(expect.arrayContaining(['editorial.reason.missing', 'hierarchy.primary.missing', 'scene.purpose.missing', 'asset.license.missing']));
    expect(migrateShotPlan(v2)).toBe(v2);
  });
});
