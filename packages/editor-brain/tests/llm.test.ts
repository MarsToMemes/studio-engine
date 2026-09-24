import { describe, expect, it } from 'vitest';
import {
  AnthropicModel,
  buildSystemPrompt,
  directEpisode,
  directEpisodeWithLlm,
  heuristicStory,
  mcdonaldsExample,
  RecordedModel,
  STORY_TOOL,
  buildUserMessage,
  type BrainInput,
} from '../src/index';
import { badAnswer, goodAnswer } from './fixtures/llm-answers';

/** The example without the author's hints on u2 (media) and u7 (revelation): the model must find them. */
function unhinted(): BrainInput {
  const input = mcdonaldsExample();
  input.script = input.script.map((b) => (b.kind === 'text' && (b.hints?.media || b.hints?.intent) ? { kind: 'text', text: b.text } : b));
  return input;
}

describe('prompts come from the bible and the grammar', () => {
  it('the system prompt carries the rules the validation enforces', () => {
    const system = buildSystemPrompt();
    expect(system).toContain('REV-02');
    expect(system).toContain('DIR-02');
    expect(system).toContain('SCENE-02');
    expect(system).toContain('- revelation: the hidden truth the chapter builds towards. Shown as revelation / text');
    expect(system).toContain('ORDINAL editorial levels 1–5');
    expect(system).toContain('Never invent figures, data, documents or quotes');
    expect(system).not.toContain('- chapter:'); // sentences are never chapters
  });

  it('the user message lists the sentences, the facts found and the catalogue', () => {
    const input = unhinted();
    const msg = buildUserMessage(heuristicStory(input), { title: 'T', catalog: [{ id: 'restaurant', kind: 'image', description: 'McDonald’s restaurant at sunset' }] });
    expect(msg).toContain('## Chapter 1: The real business — question: How does McDonald\'s really make money?');
    expect(msg).toContain('u3: Over 61% of its revenue comes from franchisees.   [figure 61%]');
    expect(msg).toContain('u6: From Chicago to Tokyo');
    expect(msg).toContain('[place Chicago; place Tokyo; place London; place Sydney]');
    expect(msg).toContain('- restaurant (image): McDonald’s restaurant at sunset');
  });
});

describe('LLM editor brain', () => {
  it('uses the model’s story: finds the revelation and the media without hints', async () => {
    const model = new RecordedModel([goodAnswer]);
    const r = await directEpisodeWithLlm(unhinted(), { model });
    expect(r.llm).toMatchObject({ accepted: 'full', attempts: 1, errors: [] });
    // Without hints the heuristic brain misses the revelation; the model finds it.
    expect(directEpisode(unhinted()).analysis.find((u) => u.id === 'u7')!.intent).toBe('important_fact');
    expect(r.analysis.find((u) => u.id === 'u7')).toMatchObject({ intent: 'revelation', why: expect.stringContaining('hidden truth') });
    expect(r.plan.shots.find((s) => s.id === 'u7')).toMatchObject({ type: 'revelation', motionSkill: 'blackout_reveal', decidedBy: 'ai' });
    expect(r.plan.silences).toHaveLength(1);
    // The model chose the restaurant for u2: it becomes the motif and the callback.
    expect(r.plan.shots.find((s) => s.id === 'u2')).toMatchObject({ type: 'image', media: 'restaurant' });
    expect(r.plan.shots.find((s) => s.editorialIntent === 'conclusion')).toMatchObject({ media: 'restaurant', transition: 'dissolve' });
    expect(r.plan.scenes!.map((s) => s.purpose)).toEqual(goodAnswer.scenes.map((s) => s.purpose));
    expect(r.plan.metadata).toMatchObject({ editorialModel: 'recorded' });
    expect(r.qc.errors).toEqual([]);
    expect(r.qc.warnings).toEqual([]);
  });

  it('sends the exact errors back and uses the repaired answer', async () => {
    const model = new RecordedModel([badAnswer, goodAnswer]);
    const r = await directEpisodeWithLlm(unhinted(), { model });
    expect(r.llm).toMatchObject({ accepted: 'full', attempts: 2 });
    const repair = model.requests[1]!.turns[1]!;
    expect(repair.role).toBe('repair');
    const errors = repair.role === 'repair' ? repair.errors : [];
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('u3: intent "big_number" is not one of'),
        'u3: emphasis "pizza" is not a word of the sentence',
        'u8: importance must be an integer level from 1 to 5 (got 0.87)',
        'scene 1: a scene stays inside one chapter',
        expect.stringContaining('scene 2: the first beat is "setup"'),
        expect.stringContaining('scene 2: starts with a revelation (u7)'),
      ]),
    );
  });

  it('keeps what is valid and falls back on the rest when the model does not fix it', async () => {
    const r = await directEpisodeWithLlm(unhinted(), { model: new RecordedModel([badAnswer, badAnswer]) });
    expect(r.llm.accepted).toBe('partial');
    expect(r.llm.attempts).toBe(2);
    expect(r.analysis.find((u) => u.id === 'u7')!.intent).toBe('revelation'); // valid sentences kept
    expect(r.analysis.find((u) => u.id === 'u3')!.why).toBe('contains a key figure'); // heuristic for the invalid one
    expect(r.decisions).toContain("u3: the model's analysis was rejected, heuristic analysis kept");
    expect(r.decisions).toContain("the model's scene structure was rejected, heuristic structure rebuilt on its analysis");
    expect(r.qc.errors).toEqual([]);
  });

  it('never fails: without the model the heuristic brain directs', async () => {
    const r = await directEpisodeWithLlm(unhinted(), { model: new RecordedModel([new Error('401 invalid x-api-key')]) });
    expect(r.llm.accepted).toBe('none');
    expect(r.decisions).toContain('LLM unavailable (401 invalid x-api-key): heuristic brain used');
    expect(JSON.stringify(r.plan)).toBe(JSON.stringify(directEpisode(unhinted()).plan));
  });

  it('author hints win over the model', async () => {
    const answer = structuredClone(goodAnswer);
    answer.sentences[6]!.intent = 'fact';
    const r = await directEpisodeWithLlm(mcdonaldsExample(), { model: new RecordedModel([answer]) }); // u7 hinted as revelation
    expect(r.analysis.find((u) => u.id === 'u7')!.intent).toBe('revelation');
  });

  it('a recorded answer replays to the same plan (no second API call needed)', async () => {
    const first = await directEpisodeWithLlm(unhinted(), { model: new RecordedModel([goodAnswer]) });
    const replay = await directEpisodeWithLlm(unhinted(), { model: new RecordedModel([first.llm.answer]) });
    expect(JSON.stringify(replay.plan)).toBe(JSON.stringify(first.plan));
  });
});

describe('AnthropicModel (official SDK, injected client)', () => {
  type Params = Record<string, unknown> & { messages: Array<{ role: string; content: unknown }> };
  const fakeClient = (response: unknown) => {
    const calls: Params[] = [];
    return { calls, client: { messages: { create: async (params: Params) => (calls.push(params), response) } } as never };
  };
  const toolResponse = (input: unknown, stop = 'tool_use') => ({
    model: 'claude-sonnet-5',
    stop_reason: stop,
    content: [{ type: 'tool_use', id: 'toolu_1', name: STORY_TOOL.name, input }],
    usage: { input_tokens: 3000, output_tokens: 900, cache_read_input_tokens: 2500, cache_creation_input_tokens: 0 },
  });

  it('forces the story tool, caches the system prompt, reports usage', async () => {
    const { calls, client } = fakeClient(toolResponse(goodAnswer));
    const model = new AnthropicModel({ client });
    const r = await directEpisodeWithLlm(unhinted(), { model });
    expect(r.llm).toMatchObject({ model: 'claude-sonnet-5', accepted: 'full', usage: { inputTokens: 3000, outputTokens: 900, cacheReadTokens: 2500 } });
    const p = calls[0]!;
    expect(p.model).toBe('claude-sonnet-5');
    expect(p.tool_choice).toEqual({ type: 'tool', name: 'submit_editorial_story' });
    expect(p.system).toEqual([{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }]);
    expect((p.tools as Array<{ input_schema: unknown }>)[0]!.input_schema).toEqual(STORY_TOOL.inputSchema);
    expect(p.max_tokens).toBe(2000 + 150 * 9);
  });

  it('a repair turn is a tool_result error on the previous tool call', async () => {
    const { calls, client } = fakeClient(toolResponse(goodAnswer));
    let n = 0;
    const flaky = { messages: { create: async (params: Params) => (calls.push(params), n++ === 0 ? toolResponse(badAnswer) : toolResponse(goodAnswer)) } } as never;
    await directEpisodeWithLlm(unhinted(), { model: new AnthropicModel({ client: flaky }) });
    void client;
    const second = calls[1]!.messages;
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second[1]!.content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'submit_editorial_story', input: badAnswer }]);
    expect(second[2]!.content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: expect.stringContaining('u3: emphasis "pizza"') })]);
  });

  it('a truncated answer or a missing tool call falls back cleanly', async () => {
    const truncated = await directEpisodeWithLlm(unhinted(), { model: new AnthropicModel({ client: fakeClient(toolResponse(goodAnswer, 'max_tokens')).client }) });
    expect(truncated.llm.accepted).toBe('none');
    expect(truncated.decisions.find((d) => d.startsWith('LLM unavailable'))).toContain('max_tokens');
    const noTool = await directEpisodeWithLlm(unhinted(), { model: new AnthropicModel({ client: fakeClient({ ...toolResponse(goodAnswer, 'end_turn'), content: [{ type: 'text', text: 'Sure!' }] }).client }) });
    expect(noTool.decisions.find((d) => d.startsWith('LLM unavailable'))).toContain('did not call submit_editorial_story');
  });
});
