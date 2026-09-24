/**
 * CLI core for external pipelines (e.g. `montage.py` through subprocess):
 *
 *   editor-brain direct <input.json|->            full result as JSON (plan, analysis, structure, requests, decisions, qc)
 *   editor-brain direct <input.json|-> --plan     only the ShotPlan v2
 *   editor-brain direct <input.json|-> --llm      the editorial story is written by Claude (ANTHROPIC_API_KEY),
 *                                                 checked by the rules; --model=<id> to choose the model
 *
 * Without a key (or if the API fails) the heuristic brain directs and says so.
 *
 * Exit code: 0 when the plan passes the final validation, 1 when it does not
 * (the JSON still explains why), 2 on bad usage or unreadable input.
 */
import { directEpisode } from './direct.js';
import { directEpisodeWithLlm, type LlmReport } from './llm/direct.js';
import { AnthropicModel, type EditorModel } from './llm/model.js';
import type { BrainInput, BrainResult } from './types.js';

export interface BrainCliIo {
  readInput: (pathOrDash: string) => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const BRAIN_CLI_USAGE = 'usage: editor-brain direct <input.json|-> [--plan] [--llm [--model=<id>]]';

export interface BrainCliOptions {
  /** Model used by --llm. Default: Claude through the official SDK (needs ANTHROPIC_API_KEY). */
  model?: EditorModel;
  env?: Record<string, string | undefined>;
}

export async function runBrainCli(args: readonly string[], io: BrainCliIo, options: BrainCliOptions = {}): Promise<number> {
  const [command, input] = args.filter((a) => !a.startsWith('--'));
  if (command !== 'direct' || !input) {
    io.stderr(BRAIN_CLI_USAGE);
    return 2;
  }
  let brainInput: BrainInput;
  try {
    brainInput = JSON.parse(io.readInput(input)) as BrainInput;
    if (!Array.isArray(brainInput.script) || typeof brainInput.assets !== 'object') throw new Error('input needs "script" (array) and "assets" (object)');
  } catch (e) {
    io.stderr(`cannot read input: ${(e as Error).message}`);
    return 2;
  }
  let result: BrainResult & { llm?: LlmReport };
  try {
    if (args.includes('--llm')) {
      const env = options.env ?? process.env;
      const modelId = args.find((a) => a.startsWith('--model='))?.slice('--model='.length);
      if (!options.model && !env.ANTHROPIC_API_KEY) {
        io.stderr('ANTHROPIC_API_KEY is not set: the heuristic brain directs this episode');
        result = directEpisode(brainInput);
      } else {
        result = await directEpisodeWithLlm(brainInput, { model: options.model ?? new AnthropicModel(modelId ? { model: modelId } : {}) });
        const u = result.llm!.usage;
        io.stderr(`llm: ${result.llm!.model}, ${result.llm!.accepted}, ${result.llm!.attempts} call(s), ${u.inputTokens} in / ${u.outputTokens} out tokens (${u.cacheReadTokens} cached)`);
      }
    } else result = directEpisode(brainInput);
  } catch (e) {
    io.stderr(`editor brain failed: ${(e as Error).message}`);
    return 2;
  }
  for (const d of result.decisions) io.stderr(`decision: ${d}`);
  for (const r of result.assetRequests) io.stderr(`needs ${r.need} (${r.unitId}): ${r.description}`);
  io.stdout(JSON.stringify(args.includes('--plan') ? result.plan : result, null, 2));
  return result.qc.valid ? 0 : 1;
}
