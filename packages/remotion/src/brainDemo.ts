/**
 * The editor brain's McDonald's example, directed end to end (script +
 * transcript + catalogue → ShotPlan v2) and compiled by the engine.
 */
import { directEpisode, mcdonaldsExample } from '@studio-engine/editor-brain';
import { compileShotPlan, type VideoProject } from '@studio-engine/scene-engine';

export function buildBrainDemoProject(): VideoProject {
  const { plan, qc } = directEpisode(mcdonaldsExample());
  if (!qc.valid) throw new Error(`BrainDemo plan is not final-valid:\n${qc.errors.map((e) => `${e.path}: ${e.message}`).join('\n')}`);
  const result = compileShotPlan(plan, { projectId: 'brain-demo', name: 'BrainDemo' });
  if (!result.ok) throw new Error(`BrainDemo does not compile:\n${result.errors.map((e) => `${e.path}: ${e.message}`).join('\n')}`);
  return result.project;
}
