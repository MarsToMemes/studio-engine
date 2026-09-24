/**
 * Public entry of @studio-engine/remotion for apps (Player preview, editor).
 * `src/index.ts` is the Remotion bundler entry (registerRoot) and must not be
 * imported by applications.
 */
export { EngineComposition, type EngineCompositionProps } from './EngineComposition';
export { shotPlanDemo, buildShotPlanDemoProject } from './shotPlanDemo';
export { resolveSrc } from './assets';
