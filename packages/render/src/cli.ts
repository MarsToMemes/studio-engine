/**
 * studio-render: the render side of the pipeline, for montage.py (subprocess).
 *
 *   studio-render render <plan.json> <out.mp4> [--engine=remotion|ffmpeg] [--fallback] [--scale=0.5]
 *                        [--public=<dir>] [--cache=<dir>] [--crf=18] [--no-master] [--browser=<chrome>] [--json]
 *       exit 0 rendered · 1 Remotion failed and the FFmpeg DRAFT was rendered (--fallback) · 2 error
 *   studio-render qc <plan.json> [render.mp4] [--stage=final|preview] [--review=review.json] [--frames-dir=<dir>] [--out=QC_REPORT.json] [--json]
 *       exit 0 pass · 1 a check failed · 2 unreadable input
 *   studio-render loudness <file> [--preset=master|voice] [--fix=<out>] [--json]
 *       exit 0 on target · 1 off target · 2 error
 *   studio-render cache [--cache=<dir>] [--prune=<GB>]     size of the cache; prune the least recently used files
 *
 * FFmpeg: --ffmpeg=<path> / $FFMPEG, else the one on the PATH, else Remotion's bundled one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatQcReport, judgeLoudness, LOUDNESS_TARGETS, loudnormSecondPass, type LoudnessTarget } from '@studio-engine/scene-engine';
import { renderEpisode } from './engine.js';
import { resolveFfmpeg, runFfmpeg } from './ffmpeg.js';
import { listCache, pruneCache } from './cache.js';
import { measureLoudness } from './master.js';
import { qcEpisode, readPlan } from './qc.js';
import type { RenderEvent } from './types.js';

export const RENDER_CLI_USAGE = [
  'usage: studio-render render <plan.json> <out.mp4> [--engine=remotion|ffmpeg] [--fallback] [--scale=<0-1>] [--public=<dir>] [--cache=<dir>] [--no-master] [--json]',
  '       studio-render qc <plan.json> [render.mp4] [--stage=final|preview] [--review=<review.json>] [--frames-dir=<dir>] [--out=<QC_REPORT.json>] [--json]',
  '       studio-render loudness <file> [--preset=master|voice] [--fix=<out>] [--json]',
  '       studio-render cache [--cache=<dir>] [--prune=<GB>]',
].join('\n');

const here = dirname(fileURLToPath(import.meta.url));
/** packages/remotion/public in the monorepo. */
export const defaultPublicDir = () => resolve(here, '..', '..', 'remotion', 'public');

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export async function runRenderCli(argv: readonly string[], io: CliIo): Promise<number> {
  const arg = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const flag = (name: string) => argv.includes(`--${name}`);
  const [command, ...positional] = argv.filter((a) => !a.startsWith('--'));
  const tools = resolveFfmpeg({ ...(arg('ffmpeg') ? { ffmpeg: arg('ffmpeg')! } : {}), ...(arg('ffprobe') ? { ffprobe: arg('ffprobe')! } : {}) });
  try {
    if (command === 'render' && positional.length === 2) {
      const [planPath, output] = positional as [string, string];
      const plan = readPlan(planPath);
      const progress = (e: RenderEvent) => {
        if (flag('json')) return;
        if (e.phase === 'chunk') io.stderr(`  ${e.cached ? 'cached ' : 'rendered'} ${e.index + 1}/${e.total} (${e.frames} frames${e.cached ? '' : `, ${(e.ms / 1000).toFixed(1)} s`})`);
        else io.stderr(`${e.phase}: ${e.message}`);
      };
      const engine = (arg('engine') ?? 'remotion') as 'remotion' | 'ffmpeg';
      const result = await renderEpisode(
        { plan, output, publicDir: resolve(arg('public') ?? defaultPublicDir()), cacheDir: resolve(arg('cache') ?? '.studio-cache'), ...(arg('scale') ? { scale: Number(arg('scale')) } : {}), master: !flag('no-master'), onProgress: progress },
        {
          engine,
          fallback: flag('fallback'),
          ...(arg('browser') ?? process.env.REMOTION_BROWSER ? { browserExecutable: arg('browser') ?? process.env.REMOTION_BROWSER! } : {}),
          ...(arg('crf') ? { crf: Number(arg('crf')) } : {}),
          ...(arg('concurrency') ? { concurrency: Number(arg('concurrency')) } : {}),
          ...(arg('ffmpeg') ? { ffmpeg: arg('ffmpeg')! } : {}),
        },
      );
      if (flag('json')) io.stdout(JSON.stringify(result, null, 2));
      else {
        const c = result.chunks;
        io.stdout(`${result.draft ? 'DRAFT ' : ''}${result.engine} → ${result.output}: ${result.durationInFrames} frames${c ? `, ${c.rendered} rendered / ${c.cached} from cache` : ''}, audio ${result.audio.strategy}${result.audio.cached ? ' (cache)' : ''}, ${(result.timingsMs.total! / 1000).toFixed(1)} s`);
        if (result.loudness) io.stdout(`loudness: ${result.loudness.after.integrated.toFixed(1)} LUFS, true peak ${result.loudness.after.truePeak.toFixed(1)} dBTP`);
        for (const n of result.notes) io.stdout(`note: ${n}`);
      }
      return result.draft && engine !== 'ffmpeg' ? 1 : 0;
    }

    if (command === 'qc' && positional.length >= 1) {
      const plan = readPlan(positional[0]!);
      const review = arg('review') ? JSON.parse(readFileSync(arg('review')!, 'utf8')) : undefined;
      const report = await qcEpisode(tools, plan, positional[1], { ...(arg('stage') ? { stage: arg('stage') as 'final' | 'preview' } : {}), ...(review ? { review } : {}), ...(arg('frames-dir') ? { stillsDir: arg('frames-dir')! } : {}) });
      const out = arg('out') ?? 'QC_REPORT.json';
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
      io.stdout(flag('json') ? JSON.stringify(report, null, 2) : `${formatQcReport(report)}\n\n→ ${out}`);
      return report.summary.pass ? 0 : 1;
    }

    if (command === 'cache') {
      const dir = resolve(arg('cache') ?? '.studio-cache');
      const gb = (b: number) => `${(b / 1e9).toFixed(2)} GB`;
      if (arg('prune') !== undefined) {
        const r = pruneCache(dir, Number(arg('prune')) * 1e9);
        io.stdout(`pruned ${r.removed} file(s), freed ${gb(r.freedBytes)}, kept ${gb(r.keptBytes)}`);
      }
      const entries = listCache(dir);
      const by = (k: string) => entries.filter((e) => e.kind === k);
      io.stdout(`${dir}: ${gb(entries.reduce((s, e) => s + e.bytes, 0))} (${['chunks', 'draft', 'decoded', 'mix'].map((k) => `${k} ${by(k).length}`).join(', ')})`);
      return 0;
    }

    if (command === 'loudness' && positional.length === 1) {
      const input = positional[0]!;
      const presetName = arg('preset') ?? 'master';
      const target = (LOUDNESS_TARGETS as Record<string, LoudnessTarget>)[presetName];
      if (!target) throw new Error(`unknown preset "${presetName}" (master, voice)`);
      const kind = presetName === 'voice' ? 'voice' : 'mix';
      const before = measureLoudness(tools, input, target);
      const report: Record<string, unknown> & { pass: boolean } = { file: input, preset: presetName, target, measure: before, ...judgeLoudness(before, target, kind) };
      const fix = arg('fix');
      let final = report as { pass: boolean };
      if (fix) {
        const audioOnly = ['.wav', '.flac', '.mp3', '.m4a', '.aac'].includes(extname(fix).toLowerCase());
        const codec = extname(fix).toLowerCase() === '.wav' ? ['-c:a', 'pcm_s24le'] : ['-c:a', 'aac', '-b:a', '320k'];
        runFfmpeg(tools, ['-y', '-i', input, ...(audioOnly ? ['-vn'] : ['-c:v', 'copy']), '-af', loudnormSecondPass(before, target), '-ar', '48000', ...codec, fix]);
        const after = measureLoudness(tools, fix, target);
        final = { file: fix, measure: after, ...judgeLoudness(after, target, kind) } as { pass: boolean };
        report.fixed = final;
      }
      if (flag('json')) io.stdout(JSON.stringify(report, null, 2));
      else {
        const line = (r: Record<string, unknown>) => {
          const m = r.measure as { integrated: number; truePeak: number; lra: number };
          const issues = r.issues as Array<{ rule: string; message: string }>;
          return `${r.file}: ${m.integrated.toFixed(1)} LUFS · true peak ${m.truePeak.toFixed(1)} dBTP · LRA ${m.lra.toFixed(1)} LU → ${r.pass ? 'OK' : issues.map((i) => `[${i.rule}] ${i.message}`).join('; ')}`;
        };
        io.stdout(line(report));
        if (report.fixed) io.stdout(line(report.fixed as Record<string, unknown>));
        else if (!report.pass) io.stdout(`  apply ${(report.gainToTargetDb as number) > 0 ? '+' : ''}${report.gainToTargetDb} dB, or rerun with --fix=<out>`);
      }
      return final.pass ? 0 : 1;
    }
  } catch (e) {
    io.stderr(String((e as Error).message ?? e));
    return 2;
  }
  io.stderr(RENDER_CLI_USAGE);
  return 2;
}
