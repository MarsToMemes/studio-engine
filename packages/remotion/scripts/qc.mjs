// Quality control of an episode before publishing → QC_REPORT.json (each check cites its bible rule).
//   node scripts/qc.mjs plan.json                         plan only (validation, references, rights)
//   node scripts/qc.mjs plan.json out/episode.mp4         + format, black frames, frozen picture, voice, silences, gaps, clipping, loudness
//   --stage=final|preview    final (default): 1080p and blocking rules; preview: resolution not checked
//   --review=review.json     editorial review of the REVUE rules (editor-brain critique)
//   --frames-dir=dir         also save one still per shot (input of the AI critic)
//   --out=QC_REPORT.json     report path (default: QC_REPORT.json)      --json  print the report
// Exit code: 0 pass · 1 a check failed · 2 unreadable input.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioFrames, formatQcReport, frameDifference, frameStats, getShotStartFrames, parseFfprobe, parseLoudnorm, runQc } from '@studio-engine/scene-engine';
import { ffmpeg, ffmpegStream, ffprobeJson } from './ffmpeg.mjs';

const args = process.argv.slice(2);
const arg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const [planPath, renderPath] = args.filter((a) => !a.startsWith('--'));
if (!planPath) {
  console.error('usage: qc.mjs <plan.json> [render.mp4] [--stage=final|preview] [--review=review.json] [--frames-dir=dir] [--out=QC_REPORT.json] [--json]');
  process.exit(2);
}

const W = 96;
const H = 54;

/** Grayscale frames streamed from FFmpeg: stats, and the difference with the frame one second earlier. */
async function analysePictures(file, fps) {
  const size = W * H;
  const frames = [];
  const motion = [];
  const ring = [];
  let pending = Buffer.alloc(0);
  await ffmpegStream(['-i', file, '-an', '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-r', String(fps), '-f', 'image2pipe', '-c:v', 'rawvideo', '-'], (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= size) {
      const gray = new Uint8Array(pending.subarray(0, size));
      pending = pending.subarray(size);
      frames.push(frameStats(gray));
      ring.push(gray);
      if (ring.length > fps + 1) ring.shift();
      motion.push(ring.length > fps ? frameDifference(gray, ring[0]) : 1);
    }
  });
  return { frames, motion };
}

/** Mono 48 kHz samples of the mix (through a temporary WAV: every FFmpeg build writes WAV). */
function decodeAudio(file) {
  const dir = mkdtempSync(join(tmpdir(), 'qc-'));
  try {
    const wav = join(dir, 'mix.wav');
    ffmpeg(['-y', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
    const buf = readFileSync(wav);
    const data = buf.indexOf('data') + 8;
    const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + data, buf.byteOffset + buf.length - ((buf.length - data) % 2)));
    return Float32Array.from(pcm, (v) => v / 32768);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function saveStills(file, plan, dir) {
  mkdirSync(dir, { recursive: true });
  const starts = getShotStartFrames(plan);
  plan.shots.forEach((shot, i) => {
    const t = (starts[i] + shot.durationInFrames * 0.6) / plan.fps;
    ffmpeg(['-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', join(dir, `${String(i + 1).padStart(3, '0')}-${shot.id}.jpg`)]);
  });
}

try {
  const raw = JSON.parse(readFileSync(planPath, 'utf8'));
  const plan = raw.shots ? raw : raw.plan; // a ShotPlan, or the brain's full output
  if (!plan?.shots) throw new Error(`${planPath}: not a ShotPlan`);
  const input = { plan, stage: arg('stage') ?? 'final' };
  if (arg('review')) input.review = JSON.parse(readFileSync(arg('review'), 'utf8'));
  if (renderPath) {
    input.probe = parseFfprobe(ffprobeJson(renderPath));
    Object.assign(input, await analysePictures(renderPath, plan.fps));
    input.audio = audioFrames(decodeAudio(renderPath), 48000, plan.fps);
    input.loudness = parseLoudnorm(ffmpeg(['-i', renderPath, '-vn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-']));
    if (arg('frames-dir')) saveStills(renderPath, plan, arg('frames-dir'));
  }
  const report = runQc(input);
  const out = arg('out') ?? 'QC_REPORT.json';
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : `${formatQcReport(report)}\n\n→ ${out}`);
  process.exit(report.summary.pass ? 0 : 1);
} catch (e) {
  console.error(String(e?.message ?? e));
  process.exit(2);
}
