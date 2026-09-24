import { DATA_SKILLS } from './data.js';
import { DOCUMENT_SKILLS } from './documents.js';
import { EDITORIAL_SKILLS } from './editorial.js';
import { IMAGE_SKILLS } from './images.js';
import { MAP_SKILLS } from './maps.js';
import { NUMBER_SKILLS } from './numbers.js';
import { MotionSkillRegistry, type RendererCapabilities } from './registry.js';
import { REVEAL_SKILLS } from './reveals.js';
import { TEXT_SKILLS } from './text.js';
import type { SkillDefinition } from './types.js';

export * from './types.js';
export * from './registry.js';
export { defineSkill } from './define.js';

export const BUILT_IN_SKILLS: readonly SkillDefinition[] = [
  ...TEXT_SKILLS,
  ...NUMBER_SKILLS,
  ...IMAGE_SKILLS,
  ...DOCUMENT_SKILLS,
  ...DATA_SKILLS,
  ...MAP_SKILLS,
  ...REVEAL_SKILLS,
  ...EDITORIAL_SKILLS,
];

/** Fallback chains of every built-in skill, usable even where a skill is not installed. */
export const BUILT_IN_SKILL_FALLBACKS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(BUILT_IN_SKILLS.map((s) => [s.id, s.fallback]));

/** Built-in skills, available according to the given renderer capabilities. */
export function createMotionSkillRegistry(capabilities?: RendererCapabilities, definitions: readonly SkillDefinition[] = BUILT_IN_SKILLS): MotionSkillRegistry {
  return new MotionSkillRegistry(definitions, capabilities, BUILT_IN_SKILL_FALLBACKS);
}

/** Built-in skills with the reference Remotion renderer's capabilities. */
export const defaultMotionSkillRegistry = createMotionSkillRegistry();

/** Convenience for AI agents: metadata of every skill that can actually be rendered. */
export function getAvailableMotionSkills(filter?: Parameters<MotionSkillRegistry['getAvailableMotionSkills']>[0]) {
  return defaultMotionSkillRegistry.getAvailableMotionSkills(filter);
}
