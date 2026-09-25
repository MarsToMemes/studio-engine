import { describe, expect, it } from 'vitest';
import { chunkKeyMaterial, compileShotPlan, getTimelineDuration, planRenderChunks, stableStringify, type ShotPlan, type VideoProject } from '../src/index';
import { buildEditorialPlan } from './fixtures/editorial-episode';

const compile = (plan: ShotPlan) => {
  const r = compileShotPlan(plan);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.project as VideoProject;
};
const keys = (project: VideoProject) => {
  const chunks = planRenderChunks(project, { groupSize: 2 });
  return new Map(chunks.map((c) => [c.sceneIds.join('+'), chunkKeyMaterial(project, c, { rendererVersion: 'test' })]));
};

describe('render chunks', () => {
  const project = compile(buildEditorialPlan());

  it('cover the whole video, contiguous, at scene starts', () => {
    const chunks = planRenderChunks(project, { groupSize: 2 });
    expect(chunks[0]!.startFrame).toBe(0);
    expect(chunks[chunks.length - 1]!.endFrame).toBe(getTimelineDuration(project.scenes));
    chunks.slice(1).forEach((c, i) => expect(c.startFrame).toBe(chunks[i]!.endFrame));
    expect(chunks.flatMap((c) => c.sceneIds)).toEqual(project.scenes.map((s) => s.id));
    expect(planRenderChunks(project, { groupSize: 1000, maxScenes: 4 }).every((c) => c.sceneIds.length <= 4)).toBe(true);
  });

  it('a chunk that starts during a transition also depends on the previous scene', () => {
    const chunks = planRenderChunks(project, { groupSize: 1 });
    const intoChapter = chunks.find((c) => c.sceneIds[0] === 'chapter-2')!; // fade into the chapter card
    expect(intoChapter.dependsOn[0]).not.toBe('chapter-2');
    expect(intoChapter.dependsOn).toContain('chapter-2');
    const cut = chunks.find((c) => c.sceneIds[0] === 'counter')!; // hard cut
    expect(cut.dependsOn).toEqual(cut.sceneIds);
  });

  it('editing a shot changes only the chunks that show it', () => {
    const before = keys(project);
    const plan = buildEditorialPlan();
    plan.shots.find((s) => s.id === 'reveal')!.text = 'They own the ground';
    const after = keys(compile(plan));
    const changed = [...before.keys()].filter((k) => before.get(k) !== after.get(k));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((k) => k.includes('reveal') || k.startsWith('billions'))).toBe(true);
  });

  it('a longer earlier shot moves the later chunks in time without changing their keys', () => {
    const before = keys(project);
    const plan = buildEditorialPlan();
    // A consistent edit: the first shot gets 15 frames longer and the voice after it moves with it.
    const end = plan.shots[0]!.durationInFrames;
    plan.shots[0]!.durationInFrames += 15;
    for (const s of plan.narration!.segments!) if (s.startFrame >= end) s.startFrame += 15;
    const after = keys(compile(plan));
    const late = [...before.keys()].filter((k) => k.includes('conclusion'));
    expect(late.length).toBe(1);
    expect(after.get(late[0]!)).toBe(before.get(late[0]!));
    // Without moving the voice, the words land elsewhere in the later shots: their keys change (a real change of pixels).
    const drift = buildEditorialPlan();
    drift.shots[0]!.durationInFrames += 15;
    expect(keys(compile(drift)).get(late[0]!)).not.toBe(before.get(late[0]!));
  });

  it('keys are independent of key order and change with the renderer and the assets', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe(stableStringify({ a: [{ d: 2 }], b: 1 }));
    const c = planRenderChunks(project)[0]!;
    const base = chunkKeyMaterial(project, c, { rendererVersion: 'v1' });
    expect(chunkKeyMaterial(project, c, { rendererVersion: 'v2' })).not.toBe(base);
    expect(chunkKeyMaterial(project, c, { rendererVersion: 'v1', assetFingerprint: () => 'changed' })).not.toBe(base);
    expect(chunkKeyMaterial(project, c, { rendererVersion: 'v1', settings: { scale: 0.5 } })).not.toBe(base);
  });
});
