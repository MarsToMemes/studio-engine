import { getEasingFunction, type GraphicLayer } from '@studio-engine/scene-engine';

export type GraphicProps = {
  layer: GraphicLayer;
  /** Frame relative to the layer start. */
  frame: number;
  fps: number;
  width: number;
  height: number;
};

export const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
export const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

const easeOut = getEasingFunction('easeOutCubic');

/** Eased 0..1 progress of item `index` for charts built with startFrame / growInFrames / staggerFrames. */
export function growth(data: GraphicLayer['data'], frame: number, fps: number, index = 0): number {
  const start = num(data.startFrame, 0) + index * num(data.staggerFrames, 0);
  const grow = Math.max(1, num(data.growInFrames, fps));
  return easeOut(Math.min(1, Math.max(0, (frame - start) / grow)));
}

export const GREY = '#5b6b7f';
export const FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';
