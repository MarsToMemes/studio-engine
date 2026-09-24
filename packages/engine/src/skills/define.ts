import type { SkillDefinition } from './types.js';

type SkillInit = Omit<SkillDefinition, 'version' | 'parameters' | 'events' | 'fallback'> & Partial<Pick<SkillDefinition, 'version' | 'parameters' | 'events' | 'fallback'>>;

export const defineSkill = (init: SkillInit): SkillDefinition => ({ version: 1, parameters: {}, events: [], fallback: [], ...init });
