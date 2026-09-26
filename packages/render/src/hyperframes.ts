/**
 * HyperFrames catalog for Node callers: the committed catalog of the engine
 * package, and the public/hyperframes tree the Remotion pages load.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { HyperFramesCatalog, ShotPlan, VideoProject } from '@studio-engine/scene-engine';

const require = createRequire(import.meta.url);
let cached: HyperFramesCatalog | undefined;

export function loadHyperFramesCatalog(): HyperFramesCatalog {
  cached ??= JSON.parse(readFileSync(require.resolve('@studio-engine/scene-engine/hyperframes-catalog.json'), 'utf8')) as HyperFramesCatalog;
  return cached;
}

export function planUsesHyperFrames(plan: ShotPlan): boolean {
  return plan.shots.some((s) => s.block || s.overlays?.length);
}

export function projectUsesHyperFrames(project: VideoProject): boolean {
  return project.scenes.some((s) => s.layers.some((l) => l.type === 'graphic' && l.kind === 'hyperframes'));
}

/** Why a project with HyperFrames layers cannot render from `publicDir`, or undefined. */
export function hyperframesMissing(project: VideoProject, publicDir: string | undefined): string | undefined {
  if (!projectUsesHyperFrames(project)) return undefined;
  if (publicDir && existsSync(join(publicDir, 'hyperframes', 'hyperframe.runtime.js'))) return undefined;
  return `the plan uses HyperFrames items but ${publicDir ?? 'the public dir'}/hyperframes is missing: run "npm run hyperframes:sync -w @studio-engine/remotion"`;
}
