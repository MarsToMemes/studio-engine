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

const DIGITS = '0123456789';

/**
 * Digits drawn as vertical strips. `roll`: each digit spins like a slot
 * machine and locks on its final value, left to right (counter_roll).
 * `odometer`: the value turns continuously, every digit scrolling with the
 * ones below it, like a mechanical counter (odometer).
 */
const DigitStrips: React.FC<{ data: GraphicProps['layer']['data']; frame: number; fps: number; style: React.CSSProperties | undefined }> = ({ data, frame, fps, style }) => {
  const mode = str(data.style);
  const final = counterText(data, 1);
  const duration = Math.max(1, num(data.countDurationInFrames, fps));
  const stagger = num(data.digitStaggerFrames, 0);
  const ease = getEasingFunction('easeOutCubic');
  const value = counterValue(num(data.from, 0), num(data.to, 0), counterProgress(data, frame, fps));
  const decimals = num(data.decimals, 0);
  const scaled = Math.abs(value) * Math.pow(10, decimals);
  const digitPlaces = [...final].filter((c) => DIGITS.includes(c)).length;
  let digitIndex = 0;
  return (
    <div style={{ ...style, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}>
      {[...final].map((ch, i) => {
        if (!DIGITS.includes(ch)) return <span key={i}>{ch}</span>;
        const k = digitIndex++;
        let position: number;
        if (mode === 'odometer') {
          const place = digitPlaces - 1 - k; // power of ten of this digit
          position = (scaled / Math.pow(10, place)) % 10;
          if (place > 0) position = Math.floor(position) + Math.max(0, (scaled % Math.pow(10, place)) / Math.pow(10, place) - 0.9) * 10;
        } else {
          const p = ease(Math.min(1, Math.max(0, (frame - k * stagger) / duration)));
          position = (20 + Number(ch)) * p; // two full turns, then the digit
        }
        return (
          <span key={i} style={{ display: 'inline-block', height: '1.1em', lineHeight: '1.1em', overflow: 'hidden', verticalAlign: 'bottom' }}>
            <span style={{ display: 'block', transform: `translateY(${-(position % 10) * 1.1}em)` }}>
              {[...DIGITS, '0'].map((d, j) => <span key={j} style={{ display: 'block', height: '1.1em' }}>{d}</span>)}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/** Animated number; with `ring: true` a ring fills to the value (percentages). */
export const Counter: React.FC<GraphicProps> = ({ layer, frame, fps, width, height }) => {
  const { data } = layer;
  const p = counterProgress(data, frame, fps);
  const text = counterText(data, p);
  const style = layer.style as React.CSSProperties | undefined;
  if (data.style === 'roll' || data.style === 'odometer') return <DigitStrips data={data} frame={frame} fps={fps} style={style} />;
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
