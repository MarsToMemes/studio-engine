import type { SkillDefinition } from './types.js';

type Defaulted = 'version' | 'parameters' | 'events' | 'fallback' | 'controlsCamera';
type SkillInit = Omit<SkillDefinition, Defaulted> & Partial<Pick<SkillDefinition, Defaulted>>;

/** Categories whose skills move the media or the scene (camera). */
const CAMERA_CATEGORIES = new Set(['images', 'documents', 'maps']);

export const defineSkill = (init: SkillInit): SkillDefinition => ({ version: 1, parameters: {}, events: [], fallback: [], controlsCamera: CAMERA_CATEGORIES.has(init.category), ...init });
