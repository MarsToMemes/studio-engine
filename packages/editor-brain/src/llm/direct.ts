/**
 * The LLM editor brain: the model writes the editorial story (analysis +
 * scenes), the rules validate it, a repair turn gives it the exact errors,
 * and whatever is still wrong falls back to the heuristic brain. Everything
 * after the story (rhythm, visuals, motion, sound, QC) is shared and
 * deterministic.
 */
import { directFromStory, heuristicStory } from '../direct.js';
import type { BrainInput, BrainResult } from '../types.js';
import type { ChatTurn, EditorModel } from './model.js';
import { buildSystemPrompt, buildUserMessage } from './prompt.js';
import { checkStory, mergeStory, STORY_TOOL } from './story.js';

export interface LlmBrainOptions {
  model: EditorModel;
  /** Repair turns after an invalid answer. Default 1. */
  maxRepairs?: number;
}

export interface LlmReport {
  model: string;
  attempts: number;
  /** full: everything accepted · partial: some sentences / the structure fell back · none: heuristic brain. */
  accepted: 'full' | 'partial' | 'none';
  errors: string[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  /** The model's last answer: replay it with `RecordedModel` to re-direct without calling the API. */
  answer?: unknown;
}

/** Output budget: about 150 tokens per sentence plus the scenes. */
const maxTokensFor = (sentences: number) => Math.min(64_000, 2_000 + 150 * sentences);

export async function directEpisodeWithLlm(input: BrainInput, options: LlmBrainOptions): Promise<BrainResult & { llm: LlmReport }> {
  const heuristic = heuristicStory(input);
  const catalogIds = new Set(Object.values(input.assets).filter((a) => a.kind === 'image' || a.kind === 'video' || a.kind === 'svg').map((a) => a.id));
  const catalog = [...catalogIds].map((id) => {
    const entry = input.catalog?.find((c) => c.assetId === id);
    const meta = input.assets[id]!.metadata as { description?: string; tags?: string[] } | undefined;
    const description = [entry?.description ?? meta?.description, ...(entry?.tags ?? meta?.tags ?? [])].filter(Boolean).join('; ') || 'no description';
    return { id, kind: input.assets[id]!.kind, description };
  });
  const system = buildSystemPrompt();
  const turns: ChatTurn[] = [{ role: 'user', text: buildUserMessage(heuristic, { ...(input.title ? { title: input.title } : {}), catalog }) }];
  const report: LlmReport = { model: options.model.id, attempts: 0, accepted: 'none', errors: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  const maxAttempts = 1 + (options.maxRepairs ?? 1);

  let checked: ReturnType<typeof checkStory> | undefined;
  try {
    while (report.attempts < maxAttempts) {
      report.attempts++;
      const response = await options.model.callTool({ system, turns, tool: STORY_TOOL, maxTokens: maxTokensFor(heuristic.units.length) });
      report.model = response.model;
      report.answer = response.input;
      if (response.usage) {
        report.usage.inputTokens += response.usage.inputTokens;
        report.usage.outputTokens += response.usage.outputTokens;
        report.usage.cacheReadTokens += response.usage.cacheReadTokens ?? 0;
        report.usage.cacheWriteTokens += response.usage.cacheWriteTokens ?? 0;
      }
      checked = checkStory(response.input, heuristic, catalogIds);
      report.errors = checked.errors;
      if (!checked.errors.length) break;
      turns.push({ role: 'repair', toolUseId: response.toolUseId, previousInput: response.input, errors: checked.errors });
    }
  } catch (e) {
    const result = directFromStory(input, { ...heuristic, decisions: [...heuristic.decisions, `LLM unavailable (${(e as Error).message}): heuristic brain used`] });
    return { ...result, llm: { ...report, accepted: 'none', errors: [...report.errors, (e as Error).message] } };
  }
  const story = mergeStory(heuristic, checked!, report.model);
  report.accepted = !checked!.errors.length ? 'full' : checked!.sentences.size || checked!.scenes ? 'partial' : 'none';
  const result = directFromStory(input, story);
  result.plan.metadata = { ...result.plan.metadata, editorialModel: report.model };
  // Decisions of an LLM-directed plan are the model's, checked by the rules.
  for (const s of result.plan.shots) if (s.decidedBy === 'rules' && s.metadata?.unit && checked!.sentences.has(String(s.metadata.unit))) s.decidedBy = 'ai';
  return { ...result, llm: report };
}
