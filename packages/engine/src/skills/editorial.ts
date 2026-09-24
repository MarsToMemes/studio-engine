/** EDITORIAL skills: structural cards of a documentary (chapters, sources, quotes, lower thirds). */
import { createLayer } from '../core/factories.js';
import type { LayerBox } from '../model/layer.js';
import type { ComposedShot } from '../shotplan/compile.js';
import { defineSkill } from './define.js';
import { addAnimations, byIntensity, sec, textLayerOf } from './helpers.js';
import type { SkillDefinition } from './types.js';

const box = (anchor: LayerBox['anchor'], x: number, y: number, width: number, height: number): LayerBox => ({ anchor, x, y, width, height, units: 'percent' });
const sourceText = (t: ComposedShot) => t.shot.document?.source ?? t.shot.subtext;

export const EDITORIAL_SKILLS: SkillDefinition[] = [
  defineSkill({
    id: 'chapter_card',
    controlsCamera: true, // subtle scene zoom
    name: 'Chapter card',
    category: 'editorial',
    description: 'Chapter number fades in, the title rises word by word, the accent bar draws under it.',
    intensity: 'medium',
    duration: { min: 1.5, max: 3 },
    compatibleShotTypes: ['chapter'],
    fallback: ['full_screen_statement', 'word_reveal'],
    events: ['chapter', 'whoosh'],
    canApply: (t) => textLayerOf(t) !== undefined,
    apply: (target, ctx) => {
      const { subtext, accent } = target.roles;
      if (subtext) addAnimations(subtext, { type: 'slide', phase: 'in', direction: 'down', distance: 40, units: 'percent', fade: true, durationInFrames: sec(ctx, 0.4), easing: 'easeOutCubic' });
      addAnimations(textLayerOf(target)!, { type: 'kineticTypography', phase: 'in', style: 'rise', split: 'words', startFrame: sec(ctx, 0.2), each: byIntensity(ctx.intensity, 4, 3, 2), durationInFrames: sec(ctx, 0.45) });
      if (accent) {
        const at = sec(ctx, 0.5);
        addAnimations(accent, { type: 'keyframes', durationInFrames: at + sec(ctx, 0.4), tracks: [{ property: 'scaleX', keyframes: [{ frame: 0, value: 0 }, { frame: at, value: 0, easing: 'easeOutCubic' }, { frame: at + sec(ctx, 0.4), value: 1 }] }] });
      }
      target.scene.animations = [...target.scene.animations, { type: 'zoom', from: 1, to: 1.04, durationInFrames: ctx.durationInFrames, easing: 'easeInOut' }];
      return { events: [{ kind: 'chapter', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'source_card',
    name: 'Source card',
    category: 'editorial',
    description: 'A source citation card slides in at the bottom left.',
    intensity: 'subtle',
    duration: { min: 0.5, max: 1.5 },
    compatibleShotTypes: ['document', 'image', 'video', 'chart', 'map', 'number'],
    fallback: ['source_reveal'],
    events: ['text'],
    canApply: (t) => t.roles.source !== undefined || sourceText(t) !== undefined,
    apply: (target, ctx) => {
      let card = target.roles.source;
      if (!card) {
        card = createLayer('text', {
          id: `${target.shot.id}:source`,
          text: `Source: ${sourceText(target)}`,
          style: { fontFamily: ctx.theme.fontFamily, fontSize: 30, fontWeight: 600, color: ctx.theme.text, textAlign: 'left', background: { color: 'rgba(18,18,18,0.8)', paddingX: 18, paddingY: 10, radius: 4 } },
          position: box('bottom-left', 4, -4, 60, 7),
          zIndex: 45,
        });
        target.scene.layers.push(card);
        target.roles.source = card;
      }
      const at = sec(ctx, 0.6);
      addAnimations(card, { type: 'slide', phase: 'in', direction: 'right', distance: 25, units: 'percent', fade: true, startFrame: at, durationInFrames: sec(ctx, 0.4), easing: 'easeOutCubic' });
      return { events: [{ kind: 'text', at }] };
    },
  }),
  defineSkill({
    id: 'quote_card',
    name: 'Quote card',
    category: 'editorial',
    description: 'The text becomes an editorial quote: serif, large accent quotation mark, attribution below.',
    intensity: 'subtle',
    duration: { min: 2, max: 6 },
    compatibleShotTypes: ['text', 'revelation'],
    fallback: ['word_reveal'],
    events: ['text'],
    canApply: (t) => textLayerOf(t) !== undefined,
    apply: (target, ctx) => {
      const text = textLayerOf(target)!;
      text.style = { ...text.style, fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 500, fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, fontSize: Math.round((text.style.fontSize ?? 100) * 0.6) };
      target.scene.layers.push(
        createLayer('text', { id: `${target.shot.id}:quote-mark`, text: '“', style: { fontFamily: 'Georgia, serif', fontSize: 260, fontWeight: 700, color: ctx.theme.accent, textAlign: 'left' }, position: box('top-left', 8, 10, 12, 26), zIndex: 38, animations: [{ type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.4) }] }),
      );
      addAnimations(text, { type: 'kineticTypography', phase: 'in', style: 'rise', split: 'words', each: byIntensity(ctx.intensity, 3, 2, 2), durationInFrames: sec(ctx, 0.4), startFrame: sec(ctx, 0.15) });
      const attribution = target.roles.subtext;
      if (attribution) addAnimations(attribution, { type: 'fade', phase: 'in', startFrame: sec(ctx, 0.8), durationInFrames: sec(ctx, 0.4) });
      return { events: [{ kind: 'text', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'lower_third',
    name: 'Lower third',
    category: 'editorial',
    description: 'The on-screen label slides in from the left with an accent bar, and leaves before the cut.',
    intensity: 'subtle',
    duration: { min: 1.5, max: 6 },
    compatibleShotTypes: ['image', 'video', 'map', 'document'],
    fallback: ['slide_text'],
    events: ['text'],
    canApply: (t) => textLayerOf(t) !== undefined,
    apply: (target, ctx) => {
      const text = textLayerOf(target)!;
      const at = sec(ctx, 0.3);
      addAnimations(text, { type: 'slide', phase: 'in', direction: 'right', distance: 30, units: 'percent', fade: true, startFrame: at, durationInFrames: sec(ctx, 0.45), easing: 'easeOutCubic' }, { type: 'fade', phase: 'out', durationInFrames: sec(ctx, 0.3) });
      target.scene.layers.push(
        createLayer('shape', {
          id: `${target.shot.id}:lower-third-bar`,
          shape: 'rect',
          fill: ctx.theme.accent,
          zIndex: 41,
          position: box('bottom-left', 4.2, -12.5, 0.45, 9),
          animations: [
            { type: 'keyframes', startFrame: at, durationInFrames: sec(ctx, 0.3), tracks: [{ property: 'scaleY', keyframes: [{ frame: 0, value: 0, easing: 'easeOutCubic' }, { frame: sec(ctx, 0.3), value: 1 }] }] },
            { type: 'fade', phase: 'out', durationInFrames: sec(ctx, 0.3) },
          ],
        }),
      );
      return { events: [{ kind: 'text', at }] };
    },
  }),
  defineSkill({
    id: 'full_screen_statement',
    controlsCamera: true, // subtle scene zoom
    name: 'Full-screen statement',
    category: 'editorial',
    description: 'A big statement fills the screen, words slamming in, with a slow push.',
    intensity: 'medium',
    duration: { min: 1.5, max: 4 },
    compatibleShotTypes: ['text', 'revelation', 'chapter'],
    fallback: ['scale_text'],
    events: ['text'],
    canApply: (t) => textLayerOf(t) !== undefined,
    apply: (target, ctx) => {
      const text = textLayerOf(target)!;
      text.style = { ...text.style, fontSize: Math.round((text.style.fontSize ?? 120) * 1.15) };
      text.position = { ...text.position, width: 92, height: 60 };
      addAnimations(text, { type: 'kineticTypography', phase: 'in', style: 'slam', split: 'words', each: byIntensity(ctx.intensity, 6, 4, 3), intensity: byIntensity(ctx.intensity, 0.3, 0.5, 0.8), durationInFrames: sec(ctx, 0.35) });
      target.scene.animations = [...target.scene.animations, { type: 'zoom', from: 1, to: 1.03, durationInFrames: ctx.durationInFrames, easing: 'easeInOut' }];
      return { events: [{ kind: 'text', at: 0 }] };
    },
  }),
];
