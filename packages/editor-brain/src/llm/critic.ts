/**
 * The editorial critic: a model reviews the cut against the bible rules that
 * code cannot check (REVUE: rhythm feel, story arc, hierarchy, callbacks…),
 * like a senior editor watching the edit. It sees the plan shot by shot with
 * the spoken words, and optionally one still per shot from the render.
 *
 * Its answer is structured (forced tool), checked (existing REVUE rules,
 * existing shots, concrete fix), repaired once if needed. It never blocks
 * the pipeline: findings are warnings in QC_REPORT.json, a person decides.
 */
import { BIBLE_RULES, getShotStartFrames, resolveNarration, resolveSilences, type EditorialFinding, type EditorialReview, type ShotPlan } from '@studio-engine/scene-engine';
import type { ChatImage, ChatTurn, EditorModel, ToolSpec } from './model.js';

export const REVIEW_TOOL_NAME = 'submit_editorial_review';
const SEVERITIES = ['major', 'minor', 'suggestion'] as const;

/** Rules only judgement can check: the critic's scope. */
export const REVIEW_RULES = BIBLE_RULES.filter((r) => r.enforcement === 'review');

export const REVIEW_TOOL: ToolSpec = {
  name: REVIEW_TOOL_NAME,
  description: 'Submit the editorial review of the cut: the problems found against the listed rules, each with the shots concerned and a concrete fix.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'checkedRules', 'findings'],
    properties: {
      summary: { type: 'string', description: 'Two or three sentences: the main strengths and the main problem of the cut, plainly.' },
      checkedRules: { type: 'array', items: { type: 'string' }, description: 'Ids of the rules you could actually judge from what you were given.' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rule', 'shots', 'severity', 'finding', 'fix'],
          properties: {
            rule: { type: 'string', description: 'Id of the rule broken, from the list.' },
            shots: { type: 'array', items: { type: 'string' }, description: 'Ids of the shots concerned (at least one).' },
            severity: { type: 'string', enum: [...SEVERITIES], description: 'major: a viewer would notice and it weakens the story · minor: a craft flaw · suggestion: an improvement.' },
            finding: { type: 'string', description: 'What is wrong, in one or two sentences, specific to these shots.' },
            fix: { type: 'string', description: 'The concrete change to make in the plan (shot, skill, duration, order, text…).' },
          },
        },
      },
    },
  },
};

export function buildCriticSystemPrompt(): string {
  return [
    'You are a senior documentary editor reviewing a YouTube documentary cut before publication.',
    'The cut is described shot by shot: timing, type, on-screen text, the words spoken over it, motion, camera, transition, music state and sound, and the editor\'s reason for the shot. Stills of the render may be attached, one per shot.',
    '',
    'Review it ONLY against the rules below. Automatic checks already cover everything else (durations, repetitions, licenses, loudness…): do not repeat them.',
    '- Report real problems a viewer would feel, with the exact shot ids and a concrete fix the editor can apply to the plan.',
    '- No praise inside findings, no generic advice, no invented facts: judge what is in the cut.',
    '- If a rule cannot be judged from what you are given (e.g. colour without stills), leave it out of checkedRules.',
    '- An empty findings list is a valid answer for a good cut.',
    `Answer only by calling ${REVIEW_TOOL_NAME}.`,
    '',
    'Rules (id — rule):',
    ...REVIEW_RULES.map((r) => `${r.id} — ${r.text}`),
  ].join('\n');
}

const sec = (frames: number, fps: number) => (frames / fps).toFixed(1);

/** The cut as a readable shot list, with the words spoken over each shot. */
export function buildCriticUserMessage(plan: ShotPlan, title?: string): string {
  const fps = plan.fps;
  const starts = getShotStartFrames(plan);
  const words = resolveNarration(plan).words;
  const spoken = (start: number, end: number) =>
    words.filter((w) => w.startMs >= (start / fps) * 1000 && w.startMs < (end / fps) * 1000).map((w) => w.text).join(' ');
  const silences = resolveSilences(plan, starts);
  const scenes = new Map((plan.scenes ?? []).map((s) => [s.id, s]));
  const lines: string[] = [];
  if (title) lines.push(`Title: ${title}`);
  if (plan.chapters?.length) lines.push(`Chapters: ${plan.chapters.map((c) => `"${c.title}"${c.question ? ` (${c.question})` : ''}`).join(' → ')}`);
  lines.push(`${plan.shots.length} shots, ${sec(starts[starts.length - 1]! + plan.shots[plan.shots.length - 1]!.durationInFrames, fps)} s.`, '');
  let scene: string | undefined;
  plan.shots.forEach((s, i) => {
    if (s.sceneId && s.sceneId !== scene) {
      scene = s.sceneId;
      const sc = scenes.get(s.sceneId);
      lines.push(`## Scene ${s.sceneId}${sc?.purpose ? ` — ${sc.purpose}` : ''}`);
    }
    const start = starts[i]!;
    const end = start + s.durationInFrames;
    const silence = silences.find((x) => x.endFrame === start);
    if (silence) lines.push(`   (${sec(silence.endFrame - silence.startFrame, fps)} s controlled silence: ${silence.silence.kinds.join(', ')})`);
    const parts = [
      `[${s.id}] ${sec(start, fps)}–${sec(end, fps)} s · ${s.type}`,
      s.editorialIntent ? `intent ${s.editorialIntent}${s.beat ? `/${s.beat}` : ''}${s.importance ? ` (importance ${s.importance})` : ''}` : undefined,
      s.text ? `on screen: "${s.text}"${s.highlightedWords?.length ? ` [emphasis: ${s.highlightedWords.join(', ')}]` : ''}` : undefined,
      s.media ? `media: ${s.media}` : undefined,
      s.number ? `figure: ${s.number.prefix ?? ''}${s.number.value}${s.number.suffix ?? ''}${s.number.label ? ` ${s.number.label}` : ''}` : undefined,
      s.chart ? `chart: ${s.chart.kind} ${s.chart.labels.join('/')}` : undefined,
      s.map?.markers?.length ? `map: ${s.map.markers.map((m) => m.label).join(', ')}` : undefined,
      s.motionSkill ? `motion: ${s.motionSkill}${s.intensity ? ` (${s.intensity})` : ''}` : undefined,
      s.camera && s.camera !== 'static' ? `camera: ${s.camera}` : undefined,
      s.transition && s.transition !== 'hard_cut' ? `transition in: ${s.transition}` : undefined,
      s.musicState ? `music: ${s.musicState}` : undefined,
      s.sfx?.length ? `sfx: ${s.sfx.map((e) => e.sfx).join(', ')}` : undefined,
    ].filter(Boolean);
    lines.push(parts.join(' · '));
    const said = spoken(start, end);
    if (said) lines.push(`   voice: "${said}"`);
    if (s.reasons?.shot) lines.push(`   editor's reason: ${s.reasons.shot}`);
  });
  lines.push('', `Review this cut and call ${REVIEW_TOOL_NAME}.`);
  return lines.join('\n');
}

export interface CheckedReview {
  summary: string;
  checkedRules: string[];
  findings: EditorialFinding[];
  errors: string[];
}

/** Keeps what is valid; lists the rest as errors for a repair turn. */
export function checkReview(raw: unknown, plan: ShotPlan): CheckedReview {
  const errors: string[] = [];
  const rules = new Set(REVIEW_RULES.map((r) => r.id));
  const shots = new Set(plan.shots.map((s) => s.id));
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
  if (!summary) errors.push('summary: missing');
  const checkedRules = Array.isArray(o.checkedRules) ? o.checkedRules.filter((r): r is string => typeof r === 'string') : [];
  const unknownChecked = checkedRules.filter((r) => !rules.has(r));
  if (unknownChecked.length) errors.push(`checkedRules: ${unknownChecked.join(', ')} are not rules of the list`);
  const findings: EditorialFinding[] = [];
  (Array.isArray(o.findings) ? o.findings : []).forEach((f: unknown, i) => {
    const x = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const at = `findings[${i}]`;
    const problems: string[] = [];
    if (typeof x.rule !== 'string' || !rules.has(x.rule)) problems.push(`rule "${String(x.rule)}" is not a rule of the list`);
    const ids = Array.isArray(x.shots) ? x.shots.filter((s): s is string => typeof s === 'string') : [];
    const unknown = ids.filter((s) => !shots.has(s));
    if (!ids.length) problems.push('needs at least one shot id');
    if (unknown.length) problems.push(`unknown shot id(s): ${unknown.join(', ')}`);
    if (!SEVERITIES.includes(x.severity as (typeof SEVERITIES)[number])) problems.push(`severity must be one of ${SEVERITIES.join(', ')}`);
    if (typeof x.finding !== 'string' || x.finding.trim().length < 10) problems.push('finding: say what is wrong');
    if (typeof x.fix !== 'string' || x.fix.trim().length < 10) problems.push('fix: say what to change');
    if (problems.length) errors.push(`${at}: ${problems.join('; ')}`);
    else findings.push({ rule: x.rule as string, shots: ids, severity: x.severity as EditorialFinding['severity'], finding: (x.finding as string).trim(), fix: (x.fix as string).trim() });
  });
  // A rule with a finding was judged, whether or not the model listed it.
  const judged = [...new Set([...checkedRules.filter((r) => rules.has(r)), ...findings.map((f) => f.rule)])];
  return { summary, checkedRules: judged, findings, errors };
}

export interface CriticOptions {
  model: EditorModel;
  /** One still per shot, from the render (`qc.mjs --frames-dir`). */
  stills?: Array<{ shotId: string; mediaType: ChatImage['mediaType']; data: string }>;
  /** At most this many stills are sent (evenly spread). Default 60. */
  maxStills?: number;
  title?: string;
  /** Repair turns after an invalid answer. Default 1. */
  maxRepairs?: number;
}

export interface CriticReport {
  model: string;
  attempts: number;
  errors: string[];
  stills: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  /** The last answer: replay it with `RecordedModel`. */
  answer?: unknown;
}

/** Reviews the cut. Never throws: on failure the review is `pending` with the reason. */
export async function critiqueEpisode(plan: ShotPlan, options: CriticOptions): Promise<{ review: EditorialReview; report: CriticReport }> {
  const starts = getShotStartFrames(plan);
  const index = new Map(plan.shots.map((s, i) => [s.id, i]));
  const all = (options.stills ?? []).filter((s) => index.has(s.shotId));
  const max = options.maxStills ?? 60;
  const picked = all.length <= max ? all : Array.from({ length: max }, (_, k) => all[Math.floor((k * all.length) / max)]!);
  const images: ChatImage[] = picked.map((s) => ({ mediaType: s.mediaType, data: s.data, label: `Still of shot ${s.shotId} (${sec(starts[index.get(s.shotId)!]!, plan.fps)} s):` }));
  const turns: ChatTurn[] = [{ role: 'user', text: buildCriticUserMessage(plan, options.title), ...(images.length ? { images } : {}) }];
  const report: CriticReport = { model: options.model.id, attempts: 0, errors: [], stills: images.length, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  const maxAttempts = 1 + (options.maxRepairs ?? 1);
  let checked: CheckedReview | undefined;
  try {
    while (report.attempts < maxAttempts) {
      report.attempts++;
      const response = await options.model.callTool({ system: buildCriticSystemPrompt(), turns, tool: REVIEW_TOOL, maxTokens: 8_000 });
      report.model = response.model;
      report.answer = response.input;
      if (response.usage) {
        report.usage.inputTokens += response.usage.inputTokens;
        report.usage.outputTokens += response.usage.outputTokens;
        report.usage.cacheReadTokens += response.usage.cacheReadTokens ?? 0;
        report.usage.cacheWriteTokens += response.usage.cacheWriteTokens ?? 0;
      }
      checked = checkReview(response.input, plan);
      report.errors = checked.errors;
      if (!checked.errors.length) break;
      turns.push({ role: 'repair', toolUseId: response.toolUseId, previousInput: response.input, errors: checked.errors });
    }
  } catch (e) {
    report.errors.push((e as Error).message);
    if (!checked) return { review: { status: 'pending', reason: `the AI critic failed: ${(e as Error).message}` }, report };
  }
  if (!checked) return { review: { status: 'pending', reason: 'the AI critic gave no answer' }, report };
  // What is still invalid after the repair is dropped (and listed in the report).
  return { review: { status: 'done', reviewer: report.model, summary: checked.summary || '(no summary)', checkedRules: checked.checkedRules, findings: checked.findings }, report };
}
