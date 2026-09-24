/**
 * IMAGES / VIDEO skills: subtle, cinematic camera moves. They move the shot's
 * media layer (text overlays stay still); shots without media move the whole
 * frame through a scene-level camera.
 */
import type { Animation } from '../model/animation.js';
import type { ComposedShot } from '../shotplan/compile.js';
import type { ShotType } from '../shotplan/types.js';
import { defineSkill } from './define.js';
import { addAnimations, byIntensity, keywordFrames, sec, seedOf, textLayerOf } from './helpers.js';
import type { SkillDefinition } from './types.js';

const ALL: ShotType[] = ['image', 'video', 'text', 'number', 'document', 'chart', 'map', 'revelation', 'chapter'];
const MEDIA: ShotType[] = ['image', 'video', 'document', 'map'];

/** Media layer when the shot has one, otherwise the scene camera. */
function moveMedia(target: ComposedShot, ...animations: Animation[]): void {
  const media = target.roles.media ?? target.roles.map;
  if (media) addAnimations(media, ...animations);
  else target.scene.animations = [...target.scene.animations, ...animations];
}

/** Frame of the first spoken keyword, or 0. Punches land on the word. */
function beat(target: ComposedShot, ctx: Parameters<SkillDefinition['apply']>[1]): number {
  const text = textLayerOf(target);
  return text?.emphasis?.length ? keywordFrames(ctx, text, text.emphasis.slice(0, 1))[0]! : 0;
}

export const IMAGE_SKILLS: SkillDefinition[] = [
  defineSkill({
    id: 'slow_zoom',
    name: 'Slow zoom',
    category: 'images',
    description: 'Slow push of 5–10 % over the whole shot. The default way to keep a still image alive.',
    intensity: 'subtle',
    duration: { min: 2, max: 10 },
    compatibleShotTypes: ALL,
    apply: (target, ctx) => moveMedia(target, { type: 'zoom', from: 1, to: byIntensity(ctx.intensity, 1.05, 1.075, 1.1), durationInFrames: ctx.durationInFrames, easing: 'easeInOut' }),
  }),
  defineSkill({
    id: 'slow_push',
    name: 'Slow push',
    category: 'images',
    description: 'Dolly-like push: slow zoom with a slight upward drift.',
    intensity: 'subtle',
    duration: { min: 2, max: 10 },
    compatibleShotTypes: ALL,
    fallback: ['slow_zoom'],
    apply: (target, ctx) => {
      const d = ctx.durationInFrames;
      moveMedia(target, {
        type: 'keyframes',
        durationInFrames: d,
        easing: 'easeInOut',
        tracks: [
          { property: 'scale', keyframes: [{ frame: 0, value: 1 }, { frame: d, value: byIntensity(ctx.intensity, 1.06, 1.08, 1.12) }] },
          { property: 'y', keyframes: [{ frame: 0, value: 0 }, { frame: d, value: -ctx.canvas.height * byIntensity(ctx.intensity, 0.01, 0.015, 0.02) }] },
        ],
      });
    },
  }),
  defineSkill({
    id: 'punch_in',
    name: 'Punch in',
    category: 'images',
    description: 'Quick 100 % → 112 % → 100 % hit on a beat (the first keyword when spoken).',
    intensity: 'medium',
    duration: { min: 0.4, max: 0.8 },
    compatibleShotTypes: ALL,
    fallback: ['slow_zoom'],
    events: ['impact'],
    apply: (target, ctx) => {
      const at = beat(target, ctx);
      const peak = byIntensity(ctx.intensity, 1.06, 1.12, 1.18);
      const hit = sec(ctx, 0.15);
      moveMedia(target, { type: 'keyframes', startFrame: at, durationInFrames: sec(ctx, 0.6), tracks: [{ property: 'scale', keyframes: [{ frame: 0, value: 1, easing: 'easeOutCubic' }, { frame: hit, value: peak, easing: 'easeInOutCubic' }, { frame: sec(ctx, 0.6), value: 1 }] }] });
      return { events: [{ kind: 'impact', at }] };
    },
  }),
  defineSkill({
    id: 'punch_out',
    name: 'Punch out',
    category: 'images',
    description: 'Starts punched in and snaps back out to the full frame.',
    intensity: 'medium',
    duration: { min: 0.3, max: 0.6 },
    compatibleShotTypes: ALL,
    fallback: ['punch_in'],
    events: ['impact'],
    apply: (target, ctx) => {
      moveMedia(target, { type: 'keyframes', durationInFrames: sec(ctx, 0.35), tracks: [{ property: 'scale', keyframes: [{ frame: 0, value: byIntensity(ctx.intensity, 1.06, 1.12, 1.18), easing: 'easeOutCubic' }, { frame: sec(ctx, 0.35), value: 1 }] }] });
      return { events: [{ kind: 'impact', at: 0 }] };
    },
  }),
  ...(['pan_left', 'pan_right'] as const).map((id) =>
    defineSkill({
      id,
      name: id === 'pan_left' ? 'Pan left' : 'Pan right',
      category: 'images',
      description: `Slow lateral drift to the ${id === 'pan_left' ? 'left' : 'right'}, slightly zoomed to keep the frame filled.`,
      intensity: 'subtle',
      duration: { min: 2, max: 10 },
      compatibleShotTypes: MEDIA,
      fallback: ['slow_zoom'],
      apply: (target, ctx) => moveMedia(target, { type: 'camera', move: id === 'pan_left' ? 'panLeft' : 'panRight', intensity: byIntensity(ctx.intensity, 0.4, 0.6, 0.85), durationInFrames: ctx.durationInFrames, easing: 'easeInOut' }),
    }),
  ),
  defineSkill({
    id: 'parallax',
    name: 'Parallax',
    category: 'images',
    description: 'Depth drift of the media, slightly enlarged so edges never show.',
    intensity: 'subtle',
    duration: { min: 2, max: 8 },
    compatibleShotTypes: MEDIA,
    fallback: ['slow_push', 'slow_zoom'],
    canApply: (t) => (t.roles.media ?? t.roles.map) !== undefined,
    apply: (target, ctx) => {
      const media = (target.roles.media ?? target.roles.map)!;
      const depth = byIntensity(ctx.intensity, 0.6, 1, 1.4);
      media.scale = 1 + 0.06 * depth;
      addAnimations(media, { type: 'parallax', depth, direction: 'left', distance: 40, durationInFrames: ctx.durationInFrames, easing: 'linear' });
    },
  }),
  defineSkill({
    id: 'blur_transition',
    name: 'Blur in / out',
    category: 'images',
    description: 'The media comes out of blur at the start and blurs away at the end.',
    intensity: 'subtle',
    duration: { min: 0.3, max: 0.6 },
    compatibleShotTypes: MEDIA,
    fallback: ['slow_zoom'],
    canApply: (t) => (t.roles.media ?? t.roles.document ?? t.roles.map) !== undefined,
    apply: (target, ctx) => {
      const media = (target.roles.media ?? target.roles.document ?? target.roles.map)!;
      const amount = byIntensity(ctx.intensity, 10, 18, 26);
      addAnimations(media, { type: 'blur', phase: 'in', from: amount, to: 0, durationInFrames: sec(ctx, 0.35) }, { type: 'blur', phase: 'out', from: 0, to: amount, durationInFrames: sec(ctx, 0.35) });
    },
  }),
  defineSkill({
    id: 'camera_shake',
    name: 'Camera shake',
    category: 'images',
    description: 'Short decaying shake of the whole frame on an impact.',
    intensity: 'medium',
    duration: { min: 0.3, max: 0.8 },
    compatibleShotTypes: ALL,
    fallback: ['punch_in'],
    events: ['impact'],
    apply: (target, ctx) => {
      const at = beat(target, ctx);
      target.scene.animations = [...target.scene.animations, { type: 'shake', phase: 'in', startFrame: at, amplitude: byIntensity(ctx.intensity, 5, 10, 18), frequency: 16, rotation: byIntensity(ctx.intensity, 0.3, 0.6, 1.2), seed: seedOf(target.shot.id), durationInFrames: sec(ctx, 0.5) }];
      return { events: [{ kind: 'impact', at }] };
    },
  }),
];
