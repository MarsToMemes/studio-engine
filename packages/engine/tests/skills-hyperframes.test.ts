import { describe, expect, it } from 'vitest';
import { compileProject, compileShotPlan, evaluateNative, sampleScene, type Shot, type ShotPlan, type VideoProject } from '../src/index';
import { buildEpisodePlan } from './fixtures/shotplan-episode';

function run(shot: Shot) {
  const plan: ShotPlan = { ...buildEpisodePlan(), narration: undefined, captions: undefined, music: undefined, shots: [shot] };
  const r = compileShotPlan(plan);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const scene = r.project.scenes[0]!;
  return { scene, extra: scene.metadata!.extra!, project: r.project as VideoProject };
}
const layer = (scene: { layers: Array<{ id: string }> }, suffix: string) => scene.layers.find((l) => l.id.endsWith(suffix)) as Record<string, any> | undefined;
const text = (t: string, skill: string, extra: Partial<Shot> = {}): Shot => ({ id: 's', type: 'text', durationInFrames: 90, text: t, motionSkill: skill, ...extra });

describe('HyperFrames motion pack', () => {
  it('count_scale: the counter grows with the count, same timing', () => {
    const { scene, extra } = run({ id: 'n', type: 'number', durationInFrames: 90, number: { value: 61, suffix: '%', label: 'of revenue' }, motionSkill: 'count_scale' });
    expect(extra.appliedSkill).toBe('count_scale');
    const counter = layer(scene, ':number')!;
    const kf = counter.animations.find((a: any) => a.type === 'keyframes');
    expect(kf.durationInFrames).toBe(counter.data.countDurationInFrames);
    expect(kf.tracks[0].keyframes[0].value).toBeLessThan(1);
  });

  it('keyword_glow: a glow copy that shows only the key words, lit when they are spoken', () => {
    const { scene, extra } = run(text('They own the LAND', 'keyword_glow', { highlightedWords: ['LAND'] }));
    expect(extra.appliedSkill).toBe('keyword_glow');
    const glow = layer(scene, ':glow')!;
    expect(glow.style.color).toBe('rgba(0,0,0,0)');
    const opacity = glow.animations.at(-1).tracks.find((t: any) => t.property === 'opacity').keyframes;
    const frames = opacity.map((k: any) => k.frame);
    expect(frames).toEqual([...frames].sort((a: number, b: number) => a - b));
    expect(Math.max(...opacity.map((k: any) => k.value))).toBe(1);
    expect(opacity[0].value).toBe(0);
    // Without a key word there is nothing to glow: fallback.
    expect(run(text('They own the land', 'keyword_glow')).extra.appliedSkill).not.toBe('keyword_glow');
  });

  it('depth_layers: copies stacked diagonally behind, alpha stepping down, built from the back', () => {
    const { scene } = run(text('They own the land', 'depth_layers', { intensity: 'medium' }));
    const copies = scene.layers.filter((l) => l.id.includes(':depth-'));
    expect(copies).toHaveLength(6);
    const alpha = (l: any) => Number(/, ([\d.]+)\)$/.exec(l.style.color)![1]);
    const byIndex = [...copies].sort((a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop()));
    expect(alpha(byIndex[0])).toBeGreaterThan(alpha(byIndex[5]));
    expect(copies.every((c) => c.zIndex < layer(scene, ':text')!.zIndex)).toBe(true);
  });

  it('rack_focus: words over the picture → the picture blurs and dims; a bare image racks to sharp', () => {
    const withWords = run({ id: 'i', type: 'image', media: 'landscape', durationInFrames: 120, text: 'Behind every counter', motionSkill: 'rack_focus' });
    const blur = layer(withWords.scene, ':media')!.animations.find((a: any) => a.type === 'keyframes').tracks.find((t: any) => t.property === 'blur').keyframes;
    expect(blur.at(-1).value).toBeGreaterThan(blur[0].value);
    const bare = run({ id: 'i', type: 'image', media: 'landscape', durationInFrames: 120, motionSkill: 'rack_focus' });
    const blur2 = layer(bare.scene, ':media')!.animations.find((a: any) => a.type === 'keyframes').tracks[0].keyframes;
    expect(blur2.at(-1).value).toBe(0);
  });

  it('scatter_assemble and beat_slam use per-word variations, deterministic, landing clean', () => {
    const ctx = (index: number, frame: number) => ({ frame, window: { startFrame: 0, endFrame: 30, durationInFrames: 30, iterations: 1 }, unit: { index, count: 4 }, box: { width: 1600, height: 300 } }) as never;
    const scatter = { type: 'kineticTypography', style: 'scatter', split: 'words', each: 0, durationInFrames: 30 } as const;
    const a0 = evaluateNative(scatter, ctx(0, 0));
    const a1 = evaluateNative(scatter, ctx(1, 0));
    expect(a0).not.toEqual(a1); // each word has its own cloud point
    expect(evaluateNative(scatter, ctx(1, 0))).toEqual(a1); // same input, same state
    const end = evaluateNative(scatter, ctx(2, 30)) as Record<string, number>;
    for (const k of ['x', 'y', 'rotation', 'blur']) expect(Math.abs(end[k]!)).toBeLessThan(1e-6);
    const beat = { type: 'kineticTypography', style: 'beat', split: 'words', each: 0, durationInFrames: 12 } as const;
    const kinds = [0, 1, 2].map((i) => Object.keys(evaluateNative(beat, ctx(i, 2))).sort().join());
    expect(new Set(kinds).size).toBe(3); // slam, side-snap, rise: three different entrances
    const { scene } = run(text('They own the land', 'beat_slam'));
    expect(layer(scene, ':text')!.animations).toContainEqual(expect.objectContaining({ type: 'kineticTypography', style: 'beat' }));
  });

  it('glow_bloom stays under 0.45 opacity; phase_camera settles, holds, pushes, with drift', () => {
    const { scene, project } = run({ id: 'n', type: 'number', durationInFrames: 120, number: { value: 9.8, prefix: '$', suffix: 'B', decimals: 1 }, motionSkill: 'glow_bloom', intensity: 'strong' });
    const bloom = layer(scene, ':bloom')!;
    const op = bloom.animations[0].tracks.find((t: any) => t.property === 'opacity').keyframes;
    expect(Math.max(...op.map((k: any) => k.value))).toBeLessThanOrEqual(0.45 * 1.12 + 1e-9);
    const cp = compileProject(project);
    expect(() => sampleScene(cp.scenes[0]!, 60, cp.options)).not.toThrow();
    const cam = run({ id: 'i', type: 'image', media: 'landscape', durationInFrames: 150, motionSkill: 'phase_camera' });
    const tracks = layer(cam.scene, ':media')!.animations.find((a: any) => a.type === 'keyframes').tracks;
    const scale = tracks.find((t: any) => t.property === 'scale').keyframes.map((k: any) => k.value);
    expect(scale[0]).toBeGreaterThan(1);
    expect(scale[1]).toBe(1);
    expect(scale.at(-1)).toBeGreaterThan(1);
    expect(tracks.map((t: any) => t.property).sort()).toEqual(['scale', 'x', 'y']);
  });
});
