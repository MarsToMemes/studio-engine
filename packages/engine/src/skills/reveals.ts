/** REVEALS skills: strong entrances for revelations and punchlines. */
import { createLayer } from '../core/factories.js';
import type { Layer } from '../model/layer.js';
import type { ComposedShot } from '../shotplan/compile.js';
import type { ShotType } from '../shotplan/types.js';
import { defineSkill } from './define.js';
import { addAnimations, byIntensity, mainVisual, sec, seedOf, textLayerOf } from './helpers.js';
import type { SkillDefinition } from './types.js';

const REVEAL_SHOTS: ShotType[] = ['revelation', 'text', 'number', 'image', 'video', 'chapter', 'document', 'chart', 'map'];
const subject = (t: ComposedShot): Layer | undefined => textLayerOf(t) ?? mainVisual(t);

/** Full-frame color flash/blackout above everything, fading out. */
function overlay(target: ComposedShot, id: string, color: string, peak: number, hold: number, fade: number): void {
  target.scene.layers.push(
    createLayer('overlay', {
      id: `${target.shot.id}:${id}`,
      kind: 'color',
      color,
      zIndex: 90,
      animations: [{ type: 'keyframes', durationInFrames: hold + fade, tracks: [{ property: 'opacity', keyframes: [{ frame: 0, value: peak }, { frame: hold, value: peak, easing: 'easeInQuad' }, { frame: hold + fade, value: 0 }] }] }],
    }),
  );
}

export const REVEAL_SKILLS: SkillDefinition[] = [
  defineSkill({
    id: 'glitch_reveal',
    name: 'Glitch reveal',
    category: 'reveals',
    description: 'Digital glitch burst as the element appears. Reserve for real revelations.',
    intensity: 'strong',
    duration: { min: 0.3, max: 0.8 },
    compatibleShotTypes: REVEAL_SHOTS,
    fallback: ['zoom_reveal', 'text_reveal'],
    events: ['glitch'],
    canApply: (t) => subject(t) !== undefined,
    apply: (target, ctx) => {
      addAnimations(subject(target)!, { type: 'glitch', phase: 'in', intensity: byIntensity(ctx.intensity, 0.5, 0.8, 1.2), frequency: 12, seed: seedOf(target.shot.id), durationInFrames: byIntensity(ctx.intensity, sec(ctx, 0.3), sec(ctx, 0.4), sec(ctx, 0.55)) }, { type: 'fade', phase: 'in', durationInFrames: 2 });
      return { events: [{ kind: 'glitch', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'flash_reveal',
    name: 'Flash reveal',
    category: 'reveals',
    description: 'White flash, then the element settles from a slight zoom.',
    intensity: 'strong',
    duration: { min: 0.2, max: 0.6 },
    compatibleShotTypes: REVEAL_SHOTS,
    fallback: ['zoom_reveal'],
    events: ['impact'],
    canApply: (t) => subject(t) !== undefined,
    apply: (target, ctx) => {
      overlay(target, 'flash', '#FFFFFF', byIntensity(ctx.intensity, 0.6, 0.85, 1), 1, sec(ctx, 0.3));
      addAnimations(subject(target)!, { type: 'scale', phase: 'in', from: 1.06, to: 1, durationInFrames: sec(ctx, 0.35), easing: 'easeOutCubic' });
      return { events: [{ kind: 'impact', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'blackout_reveal',
    name: 'Blackout reveal',
    category: 'reveals',
    description: 'A beat of black, then the element appears. Suspense before a reveal.',
    intensity: 'strong',
    duration: { min: 0.4, max: 1 },
    compatibleShotTypes: REVEAL_SHOTS,
    fallback: ['zoom_reveal'],
    events: ['reveal'],
    canApply: (t) => subject(t) !== undefined,
    apply: (target, ctx) => {
      const hold = byIntensity(ctx.intensity, sec(ctx, 0.25), sec(ctx, 0.4), sec(ctx, 0.6));
      overlay(target, 'blackout', ctx.theme.background, 1, hold, sec(ctx, 0.25));
      addAnimations(subject(target)!, { type: 'scale', from: 1.1, to: 1, startFrame: hold, durationInFrames: sec(ctx, 0.4), easing: 'easeOutCubic' });
      return { events: [{ kind: 'reveal', at: hold }] };
    },
  }),
  defineSkill({
    id: 'zoom_reveal',
    name: 'Zoom reveal',
    category: 'reveals',
    description: 'The element rushes in from a large, blurred scale.',
    intensity: 'medium',
    duration: { min: 0.3, max: 0.7 },
    compatibleShotTypes: REVEAL_SHOTS,
    fallback: ['text_reveal', 'scale_text'],
    events: ['whoosh'],
    canApply: (t) => subject(t) !== undefined,
    apply: (target, ctx) => {
      const d = sec(ctx, 0.45);
      addAnimations(subject(target)!, { type: 'scale', phase: 'in', from: byIntensity(ctx.intensity, 1.3, 1.5, 1.8), to: 1, durationInFrames: d, easing: 'easeOutCubic' }, { type: 'blur', phase: 'in', from: byIntensity(ctx.intensity, 8, 14, 20), to: 0, durationInFrames: d }, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.2) });
      return { events: [{ kind: 'whoosh', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'text_reveal',
    name: 'Text reveal',
    category: 'reveals',
    description: 'The statement is revealed by a wiping mask, word by word emphasis stays.',
    intensity: 'medium',
    duration: { min: 0.3, max: 0.8 },
    compatibleShotTypes: REVEAL_SHOTS,
    fallback: ['mask_reveal', 'scale_text'],
    events: ['reveal'],
    canApply: (t) => textLayerOf(t) !== undefined,
    apply: (target, ctx) => {
      addAnimations(textLayerOf(target)!, { type: 'maskReveal', shape: 'rect', direction: 'right', phase: 'in', durationInFrames: byIntensity(ctx.intensity, sec(ctx, 0.7), sec(ctx, 0.5), sec(ctx, 0.35)), easing: 'easeInOutCubic' });
      return { events: [{ kind: 'reveal', at: 0 }] };
    },
  }),
];
