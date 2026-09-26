/**
 * QC_REPORT.json: everything that must be true before an episode is
 * published, in one file, each check citing its bible rule. It merges the
 * plan checks (validation, compile notes, rights), the render checks
 * (format, pictures, sound, loudness) and the editorial review (AI critic
 * or human) of the rules that code cannot check (REVUE).
 */
import { BIBLE_RULES } from '../bible/index.js';
import { judgeLoudness, LOUDNESS_TARGETS, type LoudnessMeasure } from '../mix/loudness.js';
import type { JsonValue } from '../model/primitives.js';
import { compileShotPlan, type CompileShotPlanOptions } from '../shotplan/compile.js';
import { resolveNarration, resolveSilences } from '../shotplan/editorial.js';
import { getShotPlanDuration, getShotStartFrames } from '../shotplan/timeline.js';
import type { ShotPlan } from '../shotplan/types.js';
import { validateShotPlan } from '../shotplan/validate.js';
import { activeShare, AUDIO_QC, meanLevelDb, type AudioFrame } from './audio.js';
import type { RenderProbe } from './format.js';
import { darkKind, expectedDarkWindows, runsOf, uncoveredRuns, type FrameStats } from './frames.js';

export type QcStatus = 'pass' | 'fail' | 'warn' | 'info' | 'skipped';

export interface QcCheck {
  /** Stable id of the check, e.g. `render.black`. */
  id: string;
  rule?: string;
  status: QcStatus;
  message: string;
  /** Where on the timeline, when it applies. */
  at?: { frame: number; seconds: number; shotId?: string };
  details?: JsonValue;
}

/** One finding of the editorial critic on a REVUE rule. */
export interface EditorialFinding {
  rule: string;
  shots: string[];
  severity: 'major' | 'minor' | 'suggestion';
  finding: string;
  fix: string;
}

export type EditorialReview =
  | { status: 'done'; reviewer: string; summary: string; checkedRules: string[]; findings: EditorialFinding[] }
  | { status: 'pending'; reason: string };

export interface QcReport {
  format: 'studio-engine/qc-report';
  version: 1;
  generatedAt: string;
  stage: 'final' | 'preview';
  summary: { pass: boolean; failed: number; warnings: number; checks: number };
  checks: QcCheck[];
  /** Attributions to publish in the YouTube description (SRC-03). */
  attributions: Array<{ assetId: string; attribution: string }>;
  /** Disclosures to make when publishing (SRC-04: altered or synthetic content). */
  disclosures: string[];
  /** Rules only a person or the AI critic can judge (REVUE), with the review if one was made. */
  review: EditorialReview & { rules: Array<{ id: string; text: string }> };
  notes: string[];
}

export interface QcInput {
  plan: ShotPlan;
  /** `final` (default): 1080p, blocking rules fail. `preview`: resolution not checked. */
  stage?: 'final' | 'preview';
  compile?: CompileShotPlanOptions;
  /** Rendered file, when there is one. */
  probe?: RenderProbe;
  /** Per rendered frame. */
  frames?: FrameStats[];
  /** Per rendered frame: difference with the frame one second earlier (0..1). */
  motion?: number[];
  audio?: AudioFrame[];
  loudness?: LoudnessMeasure;
  review?: EditorialReview;
  /** Clock, injectable for reproducible reports. */
  now?: () => Date;
}

const STILL = 0.002;

export function runQc(input: QcInput): QcReport {
  const { plan } = input;
  const stage = input.stage ?? 'final';
  const fps = plan.fps;
  const checks: QcCheck[] = [];
  const notes: string[] = [];
  const starts = getShotStartFrames(plan);
  const shotAt = (frame: number) => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1]! <= frame) i++;
    return plan.shots[i]?.id;
  };
  const at = (frame: number) => ({ frame, seconds: Number((frame / fps).toFixed(2)), ...(shotAt(frame) ? { shotId: shotAt(frame)! } : {}) });
  const add = (c: QcCheck) => checks.push(c);

  // --- Plan -----------------------------------------------------------------
  const validation = validateShotPlan(plan, { stage: stage === 'final' ? 'final' : 'draft', ...(input.compile?.hyperframes ? { hyperframes: input.compile.hyperframes } : {}) });
  for (const e of validation.errors) add({ id: `plan.${e.code}`, rule: e.rule ?? 'TECH-02', status: 'fail', message: `${e.path}: ${e.message}` });
  for (const w of validation.warnings) add({ id: `plan.${w.code}`, ...(w.rule ? { rule: w.rule } : {}), status: 'warn', message: `${w.path}: ${w.message}` });
  if (!validation.errors.length) add({ id: 'plan.valid', rule: 'TECH-02', status: 'pass', message: `the plan is valid (${stage === 'final' ? 'final' : 'draft'} validation)` });

  const compiled = compileShotPlan(plan, input.compile);
  if (compiled.ok) {
    for (const n of compiled.notes) {
      if (/unresolved|unknown/.test(n)) add({ id: 'plan.reference', rule: 'TECH-06', status: 'warn', message: n });
      else if (n.includes('[SRC-01]')) add({ id: 'source.hyperframes', rule: 'SRC-01', status: 'warn', message: n });
      else notes.push(n);
    }
  }

  // Rights.
  const attributions = Object.values(plan.assets)
    .filter((a) => a.source?.attributionRequired)
    .map((a) => ({ assetId: a.id, attribution: a.source?.attribution ?? `(missing attribution text for "${a.id}")` }));
  if (attributions.length) add({ id: 'rights.attributions', rule: 'SRC-03', status: 'info', message: `${attributions.length} attribution(s) to publish in the description` });
  const synthetic = Object.values(plan.assets).filter((a) => a.source?.syntheticMedia);
  const disclosures = synthetic.length
    ? [`Realistic AI-generated media (${synthetic.map((a) => a.id).join(', ')}): declare "altered or synthetic content" when uploading to YouTube.`]
    : [];
  if (synthetic.length) add({ id: 'rights.synthetic', rule: 'SRC-04', status: 'warn', message: disclosures[0]! });

  // --- Render: format ------------------------------------------------------
  const duration = getShotPlanDuration(plan);
  if (input.probe) {
    const p = input.probe;
    const problems: string[] = [];
    if (stage === 'final' && (p.width !== plan.width || p.height !== plan.height)) problems.push(`${p.width}×${p.height} instead of ${plan.width}×${plan.height}`);
    if (Math.abs(p.fps - fps) > 0.01) problems.push(`${p.fps.toFixed(2)} fps instead of ${fps}`);
    if (p.videoCodec !== 'h264') problems.push(`video codec ${p.videoCodec}, not H.264`);
    const renderedFrames = p.frameCount ?? Math.round(p.durationSeconds * fps);
    if (Math.abs(renderedFrames - duration) > 1) problems.push(`${renderedFrames} frames instead of ${duration}`);
    if (!p.audioCodec) problems.push('no audio stream');
    add(problems.length
      ? { id: 'render.format', rule: 'TECH-07', status: stage === 'final' ? 'fail' : 'warn', message: problems.join('; '), details: p as unknown as JsonValue }
      : { id: 'render.format', rule: 'TECH-07', status: 'pass', message: `${p.width}×${p.height}, ${p.videoCodec}, ${fps} fps, ${duration} frames`, details: p as unknown as JsonValue });
  } else add({ id: 'render.format', rule: 'TECH-07', status: 'skipped', message: 'no rendered file given' });

  // --- Render: pictures ----------------------------------------------------
  if (input.frames) {
    const windows = expectedDarkWindows(plan);
    const dark = runsOf(input.frames, (s) => darkKind(s) !== undefined);
    let bad = 0;
    for (const run of dark) {
      for (const r of uncoveredRuns(run, windows)) {
        if (r.endFrame - r.startFrame <= 2) continue;
        const black = input.frames.slice(r.startFrame, r.endFrame).some((s) => darkKind(s) === 'black');
        bad++;
        add({ id: 'render.black', rule: 'TECH-03', status: black ? 'fail' : 'warn', message: `${r.endFrame - r.startFrame} ${black ? 'black' : 'empty dark'} frames where the plan shows content`, at: at(r.startFrame) });
      }
    }
    const expected = dark.length - bad;
    if (!bad) add({ id: 'render.black', rule: 'TECH-03', status: 'pass', message: `no unwanted black frame${expected ? ` (${expected} intended dark passage(s): cards, entrances, dips)` : ''}` });
  } else add({ id: 'render.black', rule: 'TECH-03', status: 'skipped', message: 'no frames analysed' });

  if (input.motion) {
    const holds = new Set(plan.shots.filter((s) => s.hold).map((s) => s.id));
    const still = runsOf(input.motion, (d, f) => f >= fps && d < STILL).filter((r) => r.endFrame - r.startFrame >= 3 * fps);
    // A run of 1-second differences under the threshold for 3 s = 4 s without visible change.
    let frozen = 0;
    for (const r of still) {
      const shot = shotAt(r.startFrame);
      if (shot && holds.has(shot)) continue;
      frozen++;
      add({ id: 'render.frozen', rule: 'RHY-03', status: 'warn', message: `${((r.endFrame - r.startFrame) / fps + 1).toFixed(1)} s without visible change`, at: at(Math.max(0, r.startFrame - fps)) });
    }
    if (!frozen) add({ id: 'render.frozen', rule: 'RHY-03', status: 'pass', message: 'the picture changes at least every 4 s (except intentional holds)' });
  }

  // --- Render: sound -------------------------------------------------------
  if (input.audio) {
    const a = input.audio;
    const voice = resolveNarration(plan).voice;
    const heard = (v: (typeof voice)[number]) => activeShare(a, v.startFrame, v.startFrame + v.durationInFrames, AUDIO_QC.voiceMissingDb);
    const mute = voice.filter((v) => v.durationInFrames > fps * 0.3 && heard(v) < AUDIO_QC.voiceMinShare);
    for (const v of mute) add({ id: 'audio.voice', rule: 'TECH-01', status: 'fail', message: `narration "${v.id}" is not heard (${Math.round(heard(v) * 100)} % of it over ${AUDIO_QC.voiceMissingDb} dBFS): missing, muted or unreadable audio`, at: at(v.startFrame) });
    if (voice.length && !mute.length) add({ id: 'audio.voice', rule: 'TECH-01', status: 'pass', message: `the narration is heard in all ${voice.length} segment(s)` });

    const silences = resolveSilences(plan, starts);
    const drop = Math.round(fps * 0.15);
    for (const s of silences.filter((x) => x.silence.kinds.includes('music_drop'))) {
      const level = meanLevelDb(a, s.startFrame + drop, s.endFrame);
      add(level > AUDIO_QC.silenceMaxDb
        ? { id: 'audio.silence', rule: 'SIL-04', status: 'warn', message: `controlled silence "${s.silence.id}" is not silent (${level.toFixed(1)} dBFS)`, at: at(s.startFrame) }
        : { id: 'audio.silence', rule: 'SIL-04', status: 'pass', message: `controlled silence "${s.silence.id}" is silent (${level.toFixed(1)} dBFS)`, at: at(s.startFrame) });
    }

    const inSilence = (f: number) => silences.some((s) => f >= s.startFrame - drop && f < s.endFrame);
    const gaps = runsOf(a, (x, f) => x.rmsDb < AUDIO_QC.gapDb && !inSilence(f)).filter((r) => r.endFrame - r.startFrame > AUDIO_QC.gapSeconds * fps);
    for (const g of gaps) add({ id: 'audio.gap', rule: 'TECH-08', status: 'warn', message: `${((g.endFrame - g.startFrame) / fps).toFixed(1)} s of silence nobody asked for`, at: at(g.startFrame) });
    if (!gaps.length) add({ id: 'audio.gap', rule: 'TECH-08', status: 'pass', message: 'no unwanted gap in the sound' });

    const clipped = a.filter((x) => x.peak >= AUDIO_QC.clipPeak).length;
    add(clipped
      ? { id: 'audio.clipping', rule: 'TECH-05', status: 'fail', message: `${clipped} frame(s) with clipped samples`, at: at(a.findIndex((x) => x.peak >= AUDIO_QC.clipPeak)) }
      : { id: 'audio.clipping', rule: 'TECH-05', status: 'pass', message: 'no clipped sample' });
  } else add({ id: 'audio.voice', rule: 'TECH-01', status: 'skipped', message: 'no audio analysed' });

  if (input.loudness) {
    const v = judgeLoudness(input.loudness, LOUDNESS_TARGETS.master);
    const m = input.loudness;
    const summary = `${m.integrated.toFixed(1)} LUFS, true peak ${m.truePeak.toFixed(1)} dBTP, LRA ${m.lra.toFixed(1)} LU`;
    if (v.pass) add({ id: 'audio.loudness', rule: 'MUS-09', status: 'pass', message: summary });
    for (const i of v.issues) add({ id: `audio.${i.code.split('.')[1]}`, rule: i.code === 'mix.truePeak' ? 'TECH-05' : i.rule, status: i.code === 'mix.truePeak' ? 'fail' : 'warn', message: `${i.message}${i.code === 'mix.loudness' ? ` (apply ${v.gainToTargetDb > 0 ? '+' : ''}${v.gainToTargetDb} dB, or loudness.mjs --fix)` : ''}` });
  } else add({ id: 'audio.loudness', rule: 'MUS-09', status: 'skipped', message: 'loudness not measured' });

  // --- Editorial review (REVUE rules) --------------------------------------
  const reviewRules = BIBLE_RULES.filter((r) => r.enforcement === 'review').map((r) => ({ id: r.id, text: r.text }));
  const review = input.review ?? { status: 'pending' as const, reason: 'no editorial review yet: run `editor-brain critique` (AI) or review these rules by hand' };
  if (review.status === 'done') {
    for (const f of review.findings) add({ id: 'review.finding', rule: f.rule, status: f.severity === 'suggestion' ? 'info' : 'warn', message: `[${f.severity}] ${f.finding} → ${f.fix}`, ...(f.shots[0] ? { at: at(starts[plan.shots.findIndex((s) => s.id === f.shots[0])] ?? 0) } : {}), details: { shots: f.shots } });
    add({ id: 'review.done', status: 'info', message: `editorial review by ${review.reviewer}: ${review.findings.length} finding(s) on ${review.checkedRules.length} rule(s)` });
  } else add({ id: 'review.pending', status: 'info', message: `${reviewRules.length} rules need an editorial review (${review.reason})` });

  const failed = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  return {
    format: 'studio-engine/qc-report',
    version: 1,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    stage,
    summary: { pass: failed === 0, failed, warnings, checks: checks.length },
    checks,
    attributions,
    disclosures,
    review: { ...review, rules: reviewRules },
    notes,
  };
}

const ICON: Record<QcStatus, string> = { pass: '✓', fail: '✗', warn: '!', info: 'i', skipped: '-' };

/** Human-readable summary of a report (terminal / logs). */
export function formatQcReport(r: QcReport): string {
  const lines = [`QC ${r.stage}: ${r.summary.pass ? 'PASS' : 'FAIL'} — ${r.summary.failed} failed, ${r.summary.warnings} warning(s), ${r.summary.checks} checks`];
  const order: QcStatus[] = ['fail', 'warn', 'pass', 'info', 'skipped'];
  for (const s of order)
    for (const c of r.checks.filter((x) => x.status === s)) lines.push(`${ICON[s]} ${c.rule ? `[${c.rule}] ` : ''}${c.message}${c.at ? ` @ ${c.at.seconds}s${c.at.shotId ? ` (${c.at.shotId})` : ''}` : ''}`);
  if (r.attributions.length) lines.push('', 'Attributions (description):', ...r.attributions.map((a) => `  ${a.attribution}`));
  if (r.disclosures.length) lines.push('', 'Disclosures:', ...r.disclosures.map((d) => `  ${d}`));
  return lines.join('\n');
}
