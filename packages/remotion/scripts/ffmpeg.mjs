// FFmpeg / ffprobe for the scripts: --ffmpeg=<path> or $FFMPEG, else the one on the PATH, else Remotion's bundled one.
// (Remotion's build is minimal: loudnorm, rawvideo and wav are there; ebur128 and blackdetect are not.)
import { spawn, spawnSync } from 'node:child_process';

const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

function resolve(tool) {
  const explicit = tool === 'ffmpeg' ? flag('ffmpeg') ?? process.env.FFMPEG : flag('ffprobe') ?? process.env.FFPROBE;
  if (explicit) return [explicit];
  if (spawnSync(tool, ['-version'], { stdio: 'ignore' }).status === 0) return [tool];
  return ['npx', 'remotion', tool];
}
const FFMPEG = resolve('ffmpeg');
const FFPROBE = resolve('ffprobe');

/** Runs FFmpeg and returns stderr (where FFmpeg reports); throws with the end of stderr on failure. */
export function ffmpeg(args) {
  const [bin, ...pre] = FFMPEG;
  const r = spawnSync(bin, [...pre, '-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed:\n${(r.stderr ?? '').slice(-2000)}`);
  return r.stderr;
}

/** Runs FFmpeg with stdout streamed to `onData(chunk)`; resolves when it exits. */
export function ffmpegStream(args, onData) {
  const [bin, ...pre] = FFMPEG;
  return new Promise((resolvePromise, reject) => {
    const p = spawn(bin, [...pre, '-hide_banner', '-nostats', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', onData);
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg failed:\n${err.slice(-2000)}`))));
  });
}

export function ffprobeJson(file) {
  const [bin, ...pre] = FFPROBE;
  const r = spawnSync(bin, [...pre, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`ffprobe failed:\n${(r.stderr ?? '').slice(-1000)}`);
  return r.stdout;
}
