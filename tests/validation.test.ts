import { describe, expect, it } from 'vitest';
import {
  AnimationProviderRegistry,
  assertValidProject,
  createExternalProvider,
  createLayer,
  formatIssues,
  SceneValidationError,
  validateProject,
  validateScene,
  type VideoProject,
} from '../src/index.js';
import { codes, simpleProject } from './helpers.js';

const errorsOf = (p: unknown) => codes(validateProject(p).errors);
const warningsOf = (p: unknown) => codes(validateProject(p).warnings);
const mutate = (fn: (p: VideoProject) => void) => {
  const p = simpleProject([90, 60]);
  fn(p);
  return p;
};

describe('project validation', () => {
  it('accepts a minimal valid project', () => {
    const r = validateProject(simpleProject([90, 60]));
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(formatIssues(r)).toBe('OK');
  });

  it('rejects non-objects and broken top-level fields', () => {
    expect(errorsOf(null)).toEqual(['project.invalid']);
    expect(errorsOf(mutate((p) => void (p.fps = 0)))).toContain('project.fps.invalid');
    expect(errorsOf(mutate((p) => void (p.schemaVersion = 99)))).toContain('project.schema.future');
    expect(errorsOf(mutate((p) => void (p.aspectRatio = 'wide')))).toContain('project.aspectRatio.invalid');
    expect(errorsOf(mutate((p) => void ((p as unknown as Record<string, unknown>).scenes = 'nope')))).toContain('project.scenes.invalid');
    expect(warningsOf(mutate((p) => void (p.dimensions = { width: 1921, height: 1080 })))).toEqual(['project.dimensions.odd']);
    expect(warningsOf(mutate((p) => void (p.dimensions = { width: 1920, height: 1200 })))).toEqual(['project.aspectRatio.mismatch']);
  });

  it('detects duplicate ids', () => {
    expect(errorsOf(mutate((p) => void (p.scenes[1]!.id = p.scenes[0]!.id)))).toContain('scene.id.duplicate');
    expect(errorsOf(mutate((p) => void p.scenes[0]!.layers.push({ ...p.scenes[0]!.layers[0]! })))).toContain('layer.id.duplicate');
  });

  it('checks asset references and kinds', () => {
    const missing = mutate((p) => void p.scenes[0]!.layers.push(createLayer('video', { assetId: 'nope', fit: 'cover' })));
    expect(errorsOf(missing)).toContain('asset.missing');
    const wrongKind = mutate((p) => {
      p.assets = { a: { id: 'a', kind: 'audio', src: 'a.mp3' } };
      p.scenes[0]!.layers.push(createLayer('image', { assetId: 'a', fit: 'cover' }));
    });
    expect(errorsOf(wrongKind)).toContain('asset.kind.mismatch');
    const badKey = mutate((p) => void (p.assets = { a: { id: 'b', kind: 'image', src: 'x' } }));
    expect(errorsOf(badKey)).toContain('asset.id.mismatch');
  });

  it('validates timing fields as integer frames', () => {
    expect(errorsOf(mutate((p) => void (p.scenes[0]!.durationInFrames = 0)))).toContain('frame.invalid');
    expect(errorsOf(mutate((p) => void (p.scenes[0]!.durationInFrames = 1.5)))).toContain('frame.invalid');
    expect(errorsOf(mutate((p) => void (p.scenes[0]!.layers[0]!.startFrame = -1)))).toContain('frame.invalid');
    expect(errorsOf(mutate((p) => void (p.scenes[0]!.fps = 60)))).toContain('scene.fps.mismatch');
  });

  it('checks transitions against their neighbours', () => {
    const tooLong = mutate((p) => void (p.scenes[1]!.transitionIn = { type: 'crossfade', durationInFrames: 70 }));
    expect(errorsOf(tooLong)).toContain('transition.tooLong');
    const unknown = mutate((p) => void (p.scenes[1]!.transitionIn = { type: 'teleport', durationInFrames: 10 }));
    expect(errorsOf(unknown)).toContain('transition.type.unknown');
    const both = mutate((p) => {
      p.scenes[0]!.transitionOut = { type: 'crossfade', durationInFrames: 10 };
      p.scenes[1]!.transitionIn = { type: 'wipe', durationInFrames: 10 };
    });
    expect(warningsOf(both)).toContain('transition.conflict');
    const squeezed = simpleProject([90, 20, 90], [undefined, { type: 'crossfade', durationInFrames: 15 }, { type: 'crossfade', durationInFrames: 15 }]);
    expect(errorsOf(squeezed)).toContain('transition.overlap.exceeds');
  });

  it('warns about stale declared start frames', () => {
    expect(warningsOf(mutate((p) => void (p.scenes[1]!.startFrame = 10)))).toContain('scene.startFrame.stale');
    expect(warningsOf(mutate((p) => void (p.scenes[1]!.startFrame = 90)))).not.toContain('scene.startFrame.stale');
  });

  it('checks layer ranges and payloads', () => {
    const layer = (patch: Record<string, unknown>) => mutate((p) => Object.assign(p.scenes[0]!.layers[0]!, patch));
    expect(errorsOf(layer({ opacity: 2 }))).toContain('layer.opacity.invalid');
    expect(errorsOf(layer({ scale: 'big' }))).toContain('layer.scale.invalid');
    expect(errorsOf(layer({ position: { anchor: 'middle', x: 0, y: 0, units: 'px' } }))).toContain('layer.anchor.invalid');
    expect(errorsOf(layer({ crop: { top: 0, right: 60, bottom: 0, left: 50, units: 'percent' } }))).toContain('layer.crop.empty');
    expect(errorsOf(layer({ blendMode: 'add' }))).toContain('layer.blendMode.invalid');
    expect(errorsOf(layer({ shape: 'star' }))).toContain('layer.shape.invalid');
    expect(warningsOf(layer({ startFrame: 200 }))).toContain('layer.never.visible');
    expect(warningsOf(layer({ startFrame: 80, durationInFrames: 40 }))).toContain('layer.clipped');
  });

  it('checks lottie, caption and graphic layers', () => {
    const add = (l: unknown) => mutate((p) => void p.scenes[0]!.layers.push(l as never));
    expect(errorsOf(add(createLayer('lottie', { source: { kind: 'url', url: '', format: 'json' } })))).toContain('layer.lottie.url');
    expect(errorsOf(add(createLayer('lottie', { source: { kind: 'inline', data: {} }, lottieStartFrame: 50, lottieEndFrame: 10 })))).toContain('layer.lottie.range');
    expect(errorsOf(add(createLayer('caption', { trackId: 'ghost', style: { mode: 'word', text: {} } })))).toContain('layer.caption.track');
    expect(warningsOf(add(createLayer('caption', { style: { mode: 'word', text: {} } })))).toContain('layer.caption.noTrack');
    expect(errorsOf(add(createLayer('graphic', { kind: 'hologram' as never, data: {} })))).toContain('layer.graphic.kind');
  });

  it('checks animations', () => {
    const anim = (a: unknown) => mutate((p) => void (p.scenes[0]!.layers[0]!.animations = [a as never]));
    expect(errorsOf(anim({ type: 'teleport' }))).toContain('animation.type.unknown');
    expect(errorsOf(anim({ type: 'fade', easing: 'wobbly' }))).toContain('easing.unknown');
    expect(errorsOf(anim({ type: 'fade', easing: { type: 'cubicBezier', points: [2, 0, 0, 1] } }))).toContain('easing.bezier.range');
    expect(errorsOf(anim({ type: 'fade', repeat: Infinity }))).toContain('animation.repeat.invalid');
    expect(errorsOf(anim({ type: 'slide', direction: 'north' }))).toContain('animation.direction.invalid');
    expect(errorsOf(anim({ type: 'keyframes', tracks: [{ property: 'scale', keyframes: [{ frame: 10, value: 1 }, { frame: 5, value: 2 }] }] }))).toContain('animation.keyframe.order');
    expect(errorsOf(anim({ type: 'stagger', each: 2, animation: { type: 'stagger', each: 1, animation: { type: 'fade' } } }))).toContain('animation.stagger.nested');
    expect(warningsOf(anim({ type: 'custom', name: 'x' }))).toContain('animation.custom.provider');
    expect(warningsOf(anim({ type: 'fade', startFrame: 500 }))).toContain('animation.window.outside');
  });

  it('warns when an animation provider cannot be used for the final render', () => {
    const providers = new AnimationProviderRegistry().register(createExternalProvider({ id: 'motion', deterministic: false, supports: ['fade'], evaluate: () => ({}) }));
    const p = mutate((x) => void (x.scenes[0]!.layers[0]!.animations = [{ type: 'fade', provider: 'motion' }, { type: 'fade', provider: 'ghost' }]));
    expect(codes(validateProject(p, { providers }).warnings)).toEqual(expect.arrayContaining(['animation.provider.nondeterministic', 'animation.provider.unknown']));
  });

  it('checks audio, voiceover and captions', () => {
    const p = mutate((x) => {
      x.assets = { vo: { id: 'vo', kind: 'audio', src: 'vo.mp3' } };
      const s = x.scenes[0]!;
      s.voiceover = { id: 'v', assetId: 'vo', durationInFrames: 200 };
      s.audio = [{ id: 'a', assetId: 'vo', role: 'music', volume: 3 }];
      s.captions = { id: 'c', cues: [{ id: 'q1', text: 'b', startFrame: 30, endFrame: 20 }, { id: 'q1', text: 'a', startFrame: 10, endFrame: 20 }] };
    });
    expect(errorsOf(p)).toEqual(expect.arrayContaining(['audio.volume.invalid', 'caption.cue.empty', 'caption.cue.duplicate', 'caption.cue.order']));
    expect(warningsOf(p)).toContain('voiceover.clipped');
  });

  it('enforces scene type contracts', () => {
    const p = mutate((x) => void (x.scenes[0]!.type = 'statistic'));
    expect(errorsOf(p)).toContain('scene.type.contract');
  });

  it('validates a scene in isolation and throws with assert helpers', () => {
    expect(validateScene({ id: 's' }, { fps: 30 }).valid).toBe(false);
    const bad = mutate((p) => void (p.fps = -1));
    expect(() => assertValidProject(bad)).toThrow(SceneValidationError);
    try {
      assertValidProject(bad);
    } catch (e) {
      expect((e as SceneValidationError).message).toMatch(/fps/);
    }
  });
});
