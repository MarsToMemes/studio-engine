/** TEXT skills: act on the shot's main text layer. */
import type { KineticStyle } from '../model/animation.js';
import type { ShotType } from '../shotplan/types.js';
import { defineSkill } from './define.js';
import { addAnimations, byIntensity, keywordFrames, sec, textLayerOf } from './helpers.js';
import type { SkillDefinition } from './types.js';

const TEXT_SHOTS: ShotType[] = ['text', 'revelation', 'chapter', 'image', 'video', 'map', 'document', 'chart', 'number'];
const hasText = (t: Parameters<NonNullable<SkillDefinition['canApply']>>[0]) => textLayerOf(t) !== undefined;
const hasKeywords = (t: Parameters<NonNullable<SkillDefinition['canApply']>>[0]) => (textLayerOf(t)?.emphasis?.length ?? 0) > 0;

function kinetic(style: KineticStyle, split: 'words' | 'characters', each: [number, number, number], intensity: [number, number, number]) {
  return (target: Parameters<SkillDefinition['apply']>[0], ctx: Parameters<SkillDefinition['apply']>[1]) => {
    const text = textLayerOf(target)!;
    addAnimations(text, { type: 'kineticTypography', phase: 'in', style, split, each: byIntensity(ctx.intensity, ...each), intensity: byIntensity(ctx.intensity, ...intensity), durationInFrames: sec(ctx, 0.4) });
    return { events: [{ kind: 'text' as const, at: 0 }] };
  };
}

export const TEXT_SKILLS: SkillDefinition[] = [
  defineSkill({
    id: 'keyword_pop',
    name: 'Keyword pop',
    category: 'text',
    description: 'The sentence is visible; each highlighted keyword slams in with a spring when the voice says it.',
    intensity: 'medium',
    duration: { min: 0.4, max: 1.2 },
    compatibleShotTypes: TEXT_SHOTS,
    fallback: ['scale_text'],
    events: ['keyword'],
    canApply: hasKeywords,
    apply: (target, ctx) => {
      const text = textLayerOf(target)!;
      const keywords = text.emphasis!;
      addAnimations(text, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.2) });
      const at = keywordFrames(ctx, text, keywords);
      keywords.forEach((k, j) =>
        addAnimations(text, { type: 'kineticTypography', style: 'slam', split: 'words', units: [k], startFrame: at[j]!, durationInFrames: byIntensity(ctx.intensity, sec(ctx, 0.3), sec(ctx, 0.4), sec(ctx, 0.5)), intensity: byIntensity(ctx.intensity, 0.3, 0.6, 1) }),
      );
      return { events: at.map((f) => ({ kind: 'keyword' as const, at: f })) };
    },
  }),
  defineSkill({ id: 'word_reveal', name: 'Word reveal', category: 'text', description: 'Words rise and fade in one after another.', intensity: 'medium', duration: { min: 0.6, max: 2 }, compatibleShotTypes: TEXT_SHOTS, fallback: ['slide_text'], events: ['text'], canApply: hasText, apply: kinetic('rise', 'words', [4, 3, 2], [0.6, 1, 1.3]) }),
  defineSkill({ id: 'character_reveal', name: 'Character reveal', category: 'text', description: 'Characters pop in one by one. Best for short words and titles.', intensity: 'medium', duration: { min: 0.5, max: 1.5 }, compatibleShotTypes: TEXT_SHOTS, fallback: ['word_reveal'], events: ['text'], canApply: hasText, apply: kinetic('pop', 'characters', [2, 1, 1], [0.6, 1, 1.2]) }),
  defineSkill({
    id: 'typewriter',
    name: 'Typewriter',
    category: 'text',
    description: 'Characters appear at a steady typing speed.',
    intensity: 'medium',
    duration: { min: 0.8, max: 3 },
    compatibleShotTypes: TEXT_SHOTS,
    fallback: ['word_reveal'],
    events: ['text'],
    canApply: hasText,
    apply: (target, ctx) => {
      addAnimations(textLayerOf(target)!, { type: 'typewriter', phase: 'in', charactersPerSecond: byIntensity(ctx.intensity, 18, 28, 42), cursor: true });
      return { events: [{ kind: 'text', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'slide_text',
    name: 'Slide text',
    category: 'text',
    description: 'Text slides up into place while fading in.',
    intensity: 'subtle',
    duration: { min: 0.3, max: 0.8 },
    compatibleShotTypes: TEXT_SHOTS,
    fallback: ['scale_text'],
    events: ['text'],
    canApply: hasText,
    apply: (target, ctx) => {
      addAnimations(textLayerOf(target)!, { type: 'slide', phase: 'in', direction: 'up', distance: byIntensity(ctx.intensity, 12, 20, 32), units: 'percent', fade: true, durationInFrames: sec(ctx, 0.5), easing: 'easeOutCubic' });
      return { events: [{ kind: 'text', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'scale_text',
    name: 'Scale text',
    category: 'text',
    description: 'Text scales up from slightly smaller with a small overshoot.',
    intensity: 'medium',
    duration: { min: 0.3, max: 0.8 },
    compatibleShotTypes: TEXT_SHOTS,
    events: ['text'],
    canApply: hasText,
    apply: (target, ctx) => {
      addAnimations(textLayerOf(target)!, { type: 'scale', phase: 'in', from: byIntensity(ctx.intensity, 0.85, 0.7, 0.5), to: 1, durationInFrames: sec(ctx, 0.45), easing: 'easeOutBack' }, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.25) });
      return { events: [{ kind: 'text', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'blur_reveal',
    name: 'Blur reveal',
    category: 'text',
    description: 'Text comes into focus while fading in.',
    intensity: 'subtle',
    duration: { min: 0.4, max: 1 },
    compatibleShotTypes: TEXT_SHOTS,
    fallback: ['scale_text'],
    events: ['text'],
    canApply: hasText,
    apply: (target, ctx) => {
      addAnimations(textLayerOf(target)!, { type: 'blur', phase: 'in', from: byIntensity(ctx.intensity, 10, 18, 28), to: 0, durationInFrames: sec(ctx, 0.6), easing: 'easeOutCubic' }, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.5) });
      return { events: [{ kind: 'text', at: 0 }] };
    },
  }),
  defineSkill({
    id: 'mask_reveal',
    name: 'Mask reveal',
    category: 'text',
    description: 'A hard-edged mask wipes the text in from the left.',
    intensity: 'medium',
    duration: { min: 0.3, max: 0.8 },
    compatibleShotTypes: TEXT_SHOTS,
    fallback: ['slide_text'],
    events: ['text'],
    canApply: hasText,
    apply: (target, ctx) => {
      addAnimations(textLayerOf(target)!, { type: 'reveal', phase: 'in', direction: 'right', durationInFrames: byIntensity(ctx.intensity, sec(ctx, 0.7), sec(ctx, 0.5), sec(ctx, 0.3)), easing: 'easeInOutCubic' });
      return { events: [{ kind: 'text', at: 0 }] };
    },
  }),
  ...(['highlight_word', 'underline_word'] as const).map((id) =>
    defineSkill({
      id,
      name: id === 'highlight_word' ? 'Highlight word' : 'Underline word',
      category: 'text',
      description: id === 'highlight_word' ? 'A highlighter marker sweeps across each keyword when it is spoken.' : 'An accent underline draws itself under each keyword when it is spoken.',
      intensity: 'subtle',
      duration: { min: 0.3, max: 0.8 },
      compatibleShotTypes: TEXT_SHOTS,
      fallback: id === 'highlight_word' ? ['underline_word', 'keyword_pop'] : ['highlight_word', 'keyword_pop'],
      events: ['highlight'],
      canApply: hasKeywords,
      apply: (target, ctx) => {
        const text = textLayerOf(target)!;
        const keywords = text.emphasis!;
        const at = keywordFrames(ctx, text, keywords);
        addAnimations(text, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.2) });
        text.decorations = [
          ...(text.decorations ?? []),
          ...keywords.map((k, j) => ({
            kind: id === 'highlight_word' ? ('marker' as const) : ('underline' as const),
            words: [k],
            startFrame: at[j]!,
            durationInFrames: byIntensity(ctx.intensity, sec(ctx, 0.35), sec(ctx, 0.3), sec(ctx, 0.2)),
            color: ctx.theme.accent,
            // Highlighter look: dark text on the accent marker keeps the word readable.
            ...(id === 'highlight_word' ? { textColor: ctx.theme.background } : {}),
            ...(id === 'underline_word' ? { thickness: byIntensity(ctx.intensity, 6, 8, 12) } : {}),
          })),
        ];
        return { events: at.map((f) => ({ kind: 'highlight' as const, at: f })) };
      },
    }),
  ),
];
