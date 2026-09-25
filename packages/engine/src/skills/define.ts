import type { SkillDefinition, SkillImplementation } from './types.js';

type Defaulted = 'version' | 'parameters' | 'events' | 'fallback' | 'controlsCamera' | 'defaultDuration' | 'family' | 'implementation';
type SkillInit = Omit<SkillDefinition, Defaulted> & Partial<Pick<SkillDefinition, Defaulted>>;

/** Categories whose skills move the media or the scene (camera). */
const CAMERA_CATEGORIES = new Set(['images', 'documents', 'maps']);

function implementationOf(init: SkillInit): SkillImplementation {
  const kinds = init.requires?.graphicKinds ?? [];
  if (kinds.includes('mapTiles')) return 'maplibre';
  return kinds.length ? 'svg' : 'remotion';
}

export const defineSkill = (init: SkillInit): SkillDefinition => ({
  version: 1,
  parameters: {},
  events: [],
  fallback: [],
  controlsCamera: CAMERA_CATEGORIES.has(init.category),
  defaultDuration: Math.round(((init.duration.min + init.duration.max) / 2) * 10) / 10,
  family: init.id,
  implementation: implementationOf(init),
  ...init,
});
