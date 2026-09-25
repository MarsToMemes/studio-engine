/** Quality control of a rendered episode (engine `runQc`), with FFmpeg doing the decoding. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioFrames, frameDifference, frameStats, getShotStartFrames, parseFfprobe, runQc, type EditorialReview, type QcReport, type ShotPlan } from '@studio-engine/scene-engine';
import { ffprobeJson, runFfmpeg, streamFfmpeg, type FfmpegTools } from './ffmpeg.js';
import { measureLoudness } from './master.js';
import { readWav } from './wav.js';

const W = 96;
const H = 54;

/** Grayscale frames streamed from FFmpeg: stats, and the difference with the frame one second earlier. */
export async function analysePictures(tools: FfmpegTools, file: string, fps: number) {
  const size = W * H;
  const frames: ReturnType<typeof frameStats>[] = [];
  const motion: number[] = [];
  const ring: Uint8Array[] = [];
  let pending = Buffer.alloc(0);
  await streamFfmpeg(tools, ['-i', file, '-an', '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-r', String(fps), '-f', 'image2pipe', '-c:v', 'rawvideo', '-'], (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= size) {
      const gray = new Uint8Array(pending.subarray(0, size));
      pending = pending.subarray(size);
      frames.push(frameStats(gray));
      ring.push(gray);
      if (ring.length > fps + 1) ring.shift();
      motion.push(ring.length > fps ? frameDifference(gray, ring[0]!) : 1);
    }
  });
  return { frames, motion };
}

/** Mono 48 kHz samples of the mix, through a temporary WAV (every FFmpeg build writes WAV). */
export function decodeMono(tools: FfmpegTools, file: string): Float32Array {
  const dir = mkdtempSync(join(tmpdir(), 'qc-'));
  try {
    const wav = join(dir, 'mix.wav');
    runFfmpeg(tools, ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
    return Float32Array.from(readWav(wav).samples, (v) => v / 32768);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One still per shot, at 60 % of it (input of the AI critic). */
export function saveStills(tools: FfmpegTools, file: string, plan: ShotPlan, dir: string): void {
  mkdirSync(dir, { recursive: true });
  const starts = getShotStartFrames(plan);
  plan.shots.forEach((shot, i) => {
    const t = (starts[i]! + shot.durationInFrames * 0.6) / plan.fps;
    runFfmpeg(tools, ['-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', join(dir, `${String(i + 1).padStart(3, '0')}-${shot.id}.jpg`)]);
  });
}

export interface QcRunOptions {
  stage?: 'final' | 'preview';
  review?: EditorialReview;
  stillsDir?: string;
}

export async function qcEpisode(tools: FfmpegTools, plan: ShotPlan, render: string | undefined, options: QcRunOptions = {}): Promise<QcReport> {
  const input: Parameters<typeof runQc>[0] = { plan, stage: options.stage ?? 'final', ...(options.review ? { review: options.review } : {}) };
  if (render) {
    input.probe = parseFfprobe(ffprobeJson(tools, render));
    Object.assign(input, await analysePictures(tools, render, plan.fps));
    input.audio = audioFrames(decodeMono(tools, render), 48000, plan.fps);
    input.loudness = measureLoudness(tools, render);
    if (options.stillsDir) saveStills(tools, render, plan, options.stillsDir);
  }
  return runQc(input);
}

/** A ShotPlan, or the editor brain's full output ({ plan }). */
export function readPlan(path: string): ShotPlan {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as ShotPlan & { plan?: ShotPlan };
  const plan = raw.shots ? raw : raw.plan;
  if (!plan?.shots) throw new Error(`${path}: not a ShotPlan`);
  return plan;
}
