// Generates small, license-free test assets into public/ so the example renders offline.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMapLibreWorker } from './maplibre-worker.mjs';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(pub, { recursive: true });
ensureMapLibreWorker();

// --- PNG: warm gradient "landscape" with a sun --------------------------------
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(join(pub, 'landscape.png'), png(1280, 720, (x, y) => {
  const t = y / 720;
  const sun = Math.hypot(x - 900, y - 300) < 90;
  const ground = y > 480 + 30 * Math.sin(x / 90);
  if (sun) return [255, 214, 90];
  if (ground) return [40 + (x % 64 < 32 ? 10 : 0), 30, 50];
  return [Math.round(250 - 120 * t), Math.round(120 + 40 * t), Math.round(80 + 120 * t)];
}));

// --- WAV helpers ----------------------------------------------------------------
function wav(seconds, sample) {
  const rate = 44100, n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-1, Math.min(1, sample(i / rate))) * 32767 | 0, 44 + i * 2);
  return buf;
}
// "Narration": syllable-like tone bursts, 40 s.
writeFileSync(join(pub, 'narration.wav'), wav(40, (t) => {
  const syl = (t * 4) % 1;
  const env = syl < 0.7 ? Math.sin((Math.PI * syl) / 0.7) : 0;
  const f = 180 + 60 * Math.sin(t * 1.3);
  return 0.35 * env * Math.sin(2 * Math.PI * f * t);
}));
// Music bed: soft chord, 30 s.
writeFileSync(join(pub, 'music.wav'), wav(30, (t) => 0.12 * ([220, 277.18, 329.63].reduce((a, f) => a + Math.sin(2 * Math.PI * f * t), 0) / 3) * (0.8 + 0.2 * Math.sin(t))));

// --- Document page: white portrait page with grey "text lines" --------------------
writeFileSync(join(pub, 'report.png'), png(1000, 1400, (x, y) => {
  const margin = x < 90 || x > 910 || y < 110 || y > 1300;
  const line = !margin && (y - 110) % 42 < 14 && x < 910 - ((Math.floor((y - 110) / 42) * 97) % 260);
  const title = y > 110 && y < 170 && x > 90 && x < 640;
  if (title) return [30, 30, 30];
  return line ? [150, 150, 150] : [252, 252, 250];
}));

// --- SFX: short synthetic impact and glitch ----------------------------------------
mkdirSync(join(pub, 'sfx'), { recursive: true });
writeFileSync(join(pub, 'sfx', 'impact.wav'), wav(0.8, (t) => 0.9 * Math.exp(-t * 9) * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-t * 20)) * t)));
writeFileSync(join(pub, 'sfx', 'glitch.wav'), wav(0.5, (t) => {
  const step = Math.floor(t * 60);
  const noise = Math.sin(step * 12.9898) * 43758.5453;
  return 0.5 * Math.exp(-t * 4) * ((noise - Math.floor(noise)) * 2 - 1) * (step % 3 === 0 ? 1 : 0.3);
}));

// --- Lottie: pulsing yellow circle ------------------------------------------------
const kf = (t, s) => ({ t, s, i: { x: [0.5, 0.5, 0.5], y: [1, 1, 1] }, o: { x: [0.5, 0.5, 0.5], y: [0, 0, 0] } });
writeFileSync(join(pub, 'pulse.json'), JSON.stringify({
  v: '5.7.4', fr: 30, ip: 0, op: 60, w: 200, h: 200, nm: 'pulse', ddd: 0, assets: [],
  layers: [{
    ddd: 0, ind: 1, ty: 4, nm: 'circle', sr: 1, ao: 0, ip: 0, op: 60, st: 0, bm: 0,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [100, 100, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 1, k: [kf(0, [60, 60, 100]), kf(30, [100, 100, 100]), { t: 60, s: [60, 60, 100] }] } },
    shapes: [{ ty: 'gr', nm: 'g', it: [
      { ty: 'el', d: 1, nm: 'e', s: { a: 0, k: [140, 140] }, p: { a: 0, k: [0, 0] } },
      { ty: 'fl', nm: 'f', c: { a: 0, k: [1, 0.83, 0, 1] }, o: { a: 0, k: 100 }, r: 1 },
      { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } },
    ] }],
  }],
}));

// --- Video: moving test pattern. Remotion's bundled ffmpeg is minimal (no lavfi,
// no rawvideo demuxer) but reads piped PNGs, so frames are encoded as PNG first.
{
  const W = 640, H = 360, FRAMES = 180;
  const pngs = [];
  for (let f = 0; f < FRAMES; f++) {
    pngs.push(png(W, H, (x, y) => {
      const band = Math.floor((x + f * 6) / 80) % 2;
      if (Math.hypot(x - (80 + f * 2.7), y - 180) < 40) return [255, 80, 60];
      return band ? [30, 120, 200] : [60, 160, 230];
    }));
  }
  // WebM/VP9 is decodable everywhere (open-source Chromium has no H.264); MP4/H.264 is kept for render tests.
  const encodings = [
    ['clip.webm', ['-c:v', 'libvpx-vp9', '-b:v', '800k', '-pix_fmt', 'yuv420p']],
    ['clip.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
  ];
  for (const [name, codec] of encodings) {
    try {
      execFileSync('npx', ['remotion', 'ffmpeg', '-y', '-f', 'image2pipe', '-c:v', 'png', '-framerate', '30', '-i', '-', ...codec, join(pub, name)], { input: Buffer.concat(pngs), stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
      console.log(`${name} generated`);
    } catch (e) {
      console.warn(`Could not generate ${name}.`, String(e.stderr ?? e).slice(-400));
    }
  }
}
console.log('assets written to', pub);
