// Aligns a KNOWN text on a clean voice recording, without speech recognition (none is reachable here):
// pauses in the audio are matched to the punctuation of the text (dynamic programming), then the words
// of each phrase are spread over its speech by syllable count. Precision: about ±100–150 ms per word.
//   node align.mjs <voice audio> <transcript.txt> > words.json
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [audio, textFile] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'align-'));
const wav = join(dir, 'v.wav');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', audio, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
const buf = readFileSync(wav);
rmSync(dir, { recursive: true, force: true });
const data = buf.indexOf('data') + 8;
const n = Math.floor((buf.length - data) / 2);
const HOP = 160; // 10 ms
const db = [];
for (let f = 0; f * HOP < n; f++) {
  let s = 0;
  const end = Math.min(n, (f + 1) * HOP);
  for (let i = f * HOP; i < end; i++) { const v = buf.readInt16LE(data + i * 2) / 32768; s += v * v; }
  db.push(10 * Math.log10(s / (end - f * HOP) + 1e-12));
}
const peak = Math.max(...db);
const thr = Math.max(-50, peak - 38);
const speech = db.map((v) => v > thr);
// Speech runs, merging tiny holes (< 60 ms: stops inside words).
const runs = [];
let start = -1;
speech.forEach((on, i) => { if (on && start < 0) start = i; if (!on && start >= 0) { runs.push([start, i]); start = -1; } });
if (start >= 0) runs.push([start, speech.length]);
const merged = [];
for (const r of runs) { const last = merged[merged.length - 1]; if (last && r[0] - last[1] < 6) last[1] = r[1]; else merged.push([...r]); }
// Pauses between speech runs (>= 90 ms).
const gaps = [];
for (let i = 1; i < merged.length; i++) if (merged[i][0] - merged[i - 1][1] >= 9) gaps.push({ from: merged[i - 1][1], to: merged[i][0] });
const speechStart = merged[0][0];
const speechEnd = merged[merged.length - 1][1];

// Words and phrases (a phrase ends at . , : ; ! ?).
const text = readFileSync(textFile, 'utf8').trim();
const words = text.split(/\s+/);
const syll = (w) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g) ?? []).length) + 0.3;
const phrases = [];
let cur = [];
words.forEach((w, i) => { cur.push(i); if (/[.,:;!?]$/.test(w)) { phrases.push(cur); cur = []; } });
if (cur.length) phrases.push(cur);
const weight = phrases.map((p) => p.reduce((s, i) => s + syll(words[i]), 0));
const total = weight.reduce((a, b) => a + b, 0);
const voiced = merged.reduce((s, r) => s + r[1] - r[0], 0);
// Expected time of each phrase boundary if speech were evenly paced (voiced time only).
const expected = [];
let acc = 0;
for (let k = 0; k < phrases.length - 1; k++) { acc += weight[k]; expected.push(acc / total); }
// Map a voiced-time fraction to an absolute frame.
const atFraction = (x) => { let need = x * voiced; for (const r of merged) { const len = r[1] - r[0]; if (need <= len) return r[0] + need; need -= len; } return speechEnd; };

// DP: each boundary picks a distinct gap in order, or none (a comma the voice did not pause on).
const m = expected.length, G = gaps.length;
const cost = (k, g) => Math.abs((gaps[g].from + gaps[g].to) / 2 - atFraction(expected[k])) / 100 - (gaps[g].to - gaps[g].from) / 300; // seconds off, minus a bonus for long pauses
const NOGAP = /[.:;!?]$/; // strong punctuation should get a pause
const best = Array.from({ length: m + 1 }, () => new Array(G + 1).fill(Infinity));
const back = Array.from({ length: m + 1 }, () => new Array(G + 1).fill(null));
best[0].fill(0);
for (let k = 1; k <= m; k++) {
  const lastWord = words[phrases[k - 1][phrases[k - 1].length - 1]];
  for (let g = 0; g <= G; g++) {
    // boundary k-1 with no gap
    const skip = best[k - 1][g] + (NOGAP.test(lastWord) ? 1.5 : 0.25);
    if (skip < best[k][g]) { best[k][g] = skip; back[k][g] = { g, used: -1 }; }
    // boundary k-1 on gap g-1 (gaps before it left unused: pauses inside phrases, small cost)
    if (g > 0) for (let h = 0; h < g; h++) {
      const c = best[k - 1][h] + cost(k - 1, g - 1) + (g - 1 - h) * 0.15;
      if (c < best[k][g]) { best[k][g] = c; back[k][g] = { g: h, used: g - 1 }; }
    }
  }
}
let g = best[m].indexOf(Math.min(...best[m]));
const bound = new Array(m).fill(null);
for (let k = m; k > 0; k--) { const b = back[k][g]; bound[k - 1] = b.used >= 0 ? gaps[b.used] : null; g = b.g; }

// Phrase spans, then words by syllables over the voiced frames of the span.
const out = [];
let spanStart = speechStart;
phrases.forEach((p, k) => {
  const gap = k < m ? bound[k] : null;
  const spanEnd = k < m ? (gap ? gap.from : Math.round(atFraction((expected[k]) ))) : speechEnd;
  const next = gap ? gap.to : spanEnd;
  const w = p.map((i) => syll(words[i]));
  const sum = w.reduce((a, b) => a + b, 0);
  let t = spanStart;
  p.forEach((i, j) => {
    const len = ((spanEnd - spanStart) * w[j]) / sum;
    out.push({ text: words[i], startMs: Math.round(t * 10), endMs: Math.round((t + len) * 10) });
    t += len;
  });
  spanStart = next;
});
process.stderr.write(`${merged.length} speech runs, ${gaps.length} pauses, ${phrases.length} phrases, ${bound.filter(Boolean).length}/${m} boundaries on a pause\n`);
process.stdout.write(JSON.stringify(out, null, 1));
