import { describe, expect, it } from 'vitest';
import { createLayer, createScene, defaultPresetRegistry, PresetError, PresetRegistry, definePreset, validateScene } from '../src/index.js';

const ctx = { fps: 30, canvas: { width: 1920, height: 1080 } };
const reg = defaultPresetRegistry;

describe('preset registry', () => {
  it('ships presets in every category', () => {
    const categories = new Set(reg.list().map((p) => p.category));
    expect([...categories].sort()).toEqual(['animation', 'brollTreatment', 'camera', 'caption', 'imageTreatment', 'textEffect', 'transition', 'typography']);
  });

  it('every built-in preset builds valid scene data with its defaults', () => {
    for (const preset of reg.list()) {
      const scene = createScene('custom', { id: 's', durationInFrames: 150 });
      const layer = createLayer('text', { id: 'l', text: 'Some words here', style: {} });
      scene.layers.push(layer);
      switch (preset.category) {
        case 'animation':
        case 'camera':
        case 'textEffect':
        case 'brollTreatment':
        case 'imageTreatment': {
          const t = reg.applyToLayer(preset.id, ctx);
          layer.animations = t.animations;
          layer.effects = t.effects.filter((e) => e.type !== 'lut');
          break;
        }
        case 'typography':
          layer.style = reg.apply('typography', preset.id, ctx);
          break;
        case 'caption':
          scene.captions = { id: 'c', cues: [{ id: 'q', text: 'hi', startFrame: 0, endFrame: 10 }] };
          scene.layers.push(createLayer('caption', { id: 'cap', trackId: 'c', style: reg.apply('caption', preset.id, ctx) }));
          break;
        case 'transition':
          scene.transitionIn = reg.apply('transition', preset.id, ctx);
          break;
      }
      const result = validateScene(scene, { fps: 30 });
      expect(result.errors, `${preset.id}: ${JSON.stringify(result.errors)}`).toEqual([]);
    }
  });

  it('reproduces the cinematic-zoom example from the spec', () => {
    const [anim] = reg.apply('camera', { presetId: 'cinematic-zoom', durationInFrames: 45, parameters: { intensity: 0.35, easing: 'easeInOut' } }, ctx);
    expect(anim).toEqual({ type: 'camera', move: 'pushIn', intensity: 0.35, durationInFrames: 45, easing: 'easeInOut', presetId: 'cinematic-zoom' });
  });

  it('uses the default duration when none is given', () => {
    expect(reg.apply('animation', 'fade-in', ctx)[0]!.durationInFrames).toBe(15);
    expect(reg.apply('transition', 'whip-fast', ctx)).toMatchObject({ type: 'whip', durationInFrames: 8, presetId: 'whip-fast' });
  });

  it('validates parameters', () => {
    expect(() => reg.resolveParams('cinematic-zoom', { intensity: 5 })).toThrow(PresetError);
    expect(() => reg.resolveParams('cinematic-zoom', { speed: 1 })).toThrow(/unknown parameter/);
    expect(() => reg.resolveParams('slide-in', { direction: 'north' })).toThrow(/one of/);
    expect(() => reg.resolveParams('caption-bold-pop', { activeColor: '' })).toThrow();
    expect(reg.resolveParams('cinematic-zoom', { intensity: 1 })).toEqual({ intensity: 1, easing: 'easeInOut' });
  });

  it('checks categories', () => {
    expect(() => reg.apply('transition', 'fade-in', ctx)).toThrow(/expected "transition"/);
    expect(() => reg.applyToLayer('smooth-crossfade', ctx)).toThrow(/cannot be applied to a layer/);
    expect(() => reg.get('nope')).toThrow(/not registered/);
  });

  it('accepts user presets and rejects invalid defaults', () => {
    const custom = new PresetRegistry([]).register(
      definePreset({
        id: 'brand-title',
        category: 'typography',
        label: 'Brand',
        description: 'House style',
        parameters: { color: { type: 'color', default: '#ff0033' } },
        build: (p) => ({ fontFamily: 'Brand Sans', fontWeight: 800, color: p.color as string }),
      }),
    );
    expect(custom.apply('typography', 'brand-title', ctx)).toEqual({ fontFamily: 'Brand Sans', fontWeight: 800, color: '#ff0033' });
    expect(() =>
      new PresetRegistry([]).register(definePreset({ id: 'bad', category: 'animation', label: '', description: '', parameters: { k: { type: 'number', default: 5, max: 1 } }, build: () => [] })),
    ).toThrow(PresetError);
  });
});
