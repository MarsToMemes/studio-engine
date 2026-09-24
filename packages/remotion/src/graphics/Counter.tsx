import React from 'react';
import { counterValue, formatCounter, getEasingFunction, type EasingPreset } from '@studio-engine/scene-engine';
import { num, str, type GraphicProps } from './common';

export function counterProgress(data: GraphicProps['layer']['data'], frame: number, fps: number): number {
  const duration = Math.max(1, num(data.countDurationInFrames, fps));
  return getEasingFunction((str(data.easing, 'easeOutCubic') as EasingPreset) || 'easeOutCubic')(Math.min(1, frame / duration));
}

export function counterText(data: GraphicProps['layer']['data'], progress: number): string {
  const value = counterValue(num(data.from, 0), num(data.to, 0), progress);
  return formatCounter(value, { decimals: num(data.decimals, 0), prefix: str(data.prefix), suffix: str(data.suffix), separator: str(data.separator) });
}

/** Animated number; with `ring: true` a ring fills to the value (percentages). */
export const Counter: React.FC<GraphicProps> = ({ layer, frame, fps, width, height }) => {
  const { data } = layer;
  const p = counterProgress(data, frame, fps);
  const text = counterText(data, p);
  const style = layer.style as React.CSSProperties | undefined;
  if (!data.ring) return <div style={{ ...style, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{text}</div>;
  const size = Math.min(width, height) * 0.95;
  const r = size / 2 - 14;
  const circumference = 2 * Math.PI * r;
  const fill = Math.min(1, Math.max(0, counterValue(num(data.from, 0), num(data.to, 0), p) / 100));
  const color = (style?.color as string) ?? '#FFC72C';
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <svg width={size} height={size} style={{ position: 'absolute' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={14} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fill)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ ...style, fontSize: Math.min(num(style?.fontSize, 200), size * 0.36) }}>{text}</div>
    </div>
  );
};
