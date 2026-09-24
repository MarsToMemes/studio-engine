import { describe, expect, it } from 'vitest';
import {
  buildRemotionPlan,
  compileProject,
  deserializeProject,
  formatIssues,
  getTimelineDuration,
  resolveTimeline,
  sampleProjectFrame,
  sampleScene,
  serializeProject,
  validateProject,
} from '../src/index.js';
import { buildDocumentaryProject, NARRATION_FRAMES, NARRATIVE } from './fixtures/documentary.js';

describe('realistic scenario: 10-scene documentary', () => {
  const project = buildDocumentaryProject();

  it('is a valid project with no errors', () => {
    const result = validateProject(project);
    expect(result.errors, formatIssues(result)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('has the expected structure', () => {
    expect(project.scenes).toHaveLength(10);
    expect(new Set(project.scenes.map((s) => s.type)).size).toBeGreaterThanOrEqual(9);
    const layers = project.scenes.flatMap((s) => s.layers);
    expect(layers.length).toBeGreaterThanOrEqual(30);
    const layerTypes = new Set(layers.map((l) => l.type));
    for (const t of ['video', 'image', 'text', 'caption', 'shape', 'lottie', 'graphic', 'overlay']) expect(layerTypes).toContain(t);
    expect(project.scenes.every((s) => s.voiceover && s.captions && s.captions.cues.length > 0)).toBe(true);
    expect(project.scenes.slice(1).every((s) => s.transitionIn)).toBe(true);
    expect(project.scenes.some((s) => s.animations.length > 0)).toBe(true);
    // Asset library deduplicated the second kitchen.mp4
    expect(Object.values(project.assets).filter((a) => a.src === 'footage/kitchen.mp4')).toHaveLength(1);
  });

  it('lasts exactly the narration length despite overlapping transitions', () => {
    expect(getTimelineDuration(project.scenes)).toBe(NARRATION_FRAMES);
    const timeline = resolveTimeline(project);
    let cursor = 0;
    timeline.scenes.forEach((s, i) => {
      expect(s.startFrame).toBe(cursor); // each scene starts at its narrative start
      expect(s.voiceover!.startFrame).toBe(cursor);
      expect(s.voiceover!.durationInFrames).toBe(NARRATIVE[i]);
      cursor += NARRATIVE[i]!;
    });
    // Voiceover slices are contiguous: no gap, no overlap.
    const vo = timeline.audio.filter((a) => a.role === 'voiceover');
    for (let i = 1; i < vo.length; i++) expect(vo[i]!.startFrame).toBe(vo[i - 1]!.endFrame);
  });

  it('survives a serialization round trip unchanged', () => {
    const json = serializeProject(project);
    const back = deserializeProject(json);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value).toEqual(project);
  });

  it('produces a Remotion plan whose length matches the timeline', () => {
    const plan = buildRemotionPlan(project);
    expect(plan.composition).toMatchObject({ width: 1920, height: 1080, fps: 30, durationInFrames: NARRATION_FRAMES });
    const sequences = plan.series.filter((x) => x.kind === 'sequence');
    const transitions = plan.series.filter((x) => x.kind === 'transition');
    expect(sequences).toHaveLength(10);
    expect(transitions).toHaveLength(9);
    // Same arithmetic as Remotion's <TransitionSeries>.
    const total = sequences.reduce((a, s) => a + s.durationInFrames, 0) - transitions.reduce((a, t) => a + (t.kind === 'transition' ? t.timing.durationInFrames : 0), 0);
    expect(total).toBe(plan.composition.durationInFrames);
    expect(plan.audio.filter((a) => a.role === 'voiceover')).toHaveLength(10);
    expect(plan.audio.find((a) => a.role === 'music')!.envelope.ducking.length).toBeGreaterThan(0);
    expect(new Set(plan.preload.map((p) => p.assetId)).size).toBe(plan.preload.length);
  });

  it('samples every frame without NaN / Infinity in any style', () => {
    const compiled = compileProject(project);
    const bad: string[] = [];
    for (let f = 0; f < compiled.timeline.durationInFrames; f++) {
      const frame = sampleProjectFrame(compiled, f);
      expect(frame.scenes.length).toBeGreaterThan(0);
      for (const s of frame.scenes) {
        for (const style of [s.cameraStyle, ...s.layers.map((l) => l.style)]) {
          for (const [k, v] of Object.entries(style)) if (/NaN|Infinity/.test(String(v))) bad.push(`frame ${f} ${k}=${v}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('shows two scenes during an overlapping transition and one otherwise', () => {
    const compiled = compileProject(project);
    const s1 = compiled.timeline.scenes[1]!;
    expect(sampleProjectFrame(compiled, s1.startFrame + 1).scenes).toHaveLength(2);
    expect(sampleProjectFrame(compiled, s1.startFrame + s1.transitionIn!.durationInFrames + 5).scenes).toHaveLength(1);
  });

  it('plays the edge transitions inside the first and last scenes', () => {
    const compiled = compileProject(project);
    const first = sampleScene(compiled.scenes[0]!, 0, compiled.options);
    expect(first.edgeTransition?.role).toBe('entering');
    expect(first.edgeTransition?.state.entering.opacity).toBe(0);
    const last = compiled.scenes[9]!;
    const end = sampleScene(last, last.timing.durationInFrames - 1, compiled.options);
    expect(end.edgeTransition?.role).toBe('exiting');
  });
});
