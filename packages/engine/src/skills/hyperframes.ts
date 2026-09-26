/**
 * Motion Skill pack adapted from HyperFrames' motion rules
 * (github.com/heygen-com/hyperframes, skills/hyperframes-animation/rules,
 * Apache-2.0). The rules describe GSAP recipes; these are independent,
 * frame-based implementations with engine primitives (no GSAP, no DOM
 * measuring): deterministic and seek-safe by construction.
 *
 *   counting-dynamic-scale → count_scale      asr-keyword-glow   → keyword_glow
 *   3d-text-depth-layers   → depth_layers     depth-of-field-blur → rack_focus
 *   depth-scatter-assemble → scatter_assemble kinetic-beat-slam  → beat_slam
 *   ambient-glow-bloom     → glow_bloom       multi-phase-camera → phase_camera
 */
import { createLayer } from '../core/factories.js';
import type { Keyframe } from '../model/animation.js';
import type { LayerBox, TextLayer } from '../model/layer.js';
import type { Gradient } from '../model/primitives.js';
import { defineSkill } from './define.js';
import { addAnimations, byIntensity, graphicOf, keywordFrames, sec, textLayerOf } from './helpers.js';
import type { SkillDefinition } from './types.js';

const box = (anchor: LayerBox['anchor'], x: number, y: number, width: number, height: number): LayerBox => ({ anchor, x, y, width, height, units: 'percent' });
const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

/** counting-dynamic-scale: the figure grows as it counts, one shared timing and ease, so the size says "this is big". */
const countScale = defineSkill({
  id: 'count_scale',
  name: 'Count with scale',
  category: 'numbers',
  description: 'The figure counts up while it grows from about 60 % to full size: escalating weight for an impressive number. After HyperFrames counting-dynamic-scale.',
  intensity: 'medium',
  duration: { min: 1.2, max: 4 },
  compatibleShotTypes: ['number'],
  fallback: ['number_count', 'number_pop'],
  events: ['number'],
  canApply: (t) => graphicOf(t, 'number') !== undefined,
  apply: (target, ctx) => {
    const counter = graphicOf(target, 'number')!;
    const count = byIntensity(ctx.intensity, sec(ctx, 1.6), sec(ctx, 1.3), sec(ctx, 1));
    const from = byIntensity(ctx.intensity, 0.75, 0.62, 0.5);
    counter.data = { ...counter.data, countDurationInFrames: count, easing: 'easeOutCubic' };
    addAnimations(
      counter,
      { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.2) },
      { type: 'keyframes', durationInFrames: count, tracks: [{ property: 'scale', keyframes: [{ frame: 0, value: from, easing: 'easeOutCubic' }, { frame: count, value: 1 }] }] },
    );
    const label = textLayerOf(target);
    if (label) addAnimations(label, { type: 'slide', phase: 'in', direction: 'up', distance: 12, startFrame: Math.round(count * 0.6), durationInFrames: sec(ctx, 0.35) });
    return { events: [{ kind: 'number', at: 0 }] };
  },
});

/**
 * asr-keyword-glow: each highlighted word lights up when it is spoken:
 * attack (~0.12 s), sustain while spoken, release to a resting glow.
 * A copy of the line showing only the key words, in the accent colour and
 * blurred, carries the glow; the word itself swells a little.
 */
const keywordGlow = defineSkill({
  id: 'keyword_glow',
  name: 'Keyword glow',
  category: 'text',
  description: 'The key words glow and swell exactly when the voice says them, then keep a soft resting glow. After HyperFrames asr-keyword-glow.',
  intensity: 'medium',
  duration: { min: 1, max: 6 },
  compatibleShotTypes: ['text', 'revelation', 'chapter'],
  fallback: ['keyword_pop', 'highlight_word'],
  events: ['keyword'],
  canApply: (t) => (textLayerOf(t)?.emphasis?.length ?? 0) > 0,
  apply: (target, ctx) => {
    const text = textLayerOf(target)!;
    const emphasis = [...(text.emphasis ?? [])].sort((a, b) => a - b);
    const at = keywordFrames(ctx, text, emphasis);
    const attack = sec(ctx, 0.12);
    const sustain = sec(ctx, 0.35);
    const release = sec(ctx, 0.6);
    const rest = byIntensity(ctx.intensity, 0.2, 0.3, 0.4);
    const accent = text.style.highlight?.color ?? ctx.theme.accent;
    // The glow follows the max of the per-word envelopes (0 before a word; attack; sustain while spoken;
    // release to a resting level), sampled every 2 frames: overlapping words never break the order.
    const envelope = (f: number) =>
      at.reduce((m, start) => {
        if (f < start) return m;
        const t = f - start;
        const v = t < attack ? t / attack : t < attack + sustain ? 1 : t < attack + sustain + release ? 1 - ((t - attack - sustain) / release) * (1 - rest) : rest;
        return Math.max(m, v);
      }, 0);
    const glowKeys: Keyframe[] = [];
    for (let f = 0; f < ctx.durationInFrames; f += 2) glowKeys.push({ frame: f, value: Number(envelope(f).toFixed(3)) });
    // Two glow copies (a tight core and a wide halo) so the light reads over a dark frame.
    const glowLayer = (suffix: string, blur: number, z: number): TextLayer => ({
      ...structuredClone(text),
      id: `${target.shot.id}:${suffix}`,
      zIndex: text.zIndex - z,
      style: { ...text.style, color: 'rgba(0,0,0,0)', highlight: { ...text.style.highlight, color: accent } },
      animations: [
        ...structuredClone(text.animations),
        { type: 'keyframes', durationInFrames: ctx.durationInFrames, tracks: [{ property: 'opacity', keyframes: glowKeys }, { property: 'blur', keyframes: [{ frame: 0, value: blur }] }] },
      ],
    });
    const spread = byIntensity(ctx.intensity, 0.8, 1, 1.25);
    target.scene.layers.push(glowLayer('glow', Math.round(8 * spread), 1), glowLayer('glow-halo', Math.round(26 * spread), 2));
    // The spoken word swells a little with its glow (1 + boost × envelope): small, so it never runs into its neighbours.
    const boost = byIntensity(ctx.intensity, 0.03, 0.05, 0.07);
    emphasis.forEach((unit, j) => {
      addAnimations(text, {
        type: 'stagger',
        each: 0,
        unit: 'words',
        units: [unit],
        startFrame: at[j]!,
        durationInFrames: attack + sustain + release,
        animation: { type: 'keyframes', durationInFrames: attack + sustain + release, tracks: [{ property: 'scale', keyframes: [{ frame: 0, value: 1 }, { frame: attack, value: 1 + boost }, { frame: attack + sustain, value: 1 + boost }, { frame: attack + sustain + release, value: 1 + boost * rest }] }] },
      });
    });
    return { events: at.map((f) => ({ kind: 'keyword' as const, at: f })) };
  },
});

/** 3d-text-depth-layers: the line stacked N times behind itself, alpha stepping down: a physical extrusion. */
const depthLayers = defineSkill({
  id: 'depth_layers',
  name: 'Depth layers',
  category: 'text',
  description: 'Large typography extruded in depth: copies of the line stack diagonally behind it in the accent colour, building from the back. After HyperFrames 3d-text-depth-layers.',
  intensity: 'strong',
  duration: { min: 1.2, max: 4 },
  compatibleShotTypes: ['text', 'revelation', 'chapter'],
  fallback: ['full_screen_statement', 'scale_text'],
  events: ['text'],
  canApply: (t) => textLayerOf(t) !== undefined,
  apply: (target, ctx) => {
    const text = textLayerOf(target)!;
    const count = byIntensity(ctx.intensity, 4, 6, 8);
    const step = Math.max(3, Math.round(((text.style.fontSize ?? 120) / 120) * 6));
    const rgb = hexToRgb(ctx.theme.accent);
    const build = sec(ctx, 0.08);
    text.style = { ...text.style, fontWeight: 900 };
    for (let i = count; i >= 1; i--) {
      const alpha = Math.max(0.5 - (i - 1) * 0.07, 0.08);
      const start = (count - i) * build;
      target.scene.layers.push({
        ...structuredClone(text),
        id: `${target.shot.id}:depth-${i}`,
        zIndex: text.zIndex - i,
        style: { ...text.style, color: `rgba(${rgb}, ${alpha})`, highlight: { ...text.style.highlight, color: `rgba(${rgb}, ${alpha})` } },
        animations: [
          { type: 'fade', phase: 'in', startFrame: start, durationInFrames: sec(ctx, 0.25) },
          { type: 'keyframes', startFrame: start, durationInFrames: sec(ctx, 0.5), tracks: [{ property: 'x', keyframes: [{ frame: 0, value: 0, easing: 'easeOutCubic' }, { frame: sec(ctx, 0.5), value: i * step }] }, { property: 'y', keyframes: [{ frame: 0, value: 0, easing: 'easeOutCubic' }, { frame: sec(ctx, 0.5), value: i * step }] }] },
        ],
      });
    }
    addAnimations(text, { type: 'fade', phase: 'in', startFrame: count * build, durationInFrames: sec(ctx, 0.2) });
    return { events: [{ kind: 'text', at: count * build }] };
  },
});

/**
 * depth-of-field-blur: over an image with words on it, the picture goes soft
 * and dims while the words stay sharp (focal pull); a bare image racks from
 * soft to sharp instead.
 */
const rackFocus = defineSkill({
  id: 'rack_focus',
  name: 'Rack focus',
  category: 'images',
  description: 'Depth of field: with words on the image, the picture falls out of focus and dims so the words are the only sharp thing; a bare image racks from soft to sharp. After HyperFrames depth-of-field-blur.',
  intensity: 'medium',
  duration: { min: 1.5, max: 6 },
  compatibleShotTypes: ['image', 'video'],
  fallback: ['blur_transition', 'slow_push'],
  events: ['reveal'],
  controlsCamera: true,
  canApply: (t) => t.roles.media !== undefined,
  apply: (target, ctx) => {
    const media = target.roles.media!;
    const words = textLayerOf(target);
    const pull = byIntensity(ctx.intensity, sec(ctx, 0.9), sec(ctx, 0.7), sec(ctx, 0.5));
    const max = byIntensity(ctx.intensity, 6, 9, 12);
    if (words) {
      const at = Math.round(ctx.durationInFrames * 0.2);
      addAnimations(media, { type: 'keyframes', startFrame: at, durationInFrames: pull, tracks: [{ property: 'blur', keyframes: [{ frame: 0, value: 0, easing: 'easeInOutCubic' }, { frame: pull, value: max }] }, { property: 'brightness', keyframes: [{ frame: 0, value: 1, easing: 'easeInOutCubic' }, { frame: pull, value: 0.7 }] }] });
      addAnimations(media, { type: 'zoom', from: 1, to: 1.04, durationInFrames: ctx.durationInFrames, easing: 'linear' });
      return { events: [{ kind: 'reveal', at }] };
    }
    addAnimations(media, { type: 'keyframes', durationInFrames: pull * 2, tracks: [{ property: 'blur', keyframes: [{ frame: 0, value: max * 1.6, easing: 'easeOutCubic' }, { frame: pull * 2, value: 0 }] }] });
    addAnimations(media, { type: 'zoom', from: 1.06, to: 1, durationInFrames: ctx.durationInFrames, easing: 'easeOutCubic' });
    return { events: [{ kind: 'reveal', at: pull }] };
  },
});

/** depth-scatter-assemble: every word flies in from its own point of a depth cloud and locks into the line. */
const scatterAssemble = defineSkill({
  id: 'scatter_assemble',
  name: 'Scatter assemble',
  category: 'reveals',
  description: 'The words start scattered in depth (small, blurred, tilted, each at its own point) and collapse into the sentence: the idea comes together. After HyperFrames depth-scatter-assemble.',
  intensity: 'medium',
  duration: { min: 1.2, max: 4 },
  compatibleShotTypes: ['revelation', 'text', 'chapter'],
  fallback: ['blur_reveal', 'word_reveal'],
  events: ['reveal'],
  canApply: (t) => (textLayerOf(t)?.text.split(/\s+/).length ?? 0) >= 2,
  apply: (target, ctx) => {
    const text = textLayerOf(target)!;
    const each = byIntensity(ctx.intensity, 3, 2, 1);
    const dur = byIntensity(ctx.intensity, sec(ctx, 1.1), sec(ctx, 0.9), sec(ctx, 0.7));
    addAnimations(text, { type: 'kineticTypography', phase: 'in', style: 'scatter', split: 'words', each, intensity: byIntensity(ctx.intensity, 0.7, 1, 1.3), durationInFrames: dur });
    const words = text.text.split(/\s+/).length;
    return { events: [{ kind: 'reveal', at: dur + each * (words - 1) }] };
  },
});

/** kinetic-beat-slam: the words hit one per beat, alternating slam / side-snap / rise-rotate, then hold locked. */
const beatSlam = defineSkill({
  id: 'beat_slam',
  name: 'Beat slam',
  category: 'text',
  description: 'Percussive typography: each word lands on the beat with a different entrance (slam, side-snap, rise) and the line locks. For short, punchy statements. After HyperFrames kinetic-beat-slam.',
  intensity: 'strong',
  duration: { min: 1, max: 3.5 },
  compatibleShotTypes: ['text', 'revelation'],
  fallback: ['kinetic_statement', 'scale_text'],
  events: ['impact'],
  canApply: (t) => {
    const n = textLayerOf(t)?.text.split(/\s+/).length ?? 0;
    return n >= 2 && n <= 7;
  },
  apply: (target, ctx) => {
    const text = textLayerOf(target)!;
    const words = text.text.split(/\s+/).length;
    // One sub-beat of 0.4 s (the rule's PULSE), squeezed if the shot is short: all words land in 60 % of it.
    const beat = Math.max(sec(ctx, 0.15), Math.min(sec(ctx, 0.4), Math.floor((ctx.durationInFrames * 0.6) / words)));
    addAnimations(text, { type: 'kineticTypography', phase: 'in', style: 'beat', split: 'words', each: beat, intensity: byIntensity(ctx.intensity, 0.6, 0.8, 1), durationInFrames: sec(ctx, 0.45) });
    return { events: Array.from({ length: words }, (_, i) => ({ kind: 'impact' as const, at: i * beat })) };
  },
});

/** ambient-glow-bloom: a soft radial glow blooms in behind the hero and breathes, bounded (≤ 0.45 opacity). */
const glowBloom = defineSkill({
  id: 'glow_bloom',
  name: 'Glow bloom',
  category: 'numbers',
  description: 'A soft glow in the accent colour blooms behind the key figure or statement and breathes gently: presence without washing the frame. After HyperFrames ambient-glow-bloom.',
  intensity: 'subtle',
  duration: { min: 1.5, max: 8 },
  compatibleShotTypes: ['number', 'revelation', 'text', 'chapter'],
  fallback: ['number_pop', 'full_screen_statement'],
  events: [],
  canApply: (t) => graphicOf(t, 'number') !== undefined || textLayerOf(t) !== undefined,
  apply: (target, ctx) => {
    const hero = graphicOf(target, 'number') ?? textLayerOf(target)!;
    const peak = byIntensity(ctx.intensity, 0.28, 0.36, 0.45);
    const bloom = sec(ctx, 0.9);
    const rgb = hexToRgb(ctx.theme.accent);
    const fill: Gradient = { kind: 'radial', stops: [{ offset: 0, color: `rgba(${rgb}, 0.9)` }, { offset: 0.45, color: `rgba(${rgb}, 0.35)` }, { offset: 1, color: `rgba(${rgb}, 0)` }] };
    // Bounded breathe after the bloom: two slow cycles, ±12 % opacity, ±3 % scale.
    const hold = Math.max(1, ctx.durationInFrames - bloom);
    const breathe = (amp: number, base: number): Keyframe[] => Array.from({ length: 9 }, (_, k) => ({ frame: bloom + Math.round((k / 8) * hold), value: base * (1 + amp * Math.sin((k / 8) * Math.PI * 4)), easing: 'easeInOut' as const }));
    target.scene.layers.push(
      createLayer('shape', {
        id: `${target.shot.id}:bloom`,
        shape: 'ellipse',
        fill,
        position: box('center', 0, hero.type === 'graphic' ? -4 : 0, 70, 70),
        zIndex: hero.zIndex - 1,
        animations: [{ type: 'keyframes', durationInFrames: ctx.durationInFrames, tracks: [{ property: 'opacity', keyframes: [{ frame: 0, value: 0, easing: 'easeOutQuad' }, { frame: bloom, value: peak }, ...breathe(0.12, peak).slice(1)] }, { property: 'scale', keyframes: [{ frame: 0, value: 0.8, easing: 'easeOutQuad' }, { frame: bloom, value: 1 }, ...breathe(0.03, 1).slice(1)] }] }],
      }),
    );
    return {};
  },
});

/** multi-phase-camera: pull back to settle, hold, then a slow push for the climax, with a micro-drift throughout. */
const phaseCamera = defineSkill({
  id: 'phase_camera',
  name: 'Phase camera',
  category: 'images',
  description: 'A three-phase camera on the picture: settles from a slight close-up, holds, then pushes in slowly for the climax, with a constant micro-drift so it never feels frozen. After HyperFrames multi-phase-camera.',
  intensity: 'medium',
  duration: { min: 3, max: 10 },
  compatibleShotTypes: ['image', 'video', 'document', 'map'],
  fallback: ['slow_push', 'slow_zoom'],
  events: [],
  controlsCamera: true,
  canApply: (t) => (t.roles.media ?? t.roles.document ?? t.roles.map) !== undefined,
  apply: (target, ctx) => {
    const media = (target.roles.media ?? target.roles.document ?? target.roles.map)!;
    const d = ctx.durationInFrames;
    const p1 = byIntensity(ctx.intensity, 1.06, 1.1, 1.14);
    const p3 = byIntensity(ctx.intensity, 1.05, 1.08, 1.12);
    const scale: Keyframe[] = [
      { frame: 0, value: p1, easing: 'easeOutCubic' },
      { frame: Math.round(d * 0.3), value: 1, easing: 'linear' },
      { frame: Math.round(d * 0.55), value: 1, easing: 'easeInOut' },
      { frame: d, value: p3 },
    ];
    // Micro-drift: sine on x and y at frequencies 1 : 1.3 (never a visible loop), sampled every ~0.2 s.
    const amp = byIntensity(ctx.intensity, 6, 10, 14);
    const steps = Math.max(2, Math.round(d / sec(ctx, 0.2)));
    const drift = (ratio: number, phase: number): Keyframe[] => Array.from({ length: steps + 1 }, (_, k) => ({ frame: Math.round((k / steps) * d), value: amp * Math.sin(phase + (k / steps) * Math.PI * 2 * 0.6 * ratio), easing: 'linear' as const }));
    addAnimations(media, { type: 'keyframes', durationInFrames: d, tracks: [{ property: 'scale', keyframes: scale }, { property: 'x', keyframes: drift(1, 0) }, { property: 'y', keyframes: drift(1.3, 1.2) }] });
    return {};
  },
});

export const HYPERFRAMES_SKILLS: SkillDefinition[] = [countScale, keywordGlow, depthLayers, rackFocus, scatterAssemble, beatSlam, glowBloom, phaseCamera];
