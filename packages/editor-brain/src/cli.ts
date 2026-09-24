/**
 * CLI core for external pipelines (e.g. `montage.py` through subprocess):
 *
 *   editor-brain direct <input.json|->            full result as JSON (plan, analysis, structure, requests, decisions, qc)
 *   editor-brain direct <input.json|-> --plan     only the ShotPlan v2
 *
 * Exit code: 0 when the plan passes the final validation, 1 when it does not
 * (the JSON still explains why), 2 on bad usage or unreadable input.
 */
import { directEpisode } from './direct.js';
import type { BrainInput } from './types.js';

export interface BrainCliIo {
  readInput: (pathOrDash: string) => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const BRAIN_CLI_USAGE = 'usage: editor-brain direct <input.json|-> [--plan]';

export function runBrainCli(args: readonly string[], io: BrainCliIo): number {
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
  let result;
  try {
    result = directEpisode(brainInput);
  } catch (e) {
    io.stderr(`editor brain failed: ${(e as Error).message}`);
    return 2;
  }
  for (const d of result.decisions) io.stderr(`decision: ${d}`);
  for (const r of result.assetRequests) io.stderr(`needs ${r.need} (${r.unitId}): ${r.description}`);
  io.stdout(JSON.stringify(args.includes('--plan') ? result.plan : result, null, 2));
  return result.qc.valid ? 0 : 1;
}
