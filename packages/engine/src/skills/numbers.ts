/** NUMBERS skills: act on the counter graphic of number shots. */
import { defineSkill } from './define.js';
import { addAnimations, byIntensity, graphicOf, sec, textLayerOf } from './helpers.js';
import type { SkillDefinition } from './types.js';

const hasCounter = (t: Parameters<NonNullable<SkillDefinition['canApply']>>[0]) => graphicOf(t, 'number') !== undefined;

function labelIn(target: Parameters<SkillDefinition['apply']>[0], ctx: Parameters<SkillDefinition['apply']>[1], delaySeconds: number) {
  const label = textLayerOf(target);
  if (label) addAnimations(label, { type: 'slide', phase: 'in', direction: 'up', distance: 30, units: 'percent', fade: true, startFrame: sec(ctx, delaySeconds), durationInFrames: sec(ctx, 0.4), easing: 'easeOutCubic' });
}

export const NUMBER_SKILLS: SkillDefinition[] = [
  defineSkill({
    id: 'number_pop',
    name: 'Number pop',
    category: 'numbers',
    description: 'The number springs in and counts up fast. For striking statistics.',
    intensity: 'medium',
    duration: { min: 0.4, max: 1.2 },
    compatibleShotTypes: ['number'],
    fallback: ['number_count', 'scale_text'],
    events: ['number'],
    canApply: hasCounter,
    apply: (target, ctx) => {
      const counter = graphicOf(target, 'number')!;
      counter.data = { ...counter.data, countDurationInFrames: byIntensity(ctx.intensity, sec(ctx, 0.8), sec(ctx, 0.5), sec(ctx, 0.35)) };
      addAnimations(counter, { type: 'spring', phase: 'in', property: 'scale', from: byIntensity(ctx.intensity, 0.7, 0.5, 0.3), to: 1, damping: 11, durationInFrames: sec(ctx, 0.7) }, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.15) });
      labelIn(target, ctx, 0.35);
      return { events: [{ kind: 'number', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'number_count',
    name: 'Number count',
    category: 'numbers',
    description: 'The number counts up from its starting value, then lands.',
    intensity: 'subtle',
    duration: { min: 0.8, max: 2.5 },
    compatibleShotTypes: ['number'],
    fallback: ['number_pop'],
    events: ['number'],
    canApply: hasCounter,
    apply: (target, ctx) => {
      const counter = graphicOf(target, 'number')!;
      const count = byIntensity(ctx.intensity, sec(ctx, 2), sec(ctx, 1.5), sec(ctx, 1.1));
      counter.data = { ...counter.data, countDurationInFrames: count };
      addAnimations(counter, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.25) });
      labelIn(target, ctx, 0.5);
      return { events: [{ kind: 'number', at: Math.min(ctx.durationInFrames - 1, count) }] };
    },
  }),
  defineSkill({
    id: 'percentage_reveal',
    name: 'Percentage reveal',
    category: 'numbers',
    description: 'A percentage counts up while a ring fills to the same value.',
    intensity: 'medium',
    duration: { min: 0.8, max: 2 },
    compatibleShotTypes: ['number'],
    fallback: ['number_count'],
    events: ['number'],
    canApply: hasCounter,
    apply: (target, ctx) => {
      const counter = graphicOf(target, 'number')!;
      counter.data = { ...counter.data, suffix: counter.data.suffix || '%', ring: true, countDurationInFrames: byIntensity(ctx.intensity, sec(ctx, 1.6), sec(ctx, 1.2), sec(ctx, 0.9)) };
      addAnimations(counter, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.25) });
      labelIn(target, ctx, 0.6);
      return { events: [{ kind: 'number', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'currency_reveal',
    name: 'Currency reveal',
    category: 'numbers',
    description: 'A money amount counts up with currency symbol and thousands separators.',
    intensity: 'medium',
    duration: { min: 0.8, max: 2 },
    compatibleShotTypes: ['number'],
    parameters: { currency: { type: 'string', default: '$', description: 'Symbol used when the number has no prefix' } },
    fallback: ['number_count'],
    events: ['number'],
    canApply: hasCounter,
    apply: (target, ctx) => {
      const counter = graphicOf(target, 'number')!;
      counter.data = { ...counter.data, prefix: counter.data.prefix || (ctx.params.currency as string), separator: ',', countDurationInFrames: byIntensity(ctx.intensity, sec(ctx, 1.6), sec(ctx, 1.2), sec(ctx, 0.9)) };
      addAnimations(counter, { type: 'slide', phase: 'in', direction: 'up', distance: 15, units: 'percent', fade: true, durationInFrames: sec(ctx, 0.5), easing: 'easeOutCubic' });
      labelIn(target, ctx, 0.6);
      return { events: [{ kind: 'number', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'stat_card',
    name: 'Stat card',
    category: 'numbers',
    description: 'A card with the number and its label slides in. Good over footage.',
    intensity: 'subtle',
    duration: { min: 0.5, max: 1.5 },
    compatibleShotTypes: ['number'],
    fallback: ['number_pop'],
    events: ['number'],
    requires: { graphicKinds: ['statCard'] },
    canApply: hasCounter,
    apply: (target, ctx) => {
      const counter = graphicOf(target, 'number')!;
      const label = textLayerOf(target);
      counter.kind = 'statCard';
      counter.data = { ...counter.data, ...(label ? { label: label.text } : {}), accent: ctx.theme.accent, countDurationInFrames: sec(ctx, 1) };
      counter.position = { anchor: 'center', x: 0, y: 0, width: 56, height: 44, units: 'percent' };
      if (label) {
        // The card carries the label: drop the separate text layer.
        target.scene.layers = target.scene.layers.filter((l) => l !== label);
        delete target.roles.text;
      }
      addAnimations(counter, { type: 'slide', phase: 'in', direction: 'left', distance: byIntensity(ctx.intensity, 20, 35, 60), units: 'percent', fade: true, durationInFrames: sec(ctx, 0.5), easing: 'easeOutCubic' });
      return { events: [{ kind: 'number', at: 0 }] };
    },
  }),
];
