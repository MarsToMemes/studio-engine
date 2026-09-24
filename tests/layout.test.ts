import { describe, expect, it } from 'vitest';
import { dimensionsForAspectRatio, matchesAspectRatio, parseAspectRatio, resolveLayerBox } from '../src/index.js';

const canvas = { width: 1920, height: 1080 };

describe('resolveLayerBox', () => {
  it('fills the canvas when no size is given', () => {
    expect(resolveLayerBox({ anchor: 'center', x: 0, y: 0, units: 'percent' }, canvas)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
  it('aligns the layer anchor to the canvas anchor', () => {
    expect(resolveLayerBox({ anchor: 'center', x: 0, y: 0, width: 50, height: 50, units: 'percent' }, canvas)).toEqual({ x: 480, y: 270, width: 960, height: 540 });
    expect(resolveLayerBox({ anchor: 'bottom-right', x: -40, y: -40, width: 200, height: 100, units: 'px' }, canvas)).toEqual({ x: 1680, y: 940, width: 200, height: 100 });
    expect(resolveLayerBox({ anchor: 'top-left', x: 10, y: 10, width: 10, height: 10, units: 'percent' }, canvas)).toEqual({ x: 192, y: 108, width: 192, height: 108 });
  });
  it('resolves percent offsets against the canvas axes', () => {
    expect(resolveLayerBox({ anchor: 'bottom-center', x: 0, y: -10, width: 90, height: 20, units: 'percent' }, canvas)).toEqual({ x: 96, y: 756, width: 1728, height: 216 });
  });
});

describe('aspect ratios', () => {
  it('parses and rejects', () => {
    expect(parseAspectRatio('16:9')).toEqual({ w: 16, h: 9 });
    expect(parseAspectRatio('2.39:1')).toEqual({ w: 2.39, h: 1 });
    expect(parseAspectRatio('16/9')).toBeUndefined();
    expect(parseAspectRatio('0:9')).toBeUndefined();
  });
  it('derives even canvas sizes from the short side', () => {
    expect(dimensionsForAspectRatio('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(dimensionsForAspectRatio('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(dimensionsForAspectRatio('4:5')).toEqual({ width: 1080, height: 1350 });
    expect(dimensionsForAspectRatio('1:1', 720)).toEqual({ width: 720, height: 720 });
    expect(dimensionsForAspectRatio('21:9')).toEqual({ width: 2520, height: 1080 });
    expect(() => dimensionsForAspectRatio('wide')).toThrow();
  });
  it('checks dimensions against a ratio', () => {
    expect(matchesAspectRatio({ width: 1920, height: 1080 }, '16:9')).toBe(true);
    expect(matchesAspectRatio({ width: 1080, height: 1080 }, '16:9')).toBe(false);
  });
});
