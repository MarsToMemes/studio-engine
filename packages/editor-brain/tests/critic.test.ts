import { describe, expect, it } from 'vitest';
import { BIBLE_RULES, runQc } from '@studio-engine/scene-engine';
import { buildCriticSystemPrompt, buildCriticUserMessage, checkReview, critiqueEpisode, directEpisode, mcdonaldsExample, RecordedModel, REVIEW_RULES, runBrainCli, type BrainCliIo } from '../src/index';

const { plan } = directEpisode(mcdonaldsExample());
const reveal = plan.shots.find((s) => s.editorialIntent === 'revelation')!.id;
const good = {
  summary: 'Clear arc and a well prepared revelation; the aftermath is too short to let it land.',
  checkedRules: ['RHY-06', 'RHY-09', 'REV-01'],
  findings: [{ rule: 'RHY-09', shots: [reveal], severity: 'minor', finding: 'The revelation is followed immediately by new information.', fix: 'Add 1 s of hold on the shot after the revelation, on a slow push.' }],
};

describe('editorial critic', () => {
  it('only judges the REVUE rules, and sees the cut shot by shot with the voice', () => {
    expect(REVIEW_RULES.length).toBe(BIBLE_RULES.filter((r) => r.enforcement === 'review').length);
    const system = buildCriticSystemPrompt();
    expect(system).toContain('RHY-06 — ');
    expect(system).not.toContain('RHY-01 — '); // automatic rule
    const user = buildCriticUserMessage(plan, 'McDonald’s');
    expect(user).toContain(`[${plan.shots[0]!.id}] 0.0–`);
    expect(user).toContain('voice: "McDonald\'s');
    expect(user).toMatch(/controlled silence: music_drop, sfx_drop/);
  });

  it('accepts a valid review', async () => {
    const model = new RecordedModel([good]);
    const { review, report } = await critiqueEpisode(plan, { model });
    expect(review).toMatchObject({ status: 'done', reviewer: 'recorded', checkedRules: ['RHY-06', 'RHY-09', 'REV-01'], findings: [{ rule: 'RHY-09', shots: [reveal] }] });
    expect(report.attempts).toBe(1);
    expect(model.requests[0]!.tool.name).toBe('submit_editorial_review');
  });

  it('repairs an invalid answer with the exact errors, then drops what is still wrong', async () => {
    const bad = { ...good, findings: [...good.findings, { rule: 'RHY-01', shots: ['nope'], severity: 'huge', finding: 'x', fix: 'y' }] };
    const model = new RecordedModel([bad, good]);
    const { review, report } = await critiqueEpisode(plan, { model });
    expect(report.attempts).toBe(2);
    const repair = model.requests[1]!.turns[1]!;
    expect(repair.role).toBe('repair');
    expect(repair.role === 'repair' && repair.errors[0]).toMatch(/rule "RHY-01" is not a rule of the list; unknown shot id\(s\): nope; severity must be/);
    expect(review.status === 'done' && review.findings).toHaveLength(1);
    // Still invalid after the repair: the valid part is kept.
    const stubborn = await critiqueEpisode(plan, { model: new RecordedModel([bad, bad]) });
    expect(stubborn.review.status === 'done' && stubborn.review.findings).toHaveLength(1);
    expect(stubborn.report.errors).toHaveLength(1);
    expect(checkReview({}, plan).errors).toContain('summary: missing');
  });

  it('sends the stills of the shots, labelled, at most maxStills', async () => {
    const model = new RecordedModel([good]);
    const stills = plan.shots.map((s) => ({ shotId: s.id, mediaType: 'image/jpeg' as const, data: 'AAAA' }));
    await critiqueEpisode(plan, { model, stills, maxStills: 3 });
    const turn = model.requests[0]!.turns[0]!;
    expect(turn.role === 'user' && turn.images).toHaveLength(3);
    expect(turn.role === 'user' && turn.images![0]!.label).toBe(`Still of shot ${plan.shots[0]!.id} (0.0 s):`);
  });

  it('never throws: an API failure leaves the review pending', async () => {
    const { review } = await critiqueEpisode(plan, { model: new RecordedModel([new Error('overloaded')]) });
    expect(review).toEqual({ status: 'pending', reason: 'the AI critic failed: overloaded' });
  });

  it('the review lands in the QC report as warnings with the shot', async () => {
    const { review } = await critiqueEpisode(plan, { model: new RecordedModel([good]) });
    const r = runQc({ plan, review });
    expect(r.checks.find((c) => c.id === 'review.finding')).toMatchObject({ rule: 'RHY-09', status: 'warn', at: { shotId: reveal } });
  });
});

describe('editor-brain critique (CLI)', () => {
  const io = (files: Record<string, string>) => {
    const out: string[] = [];
    const err: string[] = [];
    const cli: BrainCliIo = { readInput: (p) => files[p]!, stdout: (t) => out.push(t), stderr: (t) => err.push(t), readStills: () => [{ name: `001-${plan.shots[0]!.id}.jpg`, data: 'AAAA' }] };
    return { cli, out, err };
  };

  it('without a key: pending review, exit 1', async () => {
    const { cli, out, err } = io({ 'plan.json': JSON.stringify(plan) });
    expect(await runBrainCli(['critique', 'plan.json'], cli, { env: {} })).toBe(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ status: 'pending' });
    expect(err[0]).toContain('ANTHROPIC_API_KEY');
  });

  it('with a model: the review as JSON, stills read from the directory', async () => {
    const { cli, out } = io({ 'plan.json': JSON.stringify({ plan }) });
    const model = new RecordedModel([good]);
    expect(await runBrainCli(['critique', 'plan.json', '--stills=frames'], cli, { model })).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({ status: 'done', findings: [{ rule: 'RHY-09' }], llm: { stills: 1 } });
    const turn = model.requests[0]!.turns[0]!;
    expect(turn.role === 'user' && turn.images![0]!.label).toContain(plan.shots[0]!.id);
  });

  it('rejects a file that is not a plan', async () => {
    const { cli } = io({ 'x.json': '{"a":1}' });
    expect(await runBrainCli(['critique', 'x.json'], cli, { env: {} })).toBe(2);
  });
});
