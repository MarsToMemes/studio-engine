/**
 * FFmpeg and ffprobe: `options.ffmpeg` / $FFMPEG, else the one on the PATH,
 * else Remotion's bundled build (minimal: enough for mixing, concat, loudness
 * and QC; the FFmpeg draft renderer needs a full build: zoompan, drawtext).
 */
import { spawn, spawnSync } from 'node:child_process';

export interface FfmpegTools {
  ffmpeg: string[];
  ffprobe: string[];
}

function resolveTool(tool: 'ffmpeg' | 'ffprobe', explicit?: string): string[] {
  if (explicit) return [explicit];
  const env = tool === 'ffmpeg' ? process.env.FFMPEG : process.env.FFPROBE;
  if (env) return [env];
  if (spawnSync(tool, ['-version'], { stdio: 'ignore' }).status === 0) return [tool];
  return ['npx', 'remotion', tool];
}

export function resolveFfmpeg(options: { ffmpeg?: string; ffprobe?: string } = {}): FfmpegTools {
  return { ffmpeg: resolveTool('ffmpeg', options.ffmpeg), ffprobe: resolveTool('ffprobe', options.ffprobe) };
}

/** Runs FFmpeg; returns stderr (where it reports). Throws with the end of stderr on failure. */
export function runFfmpeg(tools: FfmpegTools, args: string[]): string {
  const [bin, ...pre] = tools.ffmpeg;
  const r = spawnSync(bin!, [...pre, '-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 27 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${args.slice(-1)[0]}):\n${(r.stderr ?? String(r.error ?? '')).slice(-2500)}`);
  return r.stderr;
}

/** FFmpeg with stdout streamed to `onData`. */
export function streamFfmpeg(tools: FfmpegTools, args: string[], onData: (chunk: Buffer) => void): Promise<void> {
  const [bin, ...pre] = tools.ffmpeg;
  return new Promise((resolve, reject) => {
    const p = spawn(bin!, [...pre, '-hide_banner', '-nostats', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', onData);
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed:\n${err.slice(-2500)}`))));
  });
}

export function ffprobeJson(tools: FfmpegTools, file: string): string {
  const [bin, ...pre] = tools.ffprobe;
  const r = spawnSync(bin!, [...pre, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}:\n${(r.stderr ?? '').slice(-1000)}`);
  return r.stdout;
}

/** Filters the FFmpeg build has (to tell a full build from a minimal one). */
export function ffmpegFilters(tools: FfmpegTools): Set<string> {
  const [bin, ...pre] = tools.ffmpeg;
  const r = spawnSync(bin!, [...pre, '-hide_banner', '-filters'], { encoding: 'utf8', maxBuffer: 1 << 22 });
  return new Set((r.stdout ?? '').split('\n').map((l) => l.trim().split(/\s+/)[1]).filter((x): x is string => Boolean(x)));
}
