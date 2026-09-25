/**
 * Remotion, by chunks of a few scenes, with a cache: the pixels of a chunk
 * are rendered once and reused while nothing that affects them changes
 * (see `chunkKeyMaterial`). The chunks are joined without re-encoding, the
 * mix comes from the JS mixer, then the master.
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { openBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { chunkKeyMaterial, compileShotPlan, planRenderChunks, type VideoProject } from '@studio-engine/scene-engine';
import { ffprobeJson, resolveFfmpeg, runFfmpeg, type FfmpegTools } from './ffmpeg.js';
import { touch } from './cache.js';
import { assetFingerprint, bundleVersion, sha256 } from './files.js';
import { muxAndMaster } from './master.js';
import { hasUnmutedVideo, mixAudio, mixKey } from './mixer.js';
import type { RenderEngine, RenderRequest, RenderResult } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));

export interface RemotionRendererOptions {
  /** Remotion entry point. Default: the monorepo's packages/remotion/src/index.ts. */
  entryPoint?: string;
  /** Composition that renders any project from its props. Default `EngineDemo`. */
  compositionId?: string;
  /** Chrome / Chrome Headless Shell to use (else Remotion's own, downloaded on first use). */
  browserExecutable?: string;
  /** H.264 quality (lower = better). Default 18. */
  crf?: number;
  /** Frames rendered in parallel. Default: Remotion's choice. */
  concurrency?: number;
  /** Average scenes per chunk. Default 3. */
  groupSize?: number;
  ffmpeg?: string;
  ffprobe?: string;
}

export function defaultEntryPoint(): string {
  // dist/ or src/ → packages/render → packages/remotion/src/index.ts
  return resolve(here, '..', '..', 'remotion', 'src', 'index.ts');
}

export function compileRequest(request: RenderRequest): VideoProject {
  if (request.project) return request.project;
  const r = compileShotPlan(request.plan);
  if (!r.ok) throw new Error(`the plan does not compile:\n${r.errors.map((e) => `${e.path}: ${e.message}`).join('\n')}`);
  return r.project;
}

export class RemotionRenderer implements RenderEngine {
  readonly id = 'remotion' as const;
  private readonly tools: FfmpegTools;

  constructor(private readonly options: RemotionRendererOptions = {}) {
    this.tools = resolveFfmpeg(options);
  }

  check() {
    const entry = this.options.entryPoint ?? defaultEntryPoint();
    return existsSync(entry) ? { ok: true } : { ok: false, reason: `Remotion entry point not found: ${entry}` };
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const t0 = Date.now();
    const timings: Record<string, number> = {};
    const lap = (name: string, since: number) => (timings[name] = Date.now() - since);
    const notes: string[] = [];
    const emit = request.onProgress ?? (() => {});
    const cacheDir = resolve(request.cacheDir ?? '.studio-cache');
    const chunkDir = join(cacheDir, 'chunks');
    mkdirSync(chunkDir, { recursive: true });
    const project = compileRequest(request);
    const scale = request.scale ?? 1;
    const crf = this.options.crf ?? 18;

    emit({ phase: 'prepare', message: 'bundling the composition' });
    let t = Date.now();
    const serveUrl = await bundle({ entryPoint: this.options.entryPoint ?? defaultEntryPoint(), publicDir: request.publicDir });
    const rendererVersion = bundleVersion(serveUrl);
    const inputProps = { project };
    const browser = await openBrowser('chrome', this.options.browserExecutable ? { browserExecutable: this.options.browserExecutable } : {});
    lap('prepare', t);
    const chunks = planRenderChunks(project, this.options.groupSize ? { groupSize: this.options.groupSize } : {});
    const total = chunks.length ? chunks[chunks.length - 1]!.endFrame : 0;
    const settings = { codec: 'h264', crf, scale, pixelFormat: 'yuv420p' };
    let rendered = 0;
    const files: string[] = [];
    try {
      const composition = await selectComposition({ serveUrl, id: this.options.compositionId ?? 'EngineDemo', inputProps, puppeteerInstance: browser });
      if (composition.durationInFrames !== total) throw new Error(`the composition lasts ${composition.durationInFrames} frames, the chunks ${total}`);
      t = Date.now();
      for (const chunk of chunks) {
        const material = chunkKeyMaterial(project, chunk, {
          rendererVersion,
          settings,
          assetFingerprint: (id) => assetFingerprint(project.assets[id], request.publicDir),
        });
        // First and last chunks also carry the edge transitions of the video.
        const key = sha256(`${material}|first:${chunk.index === 0}|last:${chunk.endFrame === total}`).slice(0, 32);
        const file = join(chunkDir, `${key}.mp4`);
        const frames = chunk.endFrame - chunk.startFrame;
        const c0 = Date.now();
        const cached = existsSync(file);
        if (cached) touch(file);
        else {
          const tmp = join(chunkDir, `${key}.tmp.mp4`);
          await renderMedia({
            composition,
            serveUrl,
            inputProps,
            codec: 'h264',
            crf,
            scale,
            muted: true,
            frameRange: [chunk.startFrame, chunk.endFrame - 1],
            outputLocation: tmp,
            puppeteerInstance: browser,
            logLevel: 'error',
            ...(this.options.concurrency ? { concurrency: this.options.concurrency } : {}),
          });
          renameSync(tmp, file);
          rendered++;
        }
        files.push(file);
        emit({ phase: 'chunk', index: chunk.index, total: chunks.length, cached, frames, ms: Date.now() - c0 });
      }
      lap('chunks', t);
    } finally {
      await browser.close({ silent: true });
    }

    // Join the chunks without re-encoding.
    emit({ phase: 'concat', message: `joining ${files.length} chunks` });
    t = Date.now();
    const work = join(cacheDir, 'work');
    mkdirSync(work, { recursive: true });
    const list = join(work, `concat-${process.pid}.txt`);
    writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const video = join(work, `video-${process.pid}.mp4`);
    runFfmpeg(this.tools, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
    const probe = JSON.parse(ffprobeJson(this.tools, video)) as { streams: Array<{ codec_type: string; nb_frames?: string }> };
    const joined = Number(probe.streams.find((s) => s.codec_type === 'video')?.nb_frames ?? NaN);
    if (joined !== total) notes.push(`the joined video has ${joined} frames, the plan ${total}`);
    lap('concat', t);

    // Sound: the JS mixer (cached), or Remotion when a video layer plays its own sound.
    emit({ phase: 'mix', message: 'mixing the audio' });
    t = Date.now();
    let audio: RenderResult['audio'];
    let mix: string;
    if (hasUnmutedVideo(project)) {
      notes.push('a video layer plays its own sound: the audio is rendered by Remotion (not cached)');
      mix = join(work, `mix-${process.pid}.wav`);
      const b2 = await openBrowser('chrome', this.options.browserExecutable ? { browserExecutable: this.options.browserExecutable } : {});
      try {
        const composition = await selectComposition({ serveUrl, id: this.options.compositionId ?? 'EngineDemo', inputProps, puppeteerInstance: b2 });
        await renderMedia({ composition, serveUrl, inputProps, codec: 'wav', outputLocation: mix, puppeteerInstance: b2, logLevel: 'error' });
      } finally {
        await b2.close({ silent: true });
      }
      audio = { strategy: 'remotion', cached: false };
    } else {
      const mixDir = join(cacheDir, 'mix');
      mkdirSync(mixDir, { recursive: true });
      mix = join(mixDir, `${mixKey(project, request.publicDir).slice(0, 32)}.wav`);
      const cached = existsSync(mix);
      if (cached) touch(mix);
      else mixAudio(project, mix, { publicDir: request.publicDir, cacheDir, tools: this.tools });
      audio = { strategy: 'mixer', cached };
    }
    lap('mix', t);

    emit({ phase: 'master', message: request.master === false ? 'muxing' : 'mastering to -14 LUFS' });
    t = Date.now();
    mkdirSync(dirname(resolve(request.output)), { recursive: true });
    const loudness = muxAndMaster(this.tools, video, mix, request.output, { master: request.master !== false });
    lap('master', t);
    rmSync(list, { force: true });
    rmSync(video, { force: true });
    if (audio.strategy === 'remotion') rmSync(mix, { force: true });
    if (!loudness) notes.push('the mix is silent: no loudness normalisation');
    timings.total = Date.now() - t0;
    return {
      engine: 'remotion',
      output: request.output,
      draft: false,
      durationInFrames: total,
      chunks: { total: chunks.length, rendered, cached: chunks.length - rendered },
      audio,
      ...(loudness ? { loudness } : {}),
      timingsMs: timings,
      notes,
    };
  }
}
