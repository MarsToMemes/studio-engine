/**
 * DOCUMENTS skills. The camera moves the whole scene (document + highlight
 * layers together) so highlights stay glued to the lines they mark.
 */
import type { Vec2 } from '../model/primitives.js';
import type { ComposedShot } from '../shotplan/compile.js';
import { defineSkill } from './define.js';
import { addAnimations, byIntensity, sec } from './helpers.js';
import type { SkillDefinition } from './types.js';

const isDocument = (t: ComposedShot) => t.roles.document !== undefined;

/** Center of the first highlight (0..1 of the canvas), or the page center. */
function focusOf(target: ComposedShot, canvas: { width: number; height: number }): Vec2 {
  const h = target.roles.highlight;
  if (h && h.position.units === 'px' && h.position.width !== undefined && h.position.height !== undefined) {
    return { x: (h.position.x + h.position.width / 2) / canvas.width, y: (h.position.y + h.position.height / 2) / canvas.height };
  }
  return { x: 0.5, y: 0.45 };
}

const highlightLayers = (target: ComposedShot) => target.scene.layers.filter((l) => l.id.startsWith(`${target.shot.id}:highlight-`));

export const DOCUMENT_SKILLS: SkillDefinition[] = [
  defineSkill({
    id: 'document_zoom',
    name: 'Document zoom',
    category: 'documents',
    description: 'Slow zoom into the highlighted passage of the document.',
    intensity: 'medium',
    duration: { min: 2, max: 8 },
    compatibleShotTypes: ['document'],
    fallback: ['document_pan', 'slow_zoom'],
    canApply: isDocument,
    apply: (target, ctx) => {
      target.scene.animations = [...target.scene.animations, { type: 'zoom', from: 1, to: byIntensity(ctx.intensity, 1.2, 1.4, 1.65), origin: focusOf(target, ctx.canvas), durationInFrames: ctx.durationInFrames, easing: 'easeInOut' }];
    },
  }),
  defineSkill({
    id: 'document_pan',
    name: 'Document pan',
    category: 'documents',
    description: 'Reads down the page: zoomed in, the camera travels from top to bottom.',
    intensity: 'subtle',
    duration: { min: 2, max: 8 },
    compatibleShotTypes: ['document'],
    fallback: ['document_zoom'],
    canApply: isDocument,
    apply: (target, ctx) => {
      const d = ctx.durationInFrames;
      const travel = ctx.canvas.height * byIntensity(ctx.intensity, 0.06, 0.1, 0.15);
      target.scene.animations = [
        ...target.scene.animations,
        { type: 'keyframes', durationInFrames: d, easing: 'easeInOut', tracks: [{ property: 'scale', keyframes: [{ frame: 0, value: 1.3 }, { frame: d, value: 1.3 }] }, { property: 'y', keyframes: [{ frame: 0, value: travel }, { frame: d, value: -travel }] }] },
      ];
    },
  }),
  defineSkill({
    id: 'document_highlight',
    name: 'Document highlight',
    category: 'documents',
    description: 'Highlighter swipes over the key passages (timed ones keep their timing, others are spread over the shot) with a gentle push towards the first one.',
    intensity: 'medium',
    duration: { min: 2, max: 8 },
    compatibleShotTypes: ['document'],
    fallback: ['document_zoom'],
    events: ['highlight'],
    canApply: (t) => isDocument(t) && highlightLayers(t).length > 0,
    apply: (target, ctx) => {
      const layers = highlightLayers(target);
      const declared = target.shot.document?.highlights ?? [];
      const events: { kind: 'highlight'; at: number }[] = [];
      layers.forEach((layer, i) => {
        const explicit = declared[i]?.at;
        const at = explicit ?? Math.round(ctx.durationInFrames * (0.2 + (0.5 * i) / Math.max(1, layers.length)));
        layer.animations = [{ type: 'reveal', direction: 'right', startFrame: at, durationInFrames: byIntensity(ctx.intensity, sec(ctx, 0.5), sec(ctx, 0.35), sec(ctx, 0.25)), easing: 'easeOutCubic' }];
        events.push({ kind: 'highlight', at });
      });
      target.scene.animations = [...target.scene.animations, { type: 'zoom', from: 1, to: byIntensity(ctx.intensity, 1.06, 1.12, 1.2), origin: focusOf(target, ctx.canvas), durationInFrames: ctx.durationInFrames, easing: 'easeInOut' }];
      return { events };
    },
  }),
  defineSkill({
    id: 'source_reveal',
    name: 'Source reveal',
    category: 'documents',
    description: 'The source citation slides in after the document has settled.',
    intensity: 'subtle',
    duration: { min: 0.4, max: 1 },
    compatibleShotTypes: ['document', 'image', 'video', 'chart', 'map'],
    fallback: ['source_card'],
    events: ['text'],
    canApply: (t) => t.roles.source !== undefined,
    apply: (target, ctx) => {
      const at = sec(ctx, 0.5);
      addAnimations(target.roles.source!, { type: 'slide', phase: 'in', direction: 'right', distance: 30, units: 'percent', fade: true, startFrame: at, durationInFrames: sec(ctx, 0.45), easing: 'easeOutCubic' });
      return { events: [{ kind: 'text', at }] };
    },
  }),
];

