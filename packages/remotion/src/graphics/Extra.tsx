/**
 * Graphics of the Motion Skill Registry v2: percentage bar (`progress`) and
 * timeline (`timeline`). Pure SVG, frame-driven.
 */
import React from 'react';
import { getEasingFunction } from '@studio-engine/scene-engine';
import { FONT, GREY, num, str, strs, type GraphicProps } from './common';

const easeOut = getEasingFunction('easeOutCubic');

/** A bar that fills to `value / max` (percentage_bar). */
export const Progress: React.FC<GraphicProps> = ({ layer, frame, fps }) => {
  const { data } = layer;
  const share = Math.min(1, Math.max(0, num(data.value, 0) / Math.max(1e-9, num(data.max, 100))));
  const p = easeOut(Math.min(1, Math.max(0, frame / Math.max(1, num(data.growInFrames, fps)))));
  const color = str(data.color, '#FFC72C');
  return (
    <svg width="100%" height="100%" viewBox="0 0 1000 60" preserveAspectRatio="none">
      <rect x={0} y={10} width={1000} height={40} rx={20} fill="rgba(255,255,255,0.12)" />
      <rect x={0} y={10} width={1000 * share * p} height={40} rx={20} fill={color} />
    </svg>
  );
};

/**
 * A horizontal timeline drawing itself; each label appears when its dot is
 * reached (timeline_event). Values are shown above the dots only when the
 * chart has a unit (a timeline's values are often just an order).
 */
export const Timeline: React.FC<GraphicProps> = ({ layer, frame, fps }) => {
  const { data } = layer;
  const labels = strs(data.labels);
  const values = Array.isArray(data.values) ? data.values : [];
  const unit = str(data.unit);
  const start = num(data.startFrame, 0);
  const p = easeOut(Math.min(1, Math.max(0, (frame - start) / Math.max(1, num(data.drawInFrames, fps * 2)))));
  const x0 = 80;
  const x1 = 920;
  const xs = labels.map((_, i) => x0 + (labels.length === 1 ? 0.5 : i / (labels.length - 1)) * (x1 - x0));
  const head = x0 + (x1 - x0) * p;
  const title = str(data.title);
  return (
    <svg width="100%" height="100%" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
      {title ? <text x={500} y={90} fill="#fff" fontSize={40} fontWeight={800} textAnchor="middle" fontFamily={FONT}>{title.toUpperCase()}</text> : null}
      <line x1={x0} y1={300} x2={x1} y2={300} stroke="rgba(255,255,255,0.15)" strokeWidth={6} strokeLinecap="round" />
      <line x1={x0} y1={300} x2={head} y2={300} stroke="#FFC72C" strokeWidth={6} strokeLinecap="round" />
      {xs.map((x, i) => {
        const on = head >= x - 1;
        const appear = on ? Math.min(1, (head - x + 40) / 60) : 0;
        const last = i === xs.length - 1;
        return (
          <g key={i} opacity={appear}>
            <circle cx={x} cy={300} r={last ? 18 : 13} fill={last ? '#FFC72C' : GREY} stroke="#121212" strokeWidth={5} />
            <text x={x} y={370} fill="#fff" fontSize={34} fontWeight={700} textAnchor="middle" fontFamily={FONT}>{labels[i]}</text>
            {unit && typeof values[i] === 'number' ? <text x={x} y={250} fill={last ? '#FFC72C' : '#fff'} fontSize={30} textAnchor="middle" fontFamily={FONT}>{`${values[i]}${unit ? ` ${unit}` : ''}`}</text> : null}
          </g>
        );
      })}
    </svg>
  );
};
