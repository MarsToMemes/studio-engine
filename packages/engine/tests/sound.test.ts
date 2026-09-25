import { describe, expect, it } from 'vitest';
import {
  audioVolumeAt,
  automationGainAt,
  buildRemotionPlan,
  compileShotPlan,
  getShotStartFrames,
  judgeLoudness,
  LOUDNESS_TARGETS,
  loudnormSecondPass,
  parseLoudnorm,
  ruleForIssue,
  MUSIC_STATE_LEVELS,
  musicAutomation,
  validateProject,
  type ShotPlan,
  type VideoProject,
} from '../src/index';
import { buildEditorialPlan } from './fixtures/editorial-episode';

const db = (gain: number) => 20 * Math.log10(gain);
const own = { provider: 'own production', license: 'own', commercialUse: true };

function musicOf(plan: ShotPlan) {
  const r = compileShotPlan(plan);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const remotion = buildRemotionPlan(r.project as VideoProject);
  return { r, music: remotion.audio.find((a) => a.id === 'music')!, remotion };
}

describe('gain automation', () => {
  it('ramps from the value reached so far, cuts when rampFrames is 0', () => {
    const pts = [
      { frame: 10, gain: 2, rampFrames: 10 },
      { frame: 15, gain: 0, rampFrames: 0 },
      { frame: 20, gain: 1, rampFrames: 4 },
    ];
    expect(automationGainAt(pts, 0)).toBe(1);
    expect(automationGainAt(pts, 10)).toBe(1);
    expect(automationGainAt(pts, 14)).toBeCloseTo(1.4);
    expect(automationGainAt(pts, 15)).toBe(0);
    expect(automationGainAt(pts, 22)).toBeCloseTo(0.5);
    expect(automationGainAt(pts, 30)).toBe(1);
    expect(automationGainAt([], 30)).toBe(1);
  });

  it('is validated on audio tracks', () => {
    const r = compileShotPlan(buildEditorialPlan());
    if (!r.ok) throw new Error('compile');
    const project = structuredClone(r.project) as VideoProject;
    project.audio[project.audio.length - 1]!.automation = [{ frame: -1, gain: 1 }, { frame: 2, gain: 9 }];
    const codes = validateProject(project).errors.map((e) => e.code);
    expect(codes.filter((c) => c === 'audio.automation.invalid')).toHaveLength(2);
  });
});

describe('music cues are heard (MUS-04, MUS-05)', () => {
  const plan = buildEditorialPlan();
  const starts = getShotStartFrames(plan);
  const at = (id: string) => starts[plan.shots.findIndex((s) => s.id === id)]!;

  it('the music follows the state of each scene, relative to the bed', () => {
    const { music, r } = musicOf(plan);
    expect(r.notes.join()).not.toContain('not rendered yet');
    const gain = (f: number) => automationGainAt(music.envelope.automation, f);
    // tension (+1 dB) from the start; build rises slowly through its scene toward +2 dB; aftermath (-4 dB).
    expect(db(gain(5))).toBeCloseTo(MUSIC_STATE_LEVELS.tension.db, 5);
    const early = db(gain(at('chapter-2') + 10));
    const late = db(gain(at('reveal') - 14));
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThanOrEqual(MUSIC_STATE_LEVELS.build.db);
    expect(db(gain(at('billions') + 60))).toBeCloseTo(MUSIC_STATE_LEVELS.aftermath.db, 1);
  });

  it('a music_drop silence is silent, and the music comes back on the revelation', () => {
    const { music } = musicOf(plan);
    const reveal = at('reveal');
    // The drop takes a few frames (no click), then silence until the revelation.
    expect(audioVolumeAt(music, reveal - 6 - music.from)).toBe(0);
    expect(audioVolumeAt(music, reveal - 1 - music.from)).toBe(0);
    expect(automationGainAt(music.envelope.automation, reveal)).toBeCloseTo(Math.pow(10, MUSIC_STATE_LEVELS.reveal.db / 20));
    expect(audioVolumeAt(music, reveal + 1 - music.from)).toBeGreaterThan(0);
  });

  it('explicit cue levels are absolute dB of the music', () => {
    const p = buildEditorialPlan();
    p.music = { ...p.music!, cues: [{ id: 'c1', atFrame: 0, state: 'calm', gainDb: -24, fadeInFrames: 0 }] };
    p.silences = [];
    const { music } = musicOf(p);
    expect(db(automationGainAt(music.envelope.automation, 10))).toBeCloseTo(-6, 5); // -24 on a -18 bed
    expect(musicAutomation([], [], { fps: 30, bedDb: -18 })).toEqual([]);
    // A cue far above the bed is capped at +12 dB instead of failing the compile.
    expect(musicAutomation([{ id: 'loud', atFrame: 0, state: 'reveal', gainDb: 0 }], [], { fps: 30, bedDb: -18 })[0]!.gain).toBe(4);
  });
});

describe('sfx_drop and ambient_drop', () => {
  it('drops the sound effects inside the silence, keeps the hit after it', () => {
    const p = buildEditorialPlan();
    p.silences = [{ id: 's', beforeShotId: 'reveal', durationInFrames: 12, kinds: ['music_drop', 'sfx_drop'] }];
    const before = p.shots.findIndex((s) => s.id === 'reveal') - 1;
    p.shots[before] = { ...p.shots[before]!, sfx: [{ sfx: 'sfx-impact', at: p.shots[before]!.durationInFrames - 5 }] };
    const { r } = musicOf(p);
    expect(r.notes.join('\n')).toContain('falls in a controlled silence (sfx_drop), skipped');
    const project = r.project as VideoProject;
    expect(project.scenes[before]!.audio).toHaveLength(0);
    expect(project.scenes.find((s) => s.id === 'reveal')!.audio).toHaveLength(1);
  });

  it('an ambience bed loops under everything and is cut by ambient_drop', () => {
    const p = buildEditorialPlan();
    p.assets = { ...p.assets, room: { id: 'room', kind: 'audio', src: 'music.wav', durationInSeconds: 30, source: own } };
    p.ambience = { assetId: 'room' };
    p.silences = [{ id: 's', beforeShotId: 'reveal', durationInFrames: 12, kinds: ['ambient_drop'] }];
    const { remotion } = musicOf(p);
    const amb = remotion.audio.find((a) => a.id === 'ambience')!;
    expect(amb).toMatchObject({ role: 'ambience', loop: true });
    const reveal = getShotStartFrames(p)[p.shots.findIndex((s) => s.id === 'reveal')]!;
    expect(db(audioVolumeAt(amb, 60))).toBeCloseTo(-28, 1);
    expect(audioVolumeAt(amb, reveal - 2)).toBe(0);
    expect(db(audioVolumeAt(amb, reveal + 2))).toBeCloseTo(-28, 1);
    // Music untouched by an ambient_drop.
    const music = remotion.audio.find((a) => a.id === 'music')!;
    expect(audioVolumeAt(music, reveal - 2)).toBeGreaterThan(0);
  });

  it('says when an ambient_drop has nothing to drop', () => {
    const p = buildEditorialPlan();
    p.silences = [{ id: 's', beforeShotId: 'reveal', durationInFrames: 12, kinds: ['ambient_drop'] }];
    expect(musicOf(p).r.notes.join()).toContain('ambient_drop silence without an ambience bed');
  });
});

describe('loudness (MUS-01, MUS-09)', () => {
  const stderr = `[Parsed_loudnorm_0 @ 0x1]
{
	"input_i" : "-16.71",
	"input_tp" : "-7.62",
	"input_lra" : "4.10",
	"input_thresh" : "-27.05",
	"output_i" : "-14.20",
	"output_tp" : "-5.10",
	"output_lra" : "3.90",
	"output_thresh" : "-24.50",
	"normalization_type" : "dynamic",
	"target_offset" : "0.20"
}`;

  it('parses loudnorm and judges against the YouTube master target', () => {
    const m = parseLoudnorm(stderr);
    expect(m).toEqual({ integrated: -16.71, truePeak: -7.62, lra: 4.1, threshold: -27.05, offset: 0.2 });
    const v = judgeLoudness(m, LOUDNESS_TARGETS.master);
    expect(v).toMatchObject({ pass: false, gainToTargetDb: 2.71, issues: [{ code: 'mix.loudness', rule: 'MUS-09', message: expect.stringContaining('too quiet by 2.7 LU') }] });
    expect(judgeLoudness({ ...m, integrated: -14.4, truePeak: -0.5 }, LOUDNESS_TARGETS.master).issues.map((i) => i.code)).toEqual(['mix.truePeak']);
    expect(judgeLoudness({ ...m, integrated: -16.2 }, LOUDNESS_TARGETS.voice, 'voice').pass).toBe(true);
    expect(ruleForIssue({ code: 'mix.loudness', severity: 'warning' } as never)).toBe('MUS-09');
  });

  it('builds the linear second pass from the measure', () => {
    expect(loudnormSecondPass(parseLoudnorm(stderr), LOUDNESS_TARGETS.master)).toBe('loudnorm=I=-14:TP=-1:LRA=11:measured_I=-16.71:measured_TP=-7.62:measured_LRA=4.1:measured_thresh=-27.05:offset=0.2:linear=true:print_format=json');
  });

  it('refuses an output without measure (silent input)', () => {
    expect(() => parseLoudnorm('no json here')).toThrow('no loudnorm JSON');
    expect(() => parseLoudnorm(stderr.replace('"-16.71"', '"-inf"'))).toThrow('input_i');
  });
});
