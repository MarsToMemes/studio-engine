/**
 * CLI core for external pipelines (e.g. a Python `montage.py` calling
 * `node shotplan.mjs timeline plan.json` through subprocess).
 * Pure function: I/O is injected so it is testable.
 *
 *   shotplan validate <plan.json|->   issues as JSON, exit 1 on errors
 *
 * Option `--stage=final` (any command): blocking editorial rules (intent,
 * reasons, scenes, hierarchy, licenses) become errors. Default: draft.
 *   shotplan timeline <plan.json|->   flat Timeline JSON (derived start frames)
 *   shotplan compile  <plan.json|->   VideoProject document (studio-engine/project)
 */
import { serializeProject } from '../serialization/serialize.js';
import { compileShotPlan } from './compile.js';
import { toTimeline } from './timeline.js';
import type { ShotPlan } from './types.js';
import { validateShotPlan } from './validate.js';
import { defaultMotionSkillRegistry } from '../skills/index.js';

export interface CliIo {
  readInput: (pathOrDash: string) => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const SHOTPLAN_CLI_USAGE = 'usage: shotplan <validate|timeline|compile> <plan.json|-> [--stage=draft|final]';

/** Returns the process exit code. */
export function runShotPlanCli(args: readonly string[], io: CliIo): number {
  const stageArg = args.find((a) => a.startsWith('--stage='))?.slice('--stage='.length);
  const [command, input] = args.filter((a) => !a.startsWith('--'));
  if (!command || !input || !['validate', 'timeline', 'compile'].includes(command) || (stageArg !== undefined && stageArg !== 'draft' && stageArg !== 'final')) {
    io.stderr(SHOTPLAN_CLI_USAGE);
    return 2;
  }
  let plan: unknown;
  try {
    plan = JSON.parse(io.readInput(input));
  } catch (e) {
    io.stderr(`cannot read plan: ${(e as Error).message}`);
    return 2;
  }
  const stage = stageArg === 'final' ? 'final' : 'draft';
  const validation = validateShotPlan(plan, { stage, skillIds: defaultMotionSkillRegistry.availableIds(), skillCatalog: defaultMotionSkillRegistry });
  if (command === 'validate') {
    io.stdout(JSON.stringify({ valid: validation.valid, errors: validation.errors, warnings: validation.warnings }, null, 2));
    return validation.valid ? 0 : 1;
  }
  if (!validation.valid) {
    io.stderr(JSON.stringify({ valid: false, errors: validation.errors }, null, 2));
    return 1;
  }
  if (command === 'timeline') {
    io.stdout(JSON.stringify(toTimeline(plan as ShotPlan), null, 2));
    return 0;
  }
  const result = compileShotPlan(plan as ShotPlan, { stage });
  if (!result.ok) {
    io.stderr(JSON.stringify({ valid: false, errors: result.errors }, null, 2));
    return 1;
  }
  for (const note of result.notes) io.stderr(`note: ${note}`);
  io.stdout(serializeProject(result.project, { pretty: true }));
  return 0;
}
