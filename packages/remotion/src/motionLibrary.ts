/** Every available motion skill demonstrated on its canonical shot, one after the other. */
import { compileShotPlan, defaultMotionSkillRegistry, skillGalleryPlan, type VideoProject } from '@studio-engine/scene-engine';

export function buildMotionLibraryProject(): VideoProject {
  const result = compileShotPlan(skillGalleryPlan(defaultMotionSkillRegistry), { projectId: 'motion-library', name: 'MotionLibrary' });
  if (!result.ok) throw new Error(`MotionLibrary does not compile:\n${result.errors.map((e) => `${e.path}: ${e.message}`).join('\n')}`);
  return result.project;
}
