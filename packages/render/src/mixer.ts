/**
 * The audio mix, computed in JavaScript from the same plan and the same
 * volume envelopes (`audioVolumeAt`: fades, ducking, music cues, silences)
 * as the Remotion preview. The final mix is exactly what the preview plays,
 * it does not need the browser, and it is cached.
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { audioVolumeAt, buildRemotionPlan, stableStringify, type RemotionAudioItem, type VideoProject } from '@studio-engine/scene-engine';
import { runFfmpeg, type FfmpegTools } from './ffmpeg.js';
import { touch } from './cache.js';
import { assetFingerprint, assetLocation, sha256 } from './files.js';
import { createWavWriter, readWav, type Pcm } from './wav.js';

export const MIX_SAMPLE_RATE = 48_000;
const CHANNELS = 2;

/** Layers whose own sound Remotion would play (the mixer does not): then the audio is rendered by Remotion. */
export function hasUnmutedVideo(project: VideoProject): boolean {
  return project.scenes.some((s) => s.layers.some((l) => l.type === 'video' && !l.muted && (l.volume ?? 1) > 0));
}

export interface MixOptions {
  publicDir: string;
  cacheDir: string;
  tools: FfmpegTools;
}

/** Cache key of the mix: the audio plan and the content of every source. */
export function mixKey(project: VideoProject, publicDir: string): string {
  const plan = buildRemotionPlan(project);
  return sha256(stableStringify({ v: 1, fps: project.fps, duration: plan.composition.durationInFrames, audio: plan.audio, sources: plan.audio.map((a) => assetFingerprint(project.assets[a.assetId], publicDir)) }));
}

/** Decodes a source to 48 kHz stereo 16-bit WAV, once (cached by content). */
function decode(project: VideoProject, item: RemotionAudioItem, options: MixOptions): Pcm {
  const asset = project.assets[item.assetId]!;
  const loc = assetLocation(asset, options.publicDir);
  const input = loc.url ?? loc.path!;
  if (loc.path && !existsSync(loc.path)) throw new Error(`audio "${item.assetId}": file not found (${loc.path})`);
  const dir = join(options.cacheDir, 'decoded');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${sha256(`${input}|${assetFingerprint(asset, options.publicDir)}`).slice(0, 24)}.wav`);
  if (existsSync(out)) touch(out);
  else {
    runFfmpeg(options.tools, ['-y', '-i', input, '-vn', '-ac', String(CHANNELS), '-ar', String(MIX_SAMPLE_RATE), '-c:a', 'pcm_s16le', `${out}.tmp.wav`]);
    renameSync(`${out}.tmp.wav`, out);
  }
  return readWav(out);
}

/**
 * Mixes every audio item of the project into a WAV (48 kHz stereo). The gain
 * is applied per video frame, as Remotion does. Returns the file path.
 */
export function mixAudio(project: VideoProject, output: string, options: MixOptions): { path: string; items: number } {
  const plan = buildRemotionPlan(project);
  const fps = project.fps;
  const total = plan.composition.durationInFrames;
  const perFrame = MIX_SAMPLE_RATE / fps;
  const items = plan.audio.filter((a) => !a.muted && a.durationInFrames > 0);
  const sources = new Map<string, Pcm>();
  for (const a of items) if (!sources.has(a.assetId)) sources.set(a.assetId, decode(project, a, options));

  const writer = createWavWriter(`${output}.tmp.wav`, MIX_SAMPLE_RATE, CHANNELS);
  const blockFrames = fps * 5;
  for (let f0 = 0; f0 < total; f0 += blockFrames) {
    const f1 = Math.min(total, f0 + blockFrames);
    const s0 = Math.round(f0 * perFrame);
    const s1 = Math.round(f1 * perFrame);
    const block = new Float32Array((s1 - s0) * CHANNELS);
    for (const a of items) {
      const lo = Math.max(f0, a.from);
      const hi = Math.min(f1, a.from + a.durationInFrames);
      if (hi <= lo) continue;
      const src = sources.get(a.assetId)!;
      const srcFrames = src.samples.length / src.channels;
      const start = Math.round((a.startFrom / fps) * MIX_SAMPLE_RATE);
      const end = a.endAt !== undefined ? Math.min(srcFrames, Math.round((a.endAt / fps) * MIX_SAMPLE_RATE)) : srcFrames;
      const span = Math.max(1, end - start);
      const itemStart = a.from * perFrame;
      // One gain per video frame, as Remotion applies it: a silence is silent to its last frame.
      const k0 = lo - a.from;
      const gains = Float32Array.from({ length: hi - lo }, (_, j) => audioVolumeAt(a, k0 + j));
      for (let s = Math.round(lo * perFrame); s < Math.round(hi * perFrame); s++) {
        const local = s - itemStart; // samples since the item started
        const j = Math.min(gains.length - 1, Math.max(0, Math.floor(local / perFrame) - k0));
        const g = gains[j]!;
        if (g <= 0) continue;
        let pos = local * a.playbackRate;
        if (a.loop) pos %= span;
        else if (pos >= span) continue;
        const i = start + Math.floor(pos);
        const o = (s - s0) * CHANNELS;
        for (let c = 0; c < CHANNELS; c++) block[o + c] = block[o + c]! + (src.samples[i * src.channels + Math.min(c, src.channels - 1)]! / 32768) * g;
      }
    }
    writer.write(block);
  }
  writer.close();
  renameSync(`${output}.tmp.wav`, output);
  return { path: output, items: items.length };
}
