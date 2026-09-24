/** DATA skills: choose the chart form and how it builds up. Drawn by the renderer's chart components. */
import type { GraphicKind, GraphicLayer } from '../model/layer.js';
import type { ComposedShot } from '../shotplan/compile.js';
import { defineSkill } from './define.js';
import { addAnimations, byIntensity, graphicOf, sec } from './helpers.js';
import type { SkillApplyContext, SkillDefinition } from './types.js';

const hasChart = (t: ComposedShot) => graphicOf(t, 'chart') !== undefined;
const values = (t: ComposedShot) => ((graphicOf(t, 'chart')?.data.values as number[] | undefined) ?? []);

function build(chart: GraphicLayer, kind: GraphicKind, ctx: SkillApplyContext, extra: Record<string, string | number | boolean> = {}) {
  chart.kind = kind;
  chart.data = { ...chart.data, startFrame: sec(ctx, 0.15), growInFrames: byIntensity(ctx.intensity, sec(ctx, 1.4), sec(ctx, 1), sec(ctx, 0.7)), staggerFrames: byIntensity(ctx.intensity, sec(ctx, 0.2), sec(ctx, 0.15), sec(ctx, 0.1)), ...extra };
}

const chartSkill = (id: string, name: string, description: string, kind: GraphicKind, fallback: string[], extra: Record<string, boolean> = {}, minValues = 1): SkillDefinition =>
  defineSkill({
    id,
    name,
    category: 'data',
    description,
    intensity: 'medium',
    duration: { min: 0.8, max: 3 },
    compatibleShotTypes: ['chart'],
    fallback,
    events: ['number'],
    requires: { graphicKinds: [kind] },
    canApply: (t) => hasChart(t) && values(t).length >= minValues,
    apply: (target, ctx) => {
      build(graphicOf(target, 'chart')!, kind, ctx, extra);
      return { events: [{ kind: 'number', at: sec(ctx, 0.15) }] };
    },
  });

export const DATA_SKILLS: SkillDefinition[] = [
  chartSkill('chart_growth', 'Chart growth', 'A rising line with a filled area: shows growth over time.', 'lineChart', ['line_animation', 'chart_reveal'], { area: true }, 2),
  defineSkill({
    id: 'chart_reveal',
    name: 'Chart reveal',
    category: 'data',
    description: 'The chart scales in and builds quickly. Works with any chart form.',
    intensity: 'subtle',
    duration: { min: 0.5, max: 1.5 },
    compatibleShotTypes: ['chart'],
    events: ['number'],
    canApply: hasChart,
    apply: (target, ctx) => {
      const chart = graphicOf(target, 'chart')!;
      chart.data = { ...chart.data, startFrame: 0, growInFrames: sec(ctx, 0.6) };
      addAnimations(chart, { type: 'scale', phase: 'in', from: 0.92, to: 1, durationInFrames: sec(ctx, 0.5), easing: 'easeOutCubic' }, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.35) });
      return { events: [{ kind: 'number', at: 0 }] };
    },
  }),
  chartSkill('bar_animation', 'Bar animation', 'Bars grow one after another; the last one in the accent color.', 'barChart', ['chart_reveal']),
  chartSkill('line_animation', 'Line animation', 'The line draws itself from left to right.', 'lineChart', ['chart_reveal'], {}, 2),
  chartSkill('pie_reveal', 'Pie reveal', 'Slices sweep in around the circle.', 'pieChart', ['chart_reveal'], {}, 2),
  chartSkill('comparison_graph', 'Comparison', 'Two values side by side, the larger one in the accent color.', 'comparison', ['bar_animation', 'chart_reveal'], {}, 2),
];
