/**
 * CLI core for external pipelines (e.g. `montage.py` through subprocess):
 *
 *   editor-brain direct <input.json|->            full result as JSON (plan, analysis, structure, requests, decisions, qc)
 *   editor-brain direct <input.json|-> --plan     only the ShotPlan v2
 *   editor-brain direct <input.json|-> --style apple   studio blocks timed to the voice (SCENE_ENGINE.md §28.1)
 *   editor-brain direct <input.json|-> --llm      the editorial story is written by Claude (ANTHROPIC_API_KEY),
 *                                                 checked by the rules; --model=<id> to choose the model
 *
 * Without a key (or if the API fails) the heuristic brain directs and says so.
 *
 *   editor-brain critique <plan.json|-> [--stills=<dir>] [--model=<id>]
 *                                                 editorial review of the REVUE rules by Claude, as JSON
 *                                                 (input of `qc.mjs --review`); stills from `qc.mjs --frames-dir`
 *
 * critique exit code: 0 review done, 1 review pending (no key, API failure: the JSON says why), 2 bad input.
 *
 * Exit code: 0 when the plan passes the final validation, 1 when it does not
 * (the JSON still explains why), 2 on bad usage or unreadable input.
 */
import { directEpisode } from './direct.js';
import type { ShotPlan } from '@studio-engine/scene-engine';
import { critiqueEpisode } from './llm/critic.js';
import { directEpisodeWithLlm, type LlmReport } from './llm/direct.js';
import { AnthropicModel, type EditorModel } from './llm/model.js';
import type { BrainInput, BrainResult } from './types.js';

export interface BrainCliIo {
  readInput: (pathOrDash: string) => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Images of a directory as base64, by file name (for `critique --stills`). */
  readStills?: (dir: string) => Array<{ name: string; data: string }>;
}

export const BRAIN_CLI_USAGE = 'usage: editor-brain direct <input.json|-> [--plan] [--style apple|default] [--llm [--model=<id>]]\n       editor-brain critique <plan.json|-> [--stills=<dir>] [--model=<id>]';

export interface BrainCliOptions {
  /** Model used by --llm. Default: Claude through the official SDK (needs ANTHROPIC_API_KEY). */
  model?: EditorModel;
  env?: Record<string, string | undefined>;
}

export async function runBrainCli(args: readonly string[], io: BrainCliIo, options: BrainCliOptions = {}): Promise<number> {
  // --style takes a value ("--style apple" or "--style=apple").
  const styleAt = args.indexOf('--style');
  const style = args.find((a) => a.startsWith('--style='))?.slice('--style='.length) ?? (styleAt >= 0 ? args[styleAt + 1] : undefined);
  const [command, input] = args.filter((a, i) => !a.startsWith('--') && !(styleAt >= 0 && i === styleAt + 1));
  if (style !== undefined && style !== 'apple' && style !== 'default') {
    io.stderr(`unknown style "${style}" (apple or default)`);
    return 2;
  }
  if (command === 'critique' && input) return runCritique(input, args, io, options);
  if (command !== 'direct' || !input) {
    io.stderr(BRAIN_CLI_USAGE);
    return 2;
  }
  let brainInput: BrainInput;
  try {
    brainInput = JSON.parse(io.readInput(input)) as BrainInput;
    if (!Array.isArray(brainInput.script) || typeof brainInput.assets !== 'object') throw new Error('input needs "script" (array) and "assets" (object)');
    if (style) brainInput.style = style as 'apple' | 'default';
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

async function runCritique(input: string, args: readonly string[], io: BrainCliIo, options: BrainCliOptions): Promise<number> {
  let plan: ShotPlan;
  try {
    const raw = JSON.parse(io.readInput(input)) as ShotPlan & { plan?: ShotPlan };
    plan = raw.shots ? raw : raw.plan!;
    if (!Array.isArray(plan?.shots)) throw new Error('not a ShotPlan (needs "shots")');
  } catch (e) {
    io.stderr(`cannot read plan: ${(e as Error).message}`);
    return 2;
  }
  const env = options.env ?? process.env;
  if (!options.model && !env.ANTHROPIC_API_KEY) {
    io.stderr('ANTHROPIC_API_KEY is not set: the review stays pending (review the REVUE rules by hand)');
    io.stdout(JSON.stringify({ status: 'pending', reason: 'ANTHROPIC_API_KEY is not set' }, null, 2));
    return 1;
  }
  const stillsDir = args.find((a) => a.startsWith('--stills='))?.slice('--stills='.length);
  const stills = stillsDir && io.readStills
    ? io.readStills(stillsDir).map((f) => ({
        shotId: f.name.replace(/\.(jpe?g|png)$/i, '').replace(/^\d+-/, ''),
        mediaType: (/\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg',
        data: f.data,
      }))
    : [];
  const modelId = args.find((a) => a.startsWith('--model='))?.slice('--model='.length);
  const { review, report } = await critiqueEpisode(plan, { model: options.model ?? new AnthropicModel(modelId ? { model: modelId } : {}), stills });
  const u = report.usage;
  io.stderr(`critic: ${report.model}, ${review.status}, ${report.attempts} call(s), ${report.stills} still(s), ${u.inputTokens} in / ${u.outputTokens} out tokens`);
  for (const e of report.errors) io.stderr(`critic: dropped ${e}`);
  io.stdout(JSON.stringify({ ...review, llm: report }, null, 2));
  return review.status === 'done' ? 0 : 1;
}
