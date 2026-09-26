// A sober documentary bed, synthesised (own production, no rights issue): Am – F – C – G pads,
// soft bass on each beat, a low pulse from the second half that builds, 34 s, 48 kHz stereo.
//   node music.mjs out.wav
import { writeFileSync } from 'node:fs';
const SR = 48000, SECONDS = 34, N = SR * SECONDS;
const L = new Float32Array(N), R = new Float32Array(N);
const BEAT = 60 / 84; // 84 bpm
const BAR = BEAT * 4;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G (voiced around A3)
const roots = [45, 41, 36, 43];
const env = (t, a, r, len) => Math.min(1, t / a) * Math.min(1, Math.max(0, (len - t) / r));
// Pads: two bars per chord, slow attack/release, 3 soft harmonics, slight detune for width.
for (let c = 0; c * 2 * BAR < SECONDS; c++) {
  const ch = chords[c % 4], t0 = c * 2 * BAR, len = 2 * BAR + 0.6;
  for (const note of ch) for (const [det, pan] of [[-0.12, 0.3], [0.12, 0.7]]) {
    const f = hz(note + det / 1);
    for (let i = Math.floor(t0 * SR); i < Math.min(N, (t0 + len) * SR); i++) {
      const t = i / SR - t0, e = env(t, 1.2, 1.4, len) * 0.05;
      const ph = 2 * Math.PI * f * t;
      const v = e * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph));
      L[i] += v * (1 - pan); R[i] += v * pan;
    }
  }
  // Bass: a soft pluck on every beat, root an octave down.
  for (let b = 0; b < 8; b++) {
    const tb = t0 + b * BEAT, f = hz(roots[c % 4] - 12);
    for (let i = Math.floor(tb * SR); i < Math.min(N, (tb + BEAT) * SR); i++) {
      const t = i / SR - tb, v = 0.16 * Math.exp(-t * 3.2) * Math.min(1, t / 0.01) * Math.sin(2 * Math.PI * f * t);
      L[i] += v; R[i] += v;
    }
  }
}
// Pulse from 13 s (the build of chapter 2): a low heartbeat kick, growing, then released after 24 s.
for (let tb = 13; tb < 24.5; tb += BEAT) {
  const g = 0.35 + 0.65 * ((tb - 13) / 11.5);
  for (let i = Math.floor(tb * SR); i < Math.min(N, (tb + 0.5) * SR); i++) {
    const t = i / SR - tb, f = 48 + 60 * Math.exp(-t * 30);
    const v = 0.5 * g * Math.exp(-t * 9) * Math.sin(2 * Math.PI * f * t);
    L[i] += v; R[i] += v;
  }
}
// Fade in / out, soft clip.
for (let i = 0; i < N; i++) {
  const t = i / SR, f = Math.min(1, t / 1.5) * Math.min(1, (SECONDS - t) / 2.5);
  L[i] = Math.tanh(L[i] * f * 1.2); R[i] = Math.tanh(R[i] * f * 1.2);
}
const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { out.writeInt16LE(Math.round(L[i] * 32767), 44 + i * 4); out.writeInt16LE(Math.round(R[i] * 32767), 46 + i * 4); }
writeFileSync(process.argv[2] ?? 'music.wav', out);
