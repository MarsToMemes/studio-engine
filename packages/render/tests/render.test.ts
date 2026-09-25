import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, createScene, getShotPlanDuration, type ShotPlan, type VideoProject } from '@studio-engine/scene-engine';
import { createWavWriter, draftSegment, FfmpegRenderer, listCache, mixAudio, pruneCache, readWav, renderEpisode, resolveFfmpeg, runRenderCli, stackTexts, wrapText } from '../src/index';

const tools = resolveFfmpeg();
const tmp = () => mkdtempSync(join(tmpdir(), 'render-test-'));

/** 6 s mono source at 48 kHz: a 50 ms beep at 0.5 s, 1.5 s, 2.5 s… */
function beeps(dir: string): void {
  const w = createWavWriter(join(dir, 'beeps.wav'), 48000, 1);
  w.write(Float32Array.from({ length: 48000 * 6 }, (_, i) => {
    const t = i / 48000;
    return t >= 0.5 && (t - 0.5) % 1 < 0.05 ? 0.5 * Math.sin(2 * Math.PI * 1000 * t) : 0;
  }));
  w.close();
}
const onsets = (samples: Int16Array, channels: number) => {
  const out: number[] = [];
  let last = -1e9;
  for (let i = 0; i < samples.length / channels; i++) if (Math.abs(samples[i * channels]!) > 1000 && i - last > 4800) out.push(Math.round((i / 48000) * 30 * 100) / 100), (last = i);
  else if (Math.abs(samples[i * channels]!) > 1000) last = i;
  return out;
};

describe('wav', () => {
  it('writes and reads 16-bit PCM', () => {
    const dir = tmp();
    const w = createWavWriter(join(dir, 'a.wav'), 48000, 2);
    w.write(Float32Array.from([0, 0.5, -0.5, 1.2]));
    w.close();
    const r = readWav(join(dir, 'a.wav'));
    expect(r).toMatchObject({ sampleRate: 48000, channels: 2 });
    expect(Array.from(r.samples)).toEqual([0, 16384, -16383, 32767]);
  });
});

describe('audio mixer', () => {
  it('places a trimmed source to the sample, and applies the volume curve per frame', () => {
    const dir = tmp();
    beeps(dir);
    const p = createProject({ id: 'beeps', fps: 30, dimensions: { width: 320, height: 180 } });
    p.assets = { beeps: { id: 'beeps', kind: 'audio', src: 'beeps.wav', durationInSeconds: 6 } };
    p.scenes = [createScene('custom', { id: 's', durationInFrames: 150, layers: [] })];
    // Starts at frame 30, skips 0.5 s of the source: the first beep lands ON frame 30. Silent from frame 75.
    p.audio = [{ id: 'a', assetId: 'beeps', role: 'sfx', startFrame: 30, durationInFrames: 90, trim: { startFrom: 15, endAt: 105 }, volume: 1, automation: [{ frame: 75, gain: 0 }] }];
    mixAudio(p as VideoProject, join(dir, 'mix.wav'), { publicDir: dir, cacheDir: join(dir, 'cache'), tools });
    const mix = readWav(join(dir, 'mix.wav'));
    expect(mix).toMatchObject({ sampleRate: 48000, channels: 2 });
    expect(mix.samples.length / 2).toBe(150 * 1600);
    expect(onsets(mix.samples, 2)).toEqual([30, 60]); // the beep at 90 is after the automation cut
    // Looped source: beeps keep coming after the end of the file.
    p.audio = [{ id: 'a', assetId: 'beeps', role: 'music', startFrame: 0, loop: true, trim: { startFrom: 0, endAt: 60 }, volume: 1 }];
    mixAudio(p as VideoProject, join(dir, 'loop.wav'), { publicDir: dir, cacheDir: join(dir, 'cache'), tools });
    expect(onsets(readWav(join(dir, 'loop.wav')).samples, 2)).toEqual([15, 45, 75, 105, 135]);
  });
});

describe('draft layout', () => {
  it('wraps and stacks text without overlap', () => {
    expect(wrapText('They own the land under every restaurant', 16)).toEqual(['They own the', 'land under every', 'restaurant']);
    const t = stackTexts([{ text: 'MAP', size: 30, color: '#fff' }, { text: 'Chicago · Tokyo · London · Sydney', size: 80, color: '#fff', maxChars: 20 }], 0.5, 1080);
    for (let i = 1; i < t.length; i++) expect((t[i]!.y - t[i - 1]!.y) * 1080).toBeGreaterThanOrEqual((t[i]!.size + t[i - 1]!.size) / 2);
    const n = draftSegment({ id: 'n', type: 'number', durationInFrames: 60, number: { value: 61, suffix: '%', label: 'of revenue' } }, 1080, false);
    expect(n.texts.map((x) => x.text)).toEqual(['61%', 'OF REVENUE']);
    expect(draftSegment({ id: 'i', type: 'image', media: 'x', durationInFrames: 60, camera: 'pull_out' }, 1080, true)).toMatchObject({ kind: 'image', zoom: 'out', fadeIn: true });
  });
});

describe('cache', () => {
  it('prunes the least recently used files first', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'chunks'), { recursive: true });
    ['old', 'mid', 'new'].forEach((name, i) => {
      const f = join(dir, 'chunks', `${name}.mp4`);
      writeFileSync(f, Buffer.alloc(1000));
      utimesSync(f, new Date(2020, 0, 1 + i), new Date(2020, 0, 1 + i));
    });
    expect(pruneCache(dir, 2000)).toMatchObject({ removed: 1, freedBytes: 1000, keptBytes: 2000 });
    expect(listCache(dir).map((e) => e.file.split('/').pop()).sort()).toEqual(['mid.mp4', 'new.mp4']);
  });
});

describe('studio-render CLI', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, cli: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) } };
  };
  it('usage and loudness', async () => {
    const a = io();
    expect(await runRenderCli(['nope'], a.cli)).toBe(2);
    expect(a.err[0]).toContain('usage: studio-render render');
    const dir = tmp();
    beeps(dir);
    const b = io();
    expect(await runRenderCli(['loudness', join(dir, 'beeps.wav'), '--json'], b.cli)).toBe(1); // far from -14 LUFS
    expect(JSON.parse(b.out[0]!)).toMatchObject({ preset: 'master', pass: false, issues: [{ code: 'mix.loudness', rule: 'MUS-09' }] });
  });
});

// The FFmpeg draft needs a full FFmpeg (zoompan, drawtext): skipped where only Remotion's minimal build exists.
const full = new FfmpegRenderer().check().ok;
describe.skipIf(!full)('FFmpeg draft and fallback', () => {
  const plan: ShotPlan = {
    version: 1, fps: 30, width: 640, height: 360,
    assets: {},
    shots: [
      { id: 'a', type: 'text', text: 'They own the land', durationInFrames: 30 },
      { id: 'b', type: 'number', number: { value: 61, suffix: '%' }, durationInFrames: 30, transition: 'fade' },
    ],
  };

  it('renders a marked draft with the exact number of frames', async () => {
    const dir = tmp();
    const r = await new FfmpegRenderer().render({ plan, output: join(dir, 'draft.mp4'), publicDir: dir, cacheDir: join(dir, 'cache'), master: false });
    expect(r).toMatchObject({ engine: 'ffmpeg', draft: true, durationInFrames: getShotPlanDuration(plan), chunks: { total: 2, rendered: 2 } });
    expect(statSync(r.output).size).toBeGreaterThan(1000);
    const again = await new FfmpegRenderer().render({ plan, output: join(dir, 'draft2.mp4'), publicDir: dir, cacheDir: join(dir, 'cache'), master: false });
    expect(again.chunks).toEqual({ total: 2, rendered: 0, cached: 2 });
  }, 60_000);

  it('falls back to the draft when Remotion cannot render, and says so', async () => {
    const dir = tmp();
    const r = await renderEpisode({ plan, output: join(dir, 'out.mp4'), publicDir: dir, cacheDir: join(dir, 'cache'), master: false }, { entryPoint: join(dir, 'missing.ts'), fallback: true });
    expect(r.draft).toBe(true);
    expect(r.notes[0]).toMatch(/^Remotion failed \(Remotion entry point not found/);
    await expect(renderEpisode({ plan, output: join(dir, 'x.mp4'), publicDir: dir }, { entryPoint: join(dir, 'missing.ts') })).rejects.toThrow('entry point not found');
    expect(readFileSync(r.output).length).toBeGreaterThan(1000);
  }, 60_000);
});
