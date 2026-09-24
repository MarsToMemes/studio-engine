import type { LayerBox } from '../model/layer.js';
import type { Anchor, Dimensions, Vec2 } from '../model/primitives.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ANCHOR_FACTORS: Readonly<Record<Anchor, Vec2>> = {
  'top-left': { x: 0, y: 0 },
  'top-center': { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  'center-left': { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  'center-right': { x: 1, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-center': { x: 0.5, y: 1 },
  'bottom-right': { x: 1, y: 1 },
};

/** Box covering the whole canvas. */
export const FULL_FRAME: Readonly<LayerBox> = Object.freeze({ anchor: 'center', x: 0, y: 0, units: 'percent' });

/**
 * Resolve a layer box to absolute pixels (top-left origin).
 *
 * The anchor is both the canvas point the offsets are measured from AND the
 * point of the layer aligned to it, so `{ anchor: 'bottom-right', x: -40, y: -40 }`
 * sits 40px inside the bottom-right corner regardless of the layer size.
 * Percent units are relative to the canvas width (x, width) and height (y, height).
 */
export function resolveLayerBox(box: LayerBox, canvas: Dimensions): Rect {
  const pct = box.units === 'percent';
  const width = box.width === undefined ? canvas.width : pct ? (box.width / 100) * canvas.width : box.width;
  const height = box.height === undefined ? canvas.height : pct ? (box.height / 100) * canvas.height : box.height;
  const ox = pct ? (box.x / 100) * canvas.width : box.x;
  const oy = pct ? (box.y / 100) * canvas.height : box.y;
  const a = ANCHOR_FACTORS[box.anchor];
  return {
    x: a.x * canvas.width + ox - a.x * width,
    y: a.y * canvas.height + oy - a.y * height,
    width,
    height,
  };
}
