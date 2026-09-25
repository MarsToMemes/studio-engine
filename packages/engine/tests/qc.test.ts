import { describe, expect, it } from 'vitest';
import {
  activeShare,
  audioFrames,
  darkKind,
  expectedDarkWindows,
  formatQcReport,
  frameDifference,
  frameStats,
  getShotPlanDuration,
  getShotStartFrames,
  parseFfprobe,
  resolveNarration,
  resolveSilences,
  runQc,
  runsOf,
  uncoveredRuns,
  usedFontFamilies,
  primaryFontFamily,
  compileShotPlan,
  type AudioFrame,
  type FrameStats,
  type QcInput,
  type VideoProject,
} from '../src/index';
import { buildEditorialPlan } from './fixtures/editorial-episode';

const plan = buildEditorialPlan();
const fps = plan.fps;
const total = getShotPlanDuration(plan);
const starts = getShotStartFrames(plan);
const startOf = (id: string) => starts[plan.shots.findIndex((s) => s.id === id)]!;
const now = () => new Date('2026-01-01T00:00:00Z');

/** A clean render: content on screen, moving, voice where the plan speaks, silent in the silences. */
function cleanRender(): Required<Pick<QcInput, 'frames' | 'motion' | 'audio' | 'probe' | 'loudness'>> {
  const voice = resolveNarration(plan).voice;
  const silences = resolveSilences(plan, starts);
  const frames: FrameStats[] = Array.from({ length: total }, () => ({ mean: 0.3, bright: 0.2 }));
  const motion = Array.from({ length: total }, () => 0.05);
  const audio: AudioFrame[] = Array.from({ length: total }, (_, f) => {
    if (silences.some((s) => f >= s.startFrame && f < s.endFrame)) return { rmsDb: -90, peak: 0 };
    return { rmsDb: voice.some((v) => f >= v.startFrame && f < v.startFrame + v.durationInFrames) ? -20 : -38, peak: 0.4 };
  });
  return {
    frames,
    motion,
    audio,
    probe: { width: 1920, height: 1080, fps, videoCodec: 'h264', durationSeconds: total / fps, frameCount: total, audioCodec: 'aac' },
    loudness: { integrated: -14.2, truePeak: -1.8, lra: 5, threshold: -24, offset: 0 },
  };
}
const ids = (r: ReturnType<typeof runQc>, status: string) => r.checks.filter((c) => c.status === status).map((c) => `${c.id}:${c.rule ?? ''}`);

describe('frame and audio primitives', () => {
  it('measures frames and tells black from empty', () => {
    const black = new Uint8Array(100);
    const text = Uint8Array.from({ length: 100 }, (_, i) => (i < 5 ? 255 : 18));
    expect(frameStats(black)).toEqual({ mean: 0, bright: 0 });
    expect(darkKind(frameStats(black))).toBe('black');
    expect(darkKind({ mean: 0.07, bright: 0 })).toBe('empty'); // the theme background alone
    expect(darkKind(frameStats(text))).toBeUndefined(); // white text on it
    expect(frameDifference(black, text)).toBeGreaterThan(0.05);
    expect(runsOf([0, 1, 1, 0, 1], (v) => v === 1)).toEqual([{ startFrame: 1, endFrame: 3 }, { startFrame: 4, endFrame: 5 }]);
    expect(uncoveredRuns({ startFrame: 0, endFrame: 10 }, [{ startFrame: 2, endFrame: 5 }])).toEqual([{ startFrame: 0, endFrame: 2 }, { startFrame: 5, endFrame: 10 }]);
  });

  it('computes per-frame levels and the active share', () => {
    const sr = 3000;
    const samples = Float32Array.from({ length: sr }, (_, i) => (i < sr / 2 ? 0.5 * Math.sin(i) : 0));
    const a = audioFrames(samples, sr, 30);
    expect(a).toHaveLength(30);
    expect(a[0]!.rmsDb).toBeGreaterThan(-12);
    expect(a[29]!.rmsDb).toBe(-120);
    expect(activeShare(a, 0, 30, -45)).toBeCloseTo(0.5, 1);
  });

  it('knows where dark pictures are intended', () => {
    const w = expectedDarkWindows(plan);
    const chapter = startOf('chapter-2');
    expect(w).toContainEqual(expect.objectContaining({ startFrame: chapter, reason: 'chapter card "chapter-2"' }));
    expect(w.some((x) => x.reason.startsWith('dip to black') && x.startFrame < chapter && x.endFrame > chapter)).toBe(true);
  });

  it('reads ffprobe', () => {
    const p = parseFfprobe(JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30/1', duration: '10.0', nb_frames: '300' }, { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }], format: { duration: '10.06' } }));
    expect(p).toEqual({ width: 1920, height: 1080, fps: 30, videoCodec: 'h264', durationSeconds: 10, frameCount: 300, audioCodec: 'aac', audioSampleRate: 48000, audioChannels: 2 });
  });
});

describe('QC report', () => {
  it('a clean render passes, every check cites its rule', () => {
    const r = runQc({ plan, ...cleanRender(), now });
    expect(r.summary).toMatchObject({ pass: true, failed: 0 });
    expect(ids(r, 'pass')).toEqual(expect.arrayContaining(['plan.valid:TECH-02', 'render.format:TECH-07', 'render.black:TECH-03', 'render.frozen:RHY-03', 'audio.voice:TECH-01', 'audio.silence:SIL-04', 'audio.gap:TECH-08', 'audio.clipping:TECH-05', 'audio.loudness:MUS-09']));
    expect(r.attributions).toEqual([{ assetId: 'report', attribution: "McDonald's Annual Report 2023" }]);
    expect(r.review).toMatchObject({ status: 'pending' });
    expect(r.review.rules.length).toBeGreaterThan(40);
    expect(r.generatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('black frames fail where the plan shows content, not on a chapter card', () => {
    const render = cleanRender();
    const img = startOf('counter') + 20;
    for (let f = img; f < img + 6; f++) render.frames[f] = { mean: 0.01, bright: 0 };
    const chapter = startOf('chapter-2') + 20;
    for (let f = chapter; f < chapter + 20; f++) render.frames[f] = { mean: 0.01, bright: 0 };
    const r = runQc({ plan, ...render, now });
    const black = r.checks.filter((c) => c.id === 'render.black' && c.status === 'fail');
    expect(black).toHaveLength(1);
    expect(black[0]).toMatchObject({ rule: 'TECH-03', at: { frame: img, shotId: 'counter' } });
    expect(r.summary.pass).toBe(false);
    // Two frames are tolerated.
    const two = cleanRender();
    two.frames[img] = two.frames[img + 1] = { mean: 0, bright: 0 };
    expect(runQc({ plan, ...two, now }).summary.pass).toBe(true);
  });

  it('a frozen picture warns, unless the shot is an intentional hold', () => {
    const render = cleanRender();
    const s = startOf('report');
    for (let f = s + 10; f < s + 10 + 4 * fps; f++) render.motion[f] = 0;
    expect(ids(runQc({ plan, ...render, now }), 'warn')).toContain('render.frozen:RHY-03');
    const held = structuredClone(plan);
    held.shots.find((x) => x.id === 'report')!.hold = 'let the highlighted line be read';
    expect(ids(runQc({ plan: held, ...render, now }), 'warn')).not.toContain('render.frozen:RHY-03');
  });

  it('a muted voice, a gap, a noisy silence and clipping are reported', () => {
    const render = cleanRender();
    const v = resolveNarration(plan).voice[2]!;
    for (let f = v.startFrame; f < v.startFrame + v.durationInFrames; f++) render.audio[f] = { rmsDb: -120, peak: 0 };
    render.audio[v.startFrame + 5] = { rmsDb: -10, peak: 0.6 }; // one loud instant does not hide a missing voice
    const sil = resolveSilences(plan, starts)[0]!;
    for (let f = sil.startFrame; f < sil.endFrame; f++) render.audio[f] = { rmsDb: -25, peak: 0.3 };
    render.audio[100] = { rmsDb: -3, peak: 1 };
    const r = runQc({ plan, ...render, now });
    expect(ids(r, 'fail')).toEqual(expect.arrayContaining(['audio.voice:TECH-01', 'audio.clipping:TECH-05']));
    expect(ids(r, 'warn')).toEqual(expect.arrayContaining(['audio.gap:TECH-08', 'audio.silence:SIL-04']));
    expect(r.checks.find((c) => c.id === 'audio.voice' && c.status === 'fail')!.message).toContain(`"${v.id}"`);
  });

  it('format and loudness: final is strict, preview is not', () => {
    const render = cleanRender();
    render.probe = { ...render.probe, width: 480, height: 270 };
    expect(ids(runQc({ plan, ...render, now }), 'fail')).toContain('render.format:TECH-07');
    expect(ids(runQc({ plan, ...render, stage: 'preview', now }), 'pass')).toContain('render.format:TECH-07');
    render.loudness = { ...render.loudness, integrated: -17, truePeak: 0.3 };
    const r = runQc({ plan, ...render, stage: 'preview', now });
    expect(ids(r, 'warn')).toContain('audio.loudness:MUS-09');
    expect(ids(r, 'fail')).toContain('audio.truePeak:TECH-05');
  });

  it('plan problems, synthetic media and the editorial review', () => {
    const p = structuredClone(plan);
    p.assets.landscape = { ...p.assets.landscape!, source: { ...p.assets.landscape!.source, syntheticMedia: true } };
    p.shots[0]!.sfx = [{ sfx: 'nope' }];
    const r = runQc({
      plan: p,
      now,
      review: { status: 'done', reviewer: 'claude-test', summary: 'ok', checkedRules: ['RHY-06'], findings: [{ rule: 'RHY-06', shots: ['billions'], severity: 'minor', finding: 'The pace does not breathe after the revelation.', fix: 'Lengthen "billions" by 1 s.' }] },
    });
    expect(r.disclosures[0]).toContain('altered or synthetic content');
    expect(ids(r, 'warn')).toEqual(expect.arrayContaining(['rights.synthetic:SRC-04', 'review.finding:RHY-06']));
    expect(r.checks.find((c) => c.id === 'review.finding')).toMatchObject({ at: { shotId: 'billions' } });
    expect(ids(r, 'skipped')).toEqual(expect.arrayContaining(['render.format:TECH-07', 'audio.loudness:MUS-09']));
    const text = formatQcReport(r);
    expect(text).toMatch(/^QC final: (PASS|FAIL)/);
    expect(text).toContain('[RHY-06] [minor]');
  });
});

describe('fonts (TECH-04)', () => {
  it('lists the fonts a project asks for', () => {
    expect(primaryFontFamily('"Source Serif 4", Georgia, serif')).toBe('Source Serif 4');
    expect(primaryFontFamily('sans-serif')).toBeUndefined();
    const r = compileShotPlan(plan);
    if (!r.ok) throw new Error('compile');
    expect(usedFontFamilies(r.project as VideoProject)).toEqual(['Inter']);
  });
});

describe('media resolution (TECH-09)', () => {
  it('warns when an image is enlarged more than 1.5× on screen', () => {
    const p = structuredClone(plan);
    p.assets.small = { id: 'small', kind: 'image', src: 'landscape.png', width: 1280, height: 720, source: { license: 'own', commercialUse: true } };
    const i = p.shots.findIndex((s) => s.type === 'image');
    p.shots[i] = { ...p.shots[i]!, media: 'small', framing: 'close_up', camera: 'static' };
    const w = runQc({ plan: p, now }).checks.find((c) => c.id === 'plan.media.upscale')!;
    expect(w).toMatchObject({ rule: 'TECH-09', status: 'warn', message: expect.stringContaining('enlarged 2.1×') });
    // A full HD source in a wide framing is fine.
    p.shots[i] = { ...p.shots[i]!, media: 'landscape', framing: 'wide' };
    expect(runQc({ plan: p, now }).checks.find((c) => c.id === 'plan.media.upscale')).toBeUndefined();
  });
});
