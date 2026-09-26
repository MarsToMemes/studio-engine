import React from 'react';
import { counterValue, formatCounter } from '@studio-engine/scene-engine';
import { FONT, GREY, growth, nums, str, strs, type GraphicProps } from './common';

const accentOf = (data: GraphicProps['layer']['data']) => str(data.accent, '#FFC72C');
const fmt = (v: number) => formatCounter(v, { decimals: Number.isInteger(v) ? 0 : 1 });
/** A value with its unit ("9.8 B$"): a bare number does not say what is counted. */
const withUnit = (text: string, data: Record<string, unknown>) => (typeof data.unit === 'string' && data.unit ? `${text} ${data.unit}` : text);

/** Horizontal bars sorted from first to last, with their rank (ranking_animation). */
const RankingBars: React.FC<GraphicProps> = ({ layer, frame, fps }) => {
  const { data } = layer;
  const labels = strs(data.labels);
  const values = nums(data.values);
  const order = values.map((v, i) => ({ v, label: labels[i] ?? '' })).sort((a, b) => (data.sorted ? b.v - a.v : 0));
  const max = Math.max(1e-9, ...values);
  const rowH = Math.min(110, 520 / Math.max(1, order.length));
  return (
    <svg width="100%" height="100%" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
      {order.map((row, i) => {
        const g = growth(data, frame, fps, i);
        const y = 40 + i * rowH;
        const w = (row.v / max) * 560 * g;
        return (
          <g key={i} opacity={g > 0 ? 1 : 0}>
            {data.ranks ? <text x={30} y={y + rowH * 0.62} fill={i === 0 ? accentOf(data) : '#fff'} fontSize={40} fontWeight={800} fontFamily={FONT}>{i + 1}</text> : null}
            <text x={90} y={y + rowH * 0.6} fill="#fff" fontSize={32} fontFamily={FONT}>{row.label}</text>
            <rect x={330} y={y + rowH * 0.18} width={w} height={rowH * 0.6} rx={10} fill={i === 0 ? accentOf(data) : GREY} />
            <text x={345 + w} y={y + rowH * 0.62} fill="#fff" fontSize={34} fontWeight={800} fontFamily={FONT}>{withUnit(fmt(row.v * g), data)}</text>
          </g>
        );
      })}
    </svg>
  );
};

export const BarChart: React.FC<GraphicProps> = (props) => {
  const { layer, frame, fps } = props;
  const { data } = layer;
  if (data.horizontal) return <RankingBars {...props} />;
  const labels = strs(data.labels);
  const values = nums(data.values);
  const max = Math.max(1, ...values);
  const w = 1000 / Math.max(1, values.length);
  return (
    <svg width="100%" height="100%" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
      {values.map((v, i) => {
        const g = growth(data, frame, fps, i);
        const h = (v / max) * 400 * g;
        return (
          <g key={i} opacity={g > 0 ? 1 : 0}>
            <rect x={i * w + w * 0.2} y={520 - h} width={w * 0.6} height={h} rx={12} fill={i === values.length - 1 ? accentOf(data) : GREY} />
            <text x={i * w + w / 2} y={570} fill="#fff" fontSize={32} textAnchor="middle" fontFamily={FONT}>{labels[i]}</text>
            <text x={i * w + w / 2} y={505 - h} fill="#fff" fontSize={40} fontWeight={800} textAnchor="middle" fontFamily={FONT}>{withUnit(fmt(v * g), data)}</text>
          </g>
        );
      })}
    </svg>
  );
};

export const LineChart: React.FC<GraphicProps> = ({ layer, frame, fps }) => {
  const { data } = layer;
  const labels = strs(data.labels);
  const values = nums(data.values);
  const accent = accentOf(data);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => ({ x: 80 + (i * 840) / Math.max(1, values.length - 1), y: 500 - ((v - min) / (max - min)) * 400 }));
  const p = growth(data, frame, fps) * (pts.length - 1);
  const done = Math.floor(p);
  const frac = p - done;
  const visible = pts.slice(0, done + 1);
  const next = pts[done + 1];
  if (next) visible.push({ x: visible[visible.length - 1]!.x + (next.x - visible[visible.length - 1]!.x) * frac, y: visible[visible.length - 1]!.y + (next.y - visible[visible.length - 1]!.y) * frac });
  const line = visible.map((q) => `${q.x},${q.y}`).join(' ');
  const tip = visible[visible.length - 1]!;
  return (
    <svg width="100%" height="100%" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
      <line x1={80} y1={500} x2={920} y2={500} stroke="rgba(255,255,255,0.25)" strokeWidth={2} />
      {data.area && visible.length > 1 ? <polygon points={`${visible[0]!.x},500 ${line} ${tip.x},500`} fill={accent} opacity={0.18} /> : null}
      <polyline points={line} fill="none" stroke={accent} strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((q, i) => (i <= done ? <circle key={i} cx={q.x} cy={q.y} r={10} fill={accent} /> : null))}
      {labels.map((l, i) => <text key={i} x={pts[i]?.x ?? 0} y={560} fill="#fff" fontSize={30} textAnchor="middle" fontFamily={FONT}>{l}</text>)}
      <text x={tip.x} y={tip.y - 26} fill="#fff" fontSize={40} fontWeight={800} textAnchor="middle" fontFamily={FONT}>{withUnit(fmt(counterValue(values[0] ?? 0, values[Math.min(values.length - 1, done + (frac > 0.5 ? 1 : 0))] ?? 0, 1)), data)}</text>
    </svg>
  );
};

export const PieChart: React.FC<GraphicProps> = ({ layer, frame, fps }) => {
  const { data } = layer;
  const labels = strs(data.labels);
  const values = nums(data.values);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const largest = values.indexOf(Math.max(...values));
  const sweep = growth(data, frame, fps) * 2 * Math.PI;
  const cx = 500;
  const cy = 300;
  const r = 210;
  let angle = -Math.PI / 2;
  return (
    <svg width="100%" height="100%" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
      {values.map((v, i) => {
        const start = angle;
        const full = (v / total) * 2 * Math.PI;
        angle += full;
        const drawn = Math.max(0, Math.min(full, sweep - (start + Math.PI / 2)));
        if (drawn <= 0) return null;
        const end = start + drawn;
        const x1 = cx + r * Math.cos(start);
        const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const mid = start + full / 2;
        return (
          <g key={i}>
            <path d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${drawn > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`} fill={i === largest ? accentOf(data) : i % 2 ? '#3d4856' : GREY} stroke="#121212" strokeWidth={4} />
            {drawn >= full * 0.99 ? (
              <text x={cx + (r + 30) * Math.cos(mid)} y={cy + (r + 30) * Math.sin(mid)} fill="#fff" fontSize={34} fontWeight={700} textAnchor={Math.cos(mid) >= 0 ? 'start' : 'end'} dominantBaseline="middle" fontFamily={FONT}>
                {`${labels[i] ?? ''} ${Math.round((v / total) * 100)}%`}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

/** Two values side by side, counting up; the larger one in the accent color. */
export const Comparison: React.FC<GraphicProps> = ({ layer, frame, fps }) => {
  const { data } = layer;
  const labels = strs(data.labels);
  const values = nums(data.values).slice(0, 2);
  const unit = str(data.unit);
  const max = Math.max(1, ...values);
  const winner = values.indexOf(Math.max(...values));
  return (
    <svg width="100%" height="100%" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
      {values.map((v, i) => {
        const g = growth(data, frame, fps, i);
        const color = i === winner ? accentOf(data) : GREY;
        const x = i === 0 ? 70 : 530;
        return (
          <g key={i}>
            <text x={x} y={200} fill={color} fontSize={120} fontWeight={900} fontFamily={FONT}>{`${fmt(v * g)}${unit ? ` ${unit}` : ''}`}</text>
            <text x={x} y={260} fill="#fff" fontSize={34} fontWeight={700} fontFamily={FONT}>{(labels[i] ?? '').toUpperCase()}</text>
            <rect x={x} y={320} width={400 * (v / max) * g} height={60} rx={10} fill={color} />
          </g>
        );
      })}
      <text x={500} y={140} fill="rgba(255,255,255,0.5)" fontSize={48} fontWeight={800} textAnchor="middle" fontFamily={FONT}>VS</text>
    </svg>
  );
};
