import { describe, expect, it } from 'vitest';
import {
  clipToCss,
  compileProject,
  composeTransform,
  counterValue,
  createLayer,
  createProject,
  createScene,
  effectsToCssFilter,
  formatCounter,
  getActiveCaption,
  getCaptionLine,
  getMediaPlayback,
  getNonCssEffects,
  sampleLayerUnits,
  sampleProjectFrame,
  sampleScene,
  sequentialIds,
  splitText,
  visibleText,
  type VideoProject,
} from '../src/index.js';

function project(): VideoProject {
  const ids = sequentialIds();
  const p = createProject({ id: 'r', ids });
  p.scenes = [
    createScene('custom', {
      id: 'a',
      durationInFrames: 60,
      animations: [{ type: 'camera', move: 'pushIn', intensity: 1, durationInFrames: 60, easing: 'linear' }],
      layers: [
        createLayer('shape', { id: 'top', shape: 'rect', zIndex: 5, opacity: 0.5, blendMode: 'screen', animations: [{ type: 'fade', phase: 'in', durationInFrames: 10 }] }, { ids }),
        createLayer('shape', { id: 'bottom', shape: 'rect', zIndex: 1, startFrame: 20, durationInFrames: 20, effects: [{ type: 'blur', amount: 4 }, { type: 'grain', intensity: 0.2 }] }, { ids }),
        createLayer('text', { id: 'words', text: 'one two three', style: {}, zIndex: 3, animations: [{ type: 'kineticTypography', style: 'rise', split: 'words', each: 5, durationInFrames: 10 }] }, { ids }),
      ],
    }),
    createScene('custom', { id: 'b', durationInFrames: 60, transitionIn: { type: 'crossfade', durationInFrames: 10 }, layers: [createLayer('shape', { id: 's', shape: 'rect' }, { ids })] }),
  ];
  return p;
}

describe('compile + sample', () => {
  const compiled = compileProject(project());
  const scene = compiled.scenes[0]!;

  it('orders layers by zIndex once at compile time', () => {
    expect(scene.layers.map((l) => l.layer.id)).toEqual(['bottom', 'words', 'top']);
    expect(scene.layers[0]!.staticEffectsFilter).toBe('blur(4px)');
    expect(scene.layers[1]!.hasUnitAnimations).toBe(true);
  });

  it('returns only the layers active at a frame', () => {
    expect(sampleScene(scene, 0, compiled.options).layers.map((l) => l.compiled.layer.id)).toEqual(['words', 'top']);
    expect(sampleScene(scene, 25, compiled.options).layers.map((l) => l.compiled.layer.id)).toEqual(['bottom', 'words', 'top']);
    expect(sampleScene(scene, 40, compiled.options).layers.map((l) => l.compiled.layer.id)).toEqual(['words', 'top']);
  });

  it('combines static layer values with animation state into styles', () => {
    const top = (f: number) => sampleScene(scene, f, compiled.options).layers.find((l) => l.compiled.layer.id === 'top')!;
    expect(top(0).style).toMatchObject({ opacity: 0, mixBlendMode: 'screen', zIndex: 5, left: 0, top: 0, width: 1920, height: 1080 });
    expect(top(5).style.opacity).toBe(0.25);
    expect(top(30).style.opacity).toBe(0.5);
    expect(top(30).localFrame).toBe(30);
  });

  it('applies scene-level camera animations to the stack container', () => {
    expect(sampleScene(scene, 0, compiled.options).cameraStyle.transform).toBe('none');
    expect(sampleScene(scene, 60, compiled.options).cameraStyle.transform).toBe('scale(1.12, 1.12)');
  });

  it('evaluates split-text units separately', () => {
    const words = scene.layers[1]!;
    const units = sampleLayerUnits(words, 10, 3, scene, compiled.options);
    expect(units.map((u) => Number(u.opacity.toFixed(2)))).toEqual([1, 0.88, 0]);
  });

  it('samples both scenes during a crossfade', () => {
    const f = sampleProjectFrame(compiled, 55);
    expect(f.scenes.map((s) => s.scene.scene.id)).toEqual(['a', 'b']);
    expect(f.transition?.state.entering.opacity).toBeCloseTo(0.5);
    expect(sampleProjectFrame(compiled, 70).scenes.map((s) => s.scene.scene.id)).toEqual(['b']);
    expect(sampleProjectFrame(compiled, 999).scenes).toEqual([]);
  });
});

describe('style helpers', () => {
  it('composes transforms and filters', () => {
    expect(composeTransform({ x: 10, y: 0, rotation: 5, scaleX: 2, scaleY: 2 }, { scale: 0.5, rotation: 10 })).toBe('translate(10px, 0px) rotate(15deg)'); // 0.5 × 2 = identity scale, omitted
    expect(composeTransform({}, { transform: { flipX: true } })).toBe('scale(-1, 1)');
    expect(effectsToCssFilter([{ type: 'brightness', amount: 1.2 }, { type: 'hueRotate', amount: 90 }, { type: 'dropShadow', x: 0, y: 4, blur: 8, color: '#000' }, { type: 'vignette', intensity: 1 }])).toBe(
      'brightness(1.2) hue-rotate(90deg) drop-shadow(0px 4px 8px #000)',
    );
    expect(effectsToCssFilter([{ type: 'blur', amount: 0, animatedParams: { amount: [{ frame: 0, value: 0 }, { frame: 10, value: 10 }] } }], 5)).toBe('blur(5px)');
    expect(getNonCssEffects([{ type: 'grain', intensity: 1 }, { type: 'blur', amount: 1 }]).map((e) => e.type)).toEqual(['grain']);
    expect(clipToCss({ kind: 'circle', radius: 50, center: { x: 0.5, y: 0.5 } })).toBe('circle(50% at 50% 50%)');
  });
});

describe('content helpers', () => {
  it('captions', () => {
    const track = {
      id: 't',
      cues: [
        { id: 'a', text: 'hello big world', startFrame: 0, endFrame: 30, words: [{ text: 'hello', startFrame: 0, endFrame: 10 }, { text: 'big', startFrame: 10, endFrame: 20 }, { text: 'world', startFrame: 20, endFrame: 30 }] },
        { id: 'b', text: 'again', startFrame: 40, endFrame: 50 },
      ],
    };
    expect(getActiveCaption(track, 15)).toMatchObject({ cueIndex: 0, wordIndex: 1, word: { text: 'big' } });
    expect(getActiveCaption(track, 35)).toBeUndefined();
    expect(getActiveCaption(track, 45)).toMatchObject({ cueIndex: 1, wordIndex: -1 });
    expect(getCaptionLine(getActiveCaption(track, 25)!, 2)).toEqual({ words: ['world'], activeIndex: 0 });
  });
  it('text', () => {
    expect(splitText('one two  three', 'words')).toEqual(['one ', 'two  ', 'three']);
    expect(splitText('a\nb', 'lines')).toEqual(['a', 'b']);
    expect(visibleText('héllo 👋', 0.5)).toBe('héll');
  });
  it('counters and media', () => {
    expect(formatCounter(counterValue(0, 1234567.891, 1), { decimals: 1, separator: ',', prefix: '$', suffix: 'M' })).toBe('$1,234,567.9M');
    expect(formatCounter(-42, { suffix: '%' })).toBe('-42%');
    expect(getMediaPlayback({ trim: { startFrom: 30, endAt: 90 }, playbackRate: 2 })).toEqual({ startFrom: 30, endAt: 90, playbackRate: 2, loop: false, volume: 1, muted: false });
  });
});

describe('performance on long projects', () => {
  it('compiles and samples 60 scenes × 8 layers quickly', () => {
    const ids = sequentialIds();
    const p = createProject({ id: 'long', ids });
    p.scenes = Array.from({ length: 60 }, (_, i) =>
      createScene('custom', {
        durationInFrames: 150,
        ...(i > 0 ? { transitionIn: { type: 'crossfade', durationInFrames: 10 } } : {}),
        animations: [{ type: 'camera', move: 'kenBurns', durationInFrames: 150 }],
        layers: Array.from({ length: 8 }, (_, k) =>
          createLayer('text', {
            text: `Layer ${k} of scene ${i}`,
            style: {},
            zIndex: k,
            startFrame: k * 5,
            animations: [{ type: 'fade', phase: 'in', durationInFrames: 10 }, { type: 'slide', phase: 'in', direction: 'up', durationInFrames: 12 }, { type: 'shake', amplitude: 2, seed: k }],
          }, { ids }),
        ),
      }, { ids }),
    );
    const t0 = performance.now();
    const compiled = compileProject(p);
    const compileMs = performance.now() - t0;
    const t1 = performance.now();
    let layers = 0;
    for (let f = 0; f < compiled.timeline.durationInFrames; f++) for (const s of sampleProjectFrame(compiled, f).scenes) layers += s.layers.length;
    const sampleMs = performance.now() - t1;
    expect(compiled.timeline.durationInFrames).toBe(60 * 150 - 59 * 10);
    expect(layers).toBeGreaterThan(60_000);
    // Generous bounds: this guards against accidental O(n²) behaviour, not micro-performance.
    expect(compileMs).toBeLessThan(500);
    expect(sampleMs / compiled.timeline.durationInFrames).toBeLessThan(2);
  });
});
