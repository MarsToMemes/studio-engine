/**
 * FFmpeg draft renderer: a fast, simplified version of the episode, for a
 * rough cut or when Remotion is not available. It is NOT for publishing:
 * no motion skills, no charts or maps (their words are shown instead), cuts
 * instead of transitions (fades kept), and a DRAFT mark on every frame.
 * Its sound is the real one (same mixer and master as the final render).
 *
 * It needs a full FFmpeg build (zoompan, drawtext): the one of the local
 * engine, not Remotion's minimal one.
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { DOCUMENTARY_THEME, getShotStartFrames, getShotPlanDuration, resolveShotTransitions, stableStringify, type Shot, type ShotPlan, type VideoProject } from '@studio-engine/scene-engine';
import { ffmpegFilters, resolveFfmpeg, runFfmpeg, type FfmpegTools } from './ffmpeg.js';
import { touch } from './cache.js';
import { assetFingerprint, assetLocation, sha256 } from './files.js';
import { muxAndMaster } from './master.js';
import { mixAudio, mixKey } from './mixer.js';
import { compileRequest } from './remotion-renderer.js';
import type { RenderEngine, RenderRequest, RenderResult } from './types.js';

const require = createRequire(import.meta.url);
const hex = (c: string) => `0x${c.replace('#', '')}`;

/** Inter from @fontsource (the render's font), as files FreeType reads. */
export function draftFonts(): { bold: string; regular: string } {
  const dir = join(dirname(require.resolve('@fontsource/inter/package.json')), 'files');
  return { bold: join(dir, 'inter-latin-800-normal.woff'), regular: join(dir, 'inter-latin-500-normal.woff') };
}

/** Greedy word wrap. */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export interface DraftText {
  text: string;
  /** Font size in px at the output size. */
  size: number;
  color: string;
  /** Vertical centre, 0..1 of the height. */
  y: number;
  bold?: boolean;
  /** Seconds, relative to the segment (captions). */
  from?: number;
  to?: number;
  box?: boolean;
}

/** What a draft segment shows: a picture source and text lines. */
export interface DraftSegment {
  kind: 'image' | 'video' | 'document' | 'card';
  media?: string;
  texts: DraftText[];
  zoom: 'in' | 'out' | 'none';
  fadeIn: boolean;
}

const format = (n: NonNullable<Shot['number']>) => `${n.prefix ?? ''}${n.decimals !== undefined ? n.value.toFixed(n.decimals) : n.value}${n.suffix ?? ''}`;

interface Block {
  text: string;
  size: number;
  color: string;
  bold?: boolean;
  maxChars?: number;
}

/** Blocks of text stacked around a vertical centre (0..1), wrapped, never overlapping. */
export function stackTexts(blocks: Block[], centre: number, height: number): DraftText[] {
  const lines = blocks.flatMap((b, bi) => wrapText(b.text, b.maxChars ?? 24).map((text) => ({ ...b, text, bi })));
  const gap = (i: number) => (i > 0 && lines[i]!.bi !== lines[i - 1]!.bi ? 0.6 : 0.2);
  const heights = lines.map((l, i) => l.size * (1 + gap(i)));
  const total = heights.reduce((a, h) => a + h, 0);
  let y = centre * height - total / 2;
  return lines.map((l, i) => {
    y += heights[i]! - l.size / 2;
    const out: DraftText = { text: l.text, size: l.size, color: l.color, y: y / height, bold: l.bold !== false };
    y += l.size / 2;
    return out;
  });
}

/** The draft version of a shot (pure: tested without FFmpeg). */
export function draftSegment(shot: Shot, height: number, fadeIn: boolean): DraftSegment {
  const T = DOCUMENTARY_THEME;
  const big = Math.round(height * 0.075);
  const small = Math.round(height * 0.028);
  const stack = (blocks: Block[]) => stackTexts(blocks.filter((b) => b.text), 0.5, height);
  const zoom: DraftSegment['zoom'] = shot.camera === 'pull_out' ? 'out' : shot.camera === 'static' ? 'none' : 'in';
  if (shot.block) {
    // HyperFrames pages need a browser: the draft names the block and its title.
    const title = shot.block.variables?.title ?? shot.block.variables?.headline ?? shot.text ?? '';
    return { kind: 'card', texts: stack([{ text: `HYPERFRAMES · ${shot.block.item}`.toUpperCase(), size: small, color: T.accent, maxChars: 60 }, { text: String(title).toUpperCase(), size: big, color: '#FFFFFF' }]), zoom: 'none', fadeIn };
  }
  switch (shot.type) {
    case 'image':
      return { kind: 'image', media: shot.media!, texts: [], zoom, fadeIn };
    case 'video':
      return { kind: 'video', media: shot.media!, texts: [], zoom: 'none', fadeIn };
    case 'document':
      return { kind: 'document', media: shot.media!, texts: shot.document?.source ? [{ text: `Source: ${shot.document.source}`, size: Math.round(height * 0.022), color: '#FFFFFF', y: 0.97, bold: false }] : [], zoom: 'none', fadeIn };
    case 'number': {
      const n = shot.number!;
      return { kind: 'card', texts: stack([{ text: format(n), size: Math.round(height * 0.2), color: T.accent }, { text: (n.label ?? '').toUpperCase(), size: small, color: '#FFFFFF', bold: false, maxChars: 50 }]), zoom: 'none', fadeIn };
    }
    case 'chapter':
      return { kind: 'card', texts: stack([{ text: (shot.subtext ?? '').toUpperCase(), size: small, color: T.accent, maxChars: 60 }, { text: (shot.text ?? '').toUpperCase(), size: big, color: '#FFFFFF' }]), zoom: 'none', fadeIn };
    case 'chart': {
      const c = shot.chart!;
      const data = c.labels.map((l, i) => `${l}: ${c.values[i] ?? ''}${c.unit ? ` ${c.unit}` : ''}`).join('   ');
      return { kind: 'card', texts: stack([{ text: (c.title ?? 'Chart').toUpperCase(), size: big, color: '#FFFFFF' }, { text: data, size: Math.round(height * 0.035), color: T.accent, bold: false, maxChars: 60 }]), zoom: 'none', fadeIn };
    }
    case 'map': {
      const places = (shot.map?.markers ?? []).map((m) => m.label).filter(Boolean).join(' · ');
      return { kind: 'card', texts: stack([{ text: 'MAP', size: small, color: T.accent }, { text: places || 'map', size: big, color: '#FFFFFF', maxChars: 30 }]), zoom: 'none', fadeIn };
    }
    default:
      // text, revelation
      return { kind: 'card', texts: stack([{ text: (shot.text ?? '').toUpperCase(), size: big, color: '#FFFFFF' }]), zoom: 'none', fadeIn };
  }
}

export interface FfmpegRendererOptions {
  ffmpeg?: string;
  ffprobe?: string;
}

export class FfmpegRenderer implements RenderEngine {
  readonly id = 'ffmpeg' as const;
  private readonly tools: FfmpegTools;

  constructor(options: FfmpegRendererOptions = {}) {
    this.tools = resolveFfmpeg(options);
  }

  check() {
    const filters = ffmpegFilters(this.tools);
    const missing = ['zoompan', 'drawtext', 'scale', 'fade'].filter((f) => !filters.has(f));
    return missing.length ? { ok: false, reason: `the FFmpeg draft needs a full FFmpeg build (missing: ${missing.join(', ')}); install ffmpeg or pass --ffmpeg=<path>` } : { ok: true };
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const t0 = Date.now();
    const timings: Record<string, number> = {};
    const notes = ['DRAFT: no motion skills, charts or maps; cuts instead of transitions. Not for publishing.'];
    const emit = request.onProgress ?? (() => {});
    const check = this.check();
    if (!check.ok) throw new Error(check.reason);
    const plan: ShotPlan = request.plan;
    const project: VideoProject = compileRequest(request);
    const cacheDir = resolve(request.cacheDir ?? '.studio-cache');
    const segDir = join(cacheDir, 'draft');
    const work = join(cacheDir, 'work', `draft-${process.pid}`);
    mkdirSync(segDir, { recursive: true });
    mkdirSync(work, { recursive: true });
    const scale = request.scale ?? 1;
    const W = Math.round((plan.width * scale) / 2) * 2;
    const H = Math.round((plan.height * scale) / 2) * 2;
    const fps = plan.fps;
    const starts = getShotStartFrames(plan);
    const total = getShotPlanDuration(plan);
    const transitions = resolveShotTransitions(plan);
    const fonts = draftFonts();
    const bg = hex(DOCUMENTARY_THEME.background);
    const files: string[] = [];
    let rendered = 0;
    let t = Date.now();

    for (const [i, shot] of plan.shots.entries()) {
      // Cuts at the shot starts: the overlaps of transitions are given to the incoming shot.
      const frames = (i + 1 < plan.shots.length ? starts[i + 1]! : total) - starts[i]!;
      if (frames <= 0) continue;
      const seconds = frames / fps;
      const seg = draftSegment(shot, H, transitions[i]!.id === 'fade');
      const scene = project.scenes[i];
      const captions: DraftText[] = (scene?.captions?.cues ?? []).map((c) => ({ text: c.text, size: Math.round(H * 0.045), color: '#FFFFFF', y: 0.86, bold: true, from: c.startFrame / fps, to: c.endFrame / fps, box: true }));
      const texts = [...seg.texts, ...captions];
      const asset = seg.media ? project.assets[seg.media] : undefined;
      const key = sha256(stableStringify({ v: 1, seg, captions, frames, W, H, fps, asset: asset ? [asset.src, assetFingerprint(asset, request.publicDir)] : null })).slice(0, 32);
      const file = join(segDir, `${key}.mp4`);
      const c0 = Date.now();
      const cached = existsSync(file);
      if (cached) touch(file);
      else {
        const inputs: string[] = [];
        let base: string;
        if (seg.kind === 'card' || !asset) {
          inputs.push('-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:r=${fps}:d=${seconds.toFixed(3)}`);
          base = 'null';
        } else {
          const loc = assetLocation(asset, request.publicDir);
          const src = loc.url ?? loc.path!;
          if (seg.kind === 'video') {
            inputs.push('-stream_loop', '-1', '-t', seconds.toFixed(3), '-i', src);
            base = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps}`;
          } else if (seg.kind === 'document') {
            inputs.push('-loop', '1', '-framerate', String(fps), '-t', seconds.toFixed(3), '-i', src);
            base = `scale=${W}:${Math.round(H * 0.9)}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg}`;
          } else {
            inputs.push('-loop', '1', '-framerate', String(fps), '-t', seconds.toFixed(3), '-i', src);
            // Slow push (or pull) of 6 %, on a 2× picture so the move is smooth.
            const z = seg.zoom === 'none' ? '1' : seg.zoom === 'in' ? `1+0.06*on/${frames}` : `1.06-0.06*on/${frames}`;
            base = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps}`;
          }
        }
        // Text through files: no escaping of the words.
        const draws = texts.map((d, k) => {
          const tf = join(work, `${key}-${k}.txt`);
          writeFileSync(tf, d.text);
          const enable = d.from !== undefined ? `:enable='between(t,${d.from.toFixed(3)},${d.to!.toFixed(3)})'` : '';
          const box = d.box ? `:box=1:boxcolor=black@0.55:boxborderw=${Math.round(d.size * 0.35)}` : '';
          return `drawtext=fontfile='${d.bold === false ? fonts.regular : fonts.bold}':textfile='${tf}':expansion=none:fontsize=${d.size}:fontcolor=${hex(d.color)}:x=(w-tw)/2:y=h*${d.y.toFixed(4)}-th/2${box}${enable}`;
        });
        const mark = `drawtext=fontfile='${fonts.bold}':text='DRAFT · FFmpeg':fontsize=${Math.round(H * 0.022)}:fontcolor=white@0.7:x=w-tw-${Math.round(W * 0.02)}:y=${Math.round(H * 0.03)}`;
        const fade = seg.fadeIn ? [`fade=t=in:st=0:d=${Math.min(0.4, seconds / 2).toFixed(3)}`] : [];
        const chain = [base, ...draws, mark, ...fade, 'format=yuv420p'].filter((f) => f !== 'null').join(',');
        const tmp = join(segDir, `${key}.tmp.mp4`);
        runFfmpeg(this.tools, ['-y', ...inputs, '-vf', chain, '-frames:v', String(frames), '-r', String(fps), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', tmp]);
        renameSync(tmp, file);
        rendered++;
      }
      files.push(file);
      emit({ phase: 'chunk', index: i, total: plan.shots.length, cached, frames, ms: Date.now() - c0 });
    }
    timings.segments = Date.now() - t;

    emit({ phase: 'concat', message: `joining ${files.length} segments` });
    t = Date.now();
    const list = join(work, 'concat.txt');
    writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const video = join(work, 'video.mp4');
    runFfmpeg(this.tools, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
    timings.concat = Date.now() - t;

    emit({ phase: 'mix', message: 'mixing the audio' });
    t = Date.now();
    const mixDir = join(cacheDir, 'mix');
    mkdirSync(mixDir, { recursive: true });
    const mix = join(mixDir, `${mixKey(project, request.publicDir).slice(0, 32)}.wav`);
    const mixCached = existsSync(mix);
    if (mixCached) touch(mix);
    else mixAudio(project, mix, { publicDir: request.publicDir, cacheDir, tools: this.tools });
    timings.mix = Date.now() - t;

    emit({ phase: 'master', message: 'mastering' });
    t = Date.now();
    mkdirSync(dirname(resolve(request.output)), { recursive: true });
    const loudness = muxAndMaster(this.tools, video, mix, request.output, { master: request.master !== false });
    timings.master = Date.now() - t;
    rmSync(work, { recursive: true, force: true });
    if (!loudness) notes.push('the mix is silent: no loudness normalisation');
    timings.total = Date.now() - t0;
    return {
      engine: 'ffmpeg',
      output: request.output,
      draft: true,
      durationInFrames: total,
      chunks: { total: files.length, rendered, cached: files.length - rendered },
      audio: { strategy: 'mixer', cached: mixCached },
      ...(loudness ? { loudness } : {}),
      timingsMs: timings,
      notes,
    };
  }
}
