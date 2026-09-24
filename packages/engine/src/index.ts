/**
 * @studio-engine/scene-engine
 *
 * Framework-agnostic scene engine for an AI video editor:
 *   model → validation → timing → animation / transitions → renderer → Remotion plan
 * See SCENE_ENGINE.md for the architecture.
 */
export type * from './model/index.js';
export * from './model/constants.js';
export * from './core/index.js';
export * from './assets/index.js';
export * from './timing/index.js';
export * from './animation/index.js';
export * from './transitions/index.js';
export * from './presets/index.js';
export * from './validation/index.js';
export * from './serialization/index.js';
export * from './renderer/index.js';
export * from './adapters/remotion/index.js';
export * from './ai/index.js';
export * from './shotplan/index.js';
export * from './skills/index.js';
export * from './bible/index.js';
