// Measures (and optionally normalises) the loudness of a rendered video or an audio file.
//   node scripts/loudness.mjs out/episode.mp4                      → report, exit 1 if off target (MUS-09)
//   node scripts/loudness.mjs out/episode.mp4 --fix=out/final.mp4  → two-pass loudnorm, video stream copied
//   node scripts/loudness.mjs voice.wav --preset=voice             → the voice alone, -16 LUFS (MUS-01)
//   --json                 machine-readable report on stdout
//   --ffmpeg=/path/ffmpeg  FFmpeg to use (default: `ffmpeg` on PATH, else Remotion's bundled one)
import { spawnSync } from 'node:child_process';
import { extname } from 'node:path';
import { judgeLoudness, LOUDNESS_TARGETS, loudnormSecondPass, parseLoudnorm } from '@studio-engine/scene-engine';

const args = process.argv.slice(2);
const arg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('usage: loudness.mjs <file> [--preset=master|voice] [--fix=<out>] [--json] [--ffmpeg=<path>]');
  process.exit(2);
}
const presetName = arg('preset') ?? 'master';
const target = LOUDNESS_TARGETS[presetName];
if (!target) {
  console.error(`unknown preset "${presetName}" (master, voice)`);
  process.exit(2);
}
const kind = presetName === 'voice' ? 'voice' : 'mix';

function ffmpegCommand() {
  const explicit = arg('ffmpeg') ?? process.env.FFMPEG;
  if (explicit) return [explicit];
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) return ['ffmpeg'];
  return ['npx', 'remotion', 'ffmpeg'];
}
const [bin, ...pre] = ffmpegCommand();
const ffmpeg = (a) => {
  const r = spawnSync(bin, [...pre, '-hide_banner', '-nostats', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed:\n${r.stderr.slice(-2000)}`);
  return r.stderr;
};
const measure = (file) => parseLoudnorm(ffmpeg(['-i', file, '-vn', '-af', `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.lra}:print_format=json`, '-f', 'null', '-']));

try {
  const before = measure(input);
  const report = { file: input, preset: presetName, target, measure: before, ...judgeLoudness(before, target, kind) };
  const fix = arg('fix');
  if (fix) {
    const audioOnly = ['.wav', '.flac', '.mp3', '.m4a', '.aac'].includes(extname(fix).toLowerCase());
    const codec = extname(fix).toLowerCase() === '.wav' ? ['-c:a', 'pcm_s24le'] : ['-c:a', 'aac', '-b:a', '320k'];
    ffmpeg(['-y', '-i', input, ...(audioOnly ? ['-vn'] : ['-c:v', 'copy']), '-af', loudnormSecondPass(before, target), '-ar', '48000', ...codec, fix]);
    const after = measure(fix);
    Object.assign(report, { fixed: { file: fix, measure: after, ...judgeLoudness(after, target, kind) } });
  }
  const final = report.fixed ?? report;
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    const line = (label, r) => `${label}: ${r.measure.integrated.toFixed(1)} LUFS · true peak ${r.measure.truePeak.toFixed(1)} dBTP · LRA ${r.measure.lra.toFixed(1)} LU → ${r.pass ? 'OK' : r.issues.map((i) => `[${i.rule}] ${i.message}`).join('; ')}`;
    console.log(line(input, report));
    if (report.fixed) console.log(line(report.fixed.file, report.fixed));
    else if (!report.pass) console.log(`  apply ${report.gainToTargetDb > 0 ? '+' : ''}${report.gainToTargetDb} dB, or rerun with --fix=<out>`);
  }
  process.exit(final.pass ? 0 : 1);
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(2);
}
