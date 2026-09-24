/**
 * Built-in presets. They are data builders: each returns plain model objects
 * (animations, effects, styles, transitions). Nothing here renders anything,
 * and components never embed presets — they receive the expanded data.
 */
import type { Direction } from '../model/primitives.js';
import type { TextStyle } from '../model/text.js';
import { definePreset, param } from './params.js';
import type { AnyPresetDefinition } from './types.js';

const intensity = (def: number, max = 2) => ({ type: 'number' as const, default: def, min: 0, max, description: 'Strength of the effect' });
const easing = (def: string) => ({ type: 'easing' as const, default: def });
const direction = (def: Direction) => ({ type: 'enum' as const, default: def, options: ['left', 'right', 'up', 'down'] as const });
const frames = (fps: number, seconds: number) => Math.max(1, Math.round(fps * seconds));

// ---------------------------------------------------------------------------
// Animation (layer entrance / exit / emphasis)
// ---------------------------------------------------------------------------

const animationPresets = [
  definePreset({
    id: 'fade-in',
    category: 'animation',
    label: 'Fade in',
    description: 'Opacity 0 → 1 at the start of the layer.',
    defaultDurationInSeconds: 0.5,
    parameters: { easing: easing('easeOut') },
    build: (pr, { durationInFrames }) => [{ type: 'fade', phase: 'in', durationInFrames, easing: param.easing(pr, 'easing') }],
  }),
  definePreset({
    id: 'fade-out',
    category: 'animation',
    label: 'Fade out',
    description: 'Opacity 1 → 0 at the end of the layer.',
    defaultDurationInSeconds: 0.4,
    parameters: { easing: easing('easeIn') },
    build: (pr, { durationInFrames }) => [{ type: 'fade', phase: 'out', durationInFrames, easing: param.easing(pr, 'easing') }],
  }),
  definePreset({
    id: 'slide-in',
    category: 'animation',
    label: 'Slide in',
    description: 'Slides in towards `direction` while fading in.',
    defaultDurationInSeconds: 0.6,
    parameters: { direction: direction('up'), distance: { type: 'number', default: 12, min: 0, max: 200, description: 'Percent of the layer size' }, easing: easing('easeOutCubic') },
    build: (pr, { durationInFrames }) => [
      { type: 'slide', phase: 'in', direction: param.str<Direction>(pr, 'direction'), distance: param.num(pr, 'distance'), units: 'percent', fade: true, durationInFrames, easing: param.easing(pr, 'easing') },
    ],
  }),
  definePreset({
    id: 'pop-in',
    category: 'animation',
    label: 'Pop in',
    description: 'Springy scale-up from small with a quick fade.',
    defaultDurationInSeconds: 0.7,
    parameters: { from: { type: 'number', default: 0.6, min: 0, max: 1 }, damping: { type: 'number', default: 12, min: 1, max: 100 } },
    build: (pr, { durationInFrames, fps }) => [
      { type: 'spring', phase: 'in', property: 'scale', from: param.num(pr, 'from'), to: 1, damping: param.num(pr, 'damping'), durationInFrames },
      { type: 'fade', phase: 'in', durationInFrames: frames(fps, 0.2) },
    ],
  }),
  definePreset({
    id: 'punch-in',
    category: 'animation',
    label: 'Punch in',
    description: 'Fast zoom-in hit that settles slightly, used on hooks and emphasis beats.',
    defaultDurationInSeconds: 0.5,
    parameters: { intensity: intensity(1) },
    build: (pr, { durationInFrames }) => {
      const k = param.num(pr, 'intensity');
      const hit = Math.max(1, Math.round(durationInFrames * 0.25));
      return [
        {
          type: 'keyframes',
          phase: 'in',
          durationInFrames,
          tracks: [{ property: 'scale', keyframes: [{ frame: 0, value: 1, easing: 'easeOutCubic' }, { frame: hit, value: 1 + 0.12 * k, easing: 'easeInOutCubic' }, { frame: durationInFrames, value: 1 + 0.06 * k }] }],
        },
      ];
    },
  }),
  definePreset({
    id: 'blur-in',
    category: 'animation',
    label: 'Blur in',
    description: 'Comes into focus while fading in.',
    defaultDurationInSeconds: 0.6,
    parameters: { blur: { type: 'number', default: 18, min: 0, max: 100 } },
    build: (pr, { durationInFrames }) => [
      { type: 'blur', phase: 'in', from: param.num(pr, 'blur'), to: 0, durationInFrames, easing: 'easeOutCubic' },
      { type: 'fade', phase: 'in', durationInFrames, easing: 'easeOut' },
    ],
  }),
  definePreset({
    id: 'mask-wipe-in',
    category: 'animation',
    label: 'Mask wipe in',
    description: 'Hard-edged reveal towards `direction`.',
    defaultDurationInSeconds: 0.6,
    parameters: { direction: direction('right') },
    build: (pr, { durationInFrames }) => [{ type: 'reveal', phase: 'in', direction: param.str<Direction>(pr, 'direction'), durationInFrames, easing: 'easeInOutCubic' }],
  }),
  definePreset({
    id: 'float',
    category: 'animation',
    label: 'Float',
    description: 'Gentle looping vertical drift for idle elements.',
    defaultDurationInSeconds: 2,
    parameters: { distance: { type: 'number', default: 10, min: 0, max: 100 } },
    build: (pr, { durationInFrames }) => [
      { type: 'keyframes', loop: true, yoyo: true, durationInFrames, easing: 'easeInOutQuad', tracks: [{ property: 'y', keyframes: [{ frame: 0, value: 0 }, { frame: durationInFrames, value: -param.num(pr, 'distance') }] }] },
    ],
  }),
];

// ---------------------------------------------------------------------------
// Camera (scene-level)
// ---------------------------------------------------------------------------

const cameraPresets = [
  definePreset({
    id: 'cinematic-zoom',
    category: 'camera',
    label: 'Cinematic zoom',
    description: 'Slow, smooth push-in over the scene.',
    defaultDurationInSeconds: 1.5,
    parameters: { intensity: { type: 'number', default: 0.35, min: 0, max: 2 }, easing: easing('easeInOut') },
    build: (pr, { durationInFrames }) => [{ type: 'camera', move: 'pushIn', intensity: param.num(pr, 'intensity'), durationInFrames, easing: param.easing(pr, 'easing') }],
  }),
  definePreset({
    id: 'ken-burns',
    category: 'camera',
    label: 'Ken Burns',
    description: 'Slow zoom towards a focal point, the classic documentary still-image move.',
    defaultDurationInSeconds: 5,
    parameters: { intensity: intensity(0.6), focusX: { type: 'number', default: 0.5, min: 0, max: 1 }, focusY: { type: 'number', default: 0.45, min: 0, max: 1 } },
    build: (pr, { durationInFrames }) => [
      { type: 'camera', move: 'kenBurns', intensity: param.num(pr, 'intensity'), focus: { x: param.num(pr, 'focusX'), y: param.num(pr, 'focusY') }, durationInFrames, easing: 'linear' },
    ],
  }),
  definePreset({
    id: 'slow-pan',
    category: 'camera',
    label: 'Slow pan',
    description: 'Lateral drift across the frame.',
    defaultDurationInSeconds: 5,
    parameters: { direction: { type: 'enum', default: 'left', options: ['left', 'right'] }, intensity: intensity(0.5) },
    build: (pr, { durationInFrames }) => [
      { type: 'camera', move: param.str(pr, 'direction') === 'left' ? 'panLeft' : 'panRight', intensity: param.num(pr, 'intensity'), durationInFrames, easing: 'easeInOut' },
    ],
  }),
  definePreset({
    id: 'handheld',
    category: 'camera',
    label: 'Handheld',
    description: 'Subtle continuous camera wobble.',
    defaultDurationInSeconds: 4,
    parameters: { amplitude: { type: 'number', default: 3, min: 0, max: 30 }, seed: { type: 'number', default: 3, min: 0, max: 100000 } },
    build: (pr, { durationInFrames }) => [{ type: 'shake', amplitude: param.num(pr, 'amplitude'), frequency: 1.5, rotation: 0.3, seed: param.num(pr, 'seed'), durationInFrames }],
  }),
  definePreset({
    id: 'impact-shake',
    category: 'camera',
    label: 'Impact shake',
    description: 'Short decaying shake on a hit (statistic reveal, punchline).',
    defaultDurationInSeconds: 0.4,
    parameters: { amplitude: { type: 'number', default: 14, min: 0, max: 60 }, seed: { type: 'number', default: 11, min: 0, max: 100000 } },
    build: (pr, { durationInFrames }) => [{ type: 'shake', phase: 'in', amplitude: param.num(pr, 'amplitude'), frequency: 18, rotation: 1, seed: param.num(pr, 'seed'), durationInFrames }],
  }),
];

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

const typography = (id: string, label: string, description: string, style: TextStyle) =>
  definePreset({
    id,
    category: 'typography',
    label,
    description,
    parameters: { color: { type: 'color', default: style.color ?? '#ffffff' }, fontSize: { type: 'number', default: style.fontSize ?? 64, min: 8, max: 600 } },
    build: (pr) => ({ ...style, color: param.str(pr, 'color'), fontSize: param.num(pr, 'fontSize') }),
  });

const typographyPresets = [
  typography('headline-impact', 'Headline impact', 'Heavy uppercase headline for hooks and titles.', {
    fontFamily: 'Inter, Arial, sans-serif', fontSize: 120, fontWeight: 900, textTransform: 'uppercase', lineHeight: 1, letterSpacing: -2, textAlign: 'center', color: '#ffffff',
    shadow: { x: 0, y: 6, blur: 24, color: 'rgba(0,0,0,0.45)' }, highlight: { color: '#ffd400' },
  }),
  typography('documentary-serif', 'Documentary serif', 'Elegant serif for narration beats and chapter titles.', {
    fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 72, fontWeight: 500, lineHeight: 1.15, textAlign: 'center', color: '#f4efe6',
  }),
  typography('lower-third', 'Lower third', 'Compact label with a solid background plate.', {
    fontFamily: 'Inter, Arial, sans-serif', fontSize: 40, fontWeight: 700, lineHeight: 1.2, textAlign: 'left', color: '#ffffff',
    background: { color: 'rgba(0,0,0,0.7)', paddingX: 24, paddingY: 12, radius: 6 },
  }),
  typography('statistic-number', 'Statistic number', 'Oversized figure for statistic scenes.', {
    fontFamily: 'Inter, Arial, sans-serif', fontSize: 220, fontWeight: 900, lineHeight: 1, letterSpacing: -6, textAlign: 'center', color: '#ffd400',
  }),
];

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

const captionPresets = [
  definePreset({
    id: 'caption-bold-pop',
    category: 'caption',
    label: 'Bold pop',
    description: 'One or few words at a time, heavy outline, colored active word. Social / retention style.',
    parameters: { activeColor: { type: 'color', default: '#ffd400' }, maxWordsPerLine: { type: 'number', default: 3, min: 1, max: 12 } },
    build: (pr) => ({
      mode: 'word',
      maxWordsPerLine: param.num(pr, 'maxWordsPerLine'),
      maxLines: 1,
      text: { fontFamily: 'Inter, Arial, sans-serif', fontSize: 72, fontWeight: 900, textTransform: 'uppercase', color: '#ffffff', stroke: { color: '#000000', width: 8 }, textAlign: 'center' },
      activeWord: { color: param.str(pr, 'activeColor'), highlight: { scale: 1.1 } },
    }),
  }),
  definePreset({
    id: 'caption-clean',
    category: 'caption',
    label: 'Clean subtitles',
    description: 'Classic readable subtitles, sentence case, soft shadow. Documentary style.',
    parameters: { fontSize: { type: 'number', default: 44, min: 12, max: 120 } },
    build: (pr) => ({
      mode: 'line',
      maxWordsPerLine: 8,
      maxLines: 2,
      text: { fontFamily: 'Inter, Arial, sans-serif', fontSize: param.num(pr, 'fontSize'), fontWeight: 600, color: '#ffffff', textAlign: 'center', shadow: { x: 0, y: 2, blur: 8, color: 'rgba(0,0,0,0.8)' } },
    }),
  }),
  definePreset({
    id: 'caption-karaoke',
    category: 'caption',
    label: 'Karaoke',
    description: 'Full cue visible, spoken words highlighted progressively.',
    parameters: { highlight: { type: 'color', default: '#00e1ff' } },
    build: (pr) => ({
      mode: 'block',
      maxLines: 2,
      text: { fontFamily: 'Inter, Arial, sans-serif', fontSize: 52, fontWeight: 800, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
      activeWord: { color: param.str(pr, 'highlight') },
    }),
  }),
];

// ---------------------------------------------------------------------------
// Text effects
// ---------------------------------------------------------------------------

const kinetic = (id: string, label: string, description: string, style: 'pop' | 'rise' | 'highlight' | 'slam', split: 'words' | 'characters', each: number) =>
  definePreset({
    id,
    category: 'textEffect',
    label,
    description,
    defaultDurationInSeconds: 0.5,
    parameters: { intensity: intensity(1), each: { type: 'number', default: each, min: 0, max: 30, description: 'Frames between units' } },
    build: (pr, { durationInFrames }) => ({
      animations: [{ type: 'kineticTypography', phase: 'in', style, split, each: param.num(pr, 'each'), intensity: param.num(pr, 'intensity'), durationInFrames }],
      effects: [],
    }),
  });

const textEffectPresets = [
  kinetic('kinetic-pop-words', 'Pop words', 'Words pop in one after another.', 'pop', 'words', 4),
  kinetic('kinetic-rise-words', 'Rise words', 'Words rise and fade in, calm and readable.', 'rise', 'words', 3),
  kinetic('kinetic-slam-words', 'Slam words', 'Words slam down from large scale, for punchlines.', 'slam', 'words', 5),
  kinetic('highlight-sweep', 'Highlight sweep', 'Emphasis style sweeps across the words.', 'highlight', 'words', 4),
  definePreset({
    id: 'typewriter',
    category: 'textEffect',
    label: 'Typewriter',
    description: 'Characters appear at a fixed speed.',
    defaultDurationInSeconds: 1.5,
    parameters: { charactersPerSecond: { type: 'number', default: 28, min: 1, max: 200 } },
    build: (pr) => ({ animations: [{ type: 'typewriter', phase: 'in', charactersPerSecond: param.num(pr, 'charactersPerSecond'), cursor: true }], effects: [] }),
  }),
  definePreset({
    id: 'glitch-text',
    category: 'textEffect',
    label: 'Glitch text',
    description: 'Digital glitch bursts with RGB split.',
    defaultDurationInSeconds: 0.6,
    parameters: { intensity: intensity(1), seed: { type: 'number', default: 7, min: 0, max: 100000 } },
    build: (pr, { durationInFrames }) => ({
      animations: [{ type: 'glitch', phase: 'in', intensity: param.num(pr, 'intensity'), seed: param.num(pr, 'seed'), frequency: 10, durationInFrames }],
      effects: [{ type: 'chromaticAberration', offset: 2 * param.num(pr, 'intensity') }],
    }),
  }),
];

// ---------------------------------------------------------------------------
// B-roll & image treatments
// ---------------------------------------------------------------------------

const treatmentPresets = [
  definePreset({
    id: 'broll-cinematic',
    category: 'brollTreatment',
    label: 'Cinematic b-roll',
    description: 'Teal/orange grade, vignette, light grain and a slow push-in.',
    defaultDurationInSeconds: 4,
    parameters: { intensity: intensity(1) },
    build: (pr, { durationInFrames }) => {
      const k = param.num(pr, 'intensity');
      return {
        animations: [{ type: 'camera', move: 'pushIn', intensity: 0.4 * k, durationInFrames, easing: 'linear' }],
        effects: [
          { type: 'colorGrade', temperature: 0.15 * k, contrast: 1 + 0.1 * k, saturation: 1 + 0.05 * k, shadows: '#0b3d4a', highlights: '#ffb36b' },
          { type: 'vignette', intensity: 0.35 * k, radius: 0.7 },
          { type: 'grain', intensity: 0.08 * k },
        ],
      };
    },
  }),
  definePreset({
    id: 'broll-documentary-muted',
    category: 'brollTreatment',
    label: 'Muted documentary',
    description: 'Desaturated, slightly contrasted footage with a gentle Ken Burns.',
    defaultDurationInSeconds: 4,
    parameters: { saturation: { type: 'number', default: 0.75, min: 0, max: 2 } },
    build: (pr, { durationInFrames }) => ({
      animations: [{ type: 'camera', move: 'kenBurns', intensity: 0.4, durationInFrames, easing: 'linear' }],
      effects: [{ type: 'saturate', amount: param.num(pr, 'saturation') }, { type: 'contrast', amount: 1.08 }],
    }),
  }),
  definePreset({
    id: 'broll-archive',
    category: 'brollTreatment',
    label: 'Archive footage',
    description: 'Old film look: sepia, grain, vignette and a tiny gate weave.',
    defaultDurationInSeconds: 4,
    parameters: { intensity: intensity(1), seed: { type: 'number', default: 5, min: 0, max: 100000 } },
    build: (pr, { durationInFrames }) => {
      const k = param.num(pr, 'intensity');
      return {
        animations: [{ type: 'shake', amplitude: 1.5 * k, frequency: 6, seed: param.num(pr, 'seed'), durationInFrames }],
        effects: [{ type: 'sepia', amount: 0.6 * k }, { type: 'grain', intensity: 0.25 * k, size: 1.5 }, { type: 'vignette', intensity: 0.5 * k }],
      };
    },
  }),
  definePreset({
    id: 'image-ken-burns',
    category: 'imageTreatment',
    label: 'Ken Burns still',
    description: 'Slow zoom on a still image with a subtle fade-in.',
    defaultDurationInSeconds: 5,
    parameters: { intensity: intensity(0.6), focusX: { type: 'number', default: 0.5, min: 0, max: 1 }, focusY: { type: 'number', default: 0.5, min: 0, max: 1 } },
    build: (pr, { durationInFrames, fps }) => ({
      animations: [
        { type: 'camera', move: 'kenBurns', intensity: param.num(pr, 'intensity'), focus: { x: param.num(pr, 'focusX'), y: param.num(pr, 'focusY') }, durationInFrames, easing: 'linear' },
        { type: 'fade', phase: 'in', durationInFrames: frames(fps, 0.3) },
      ],
      effects: [],
    }),
  }),
  definePreset({
    id: 'image-parallax',
    category: 'imageTreatment',
    label: 'Parallax drift',
    description: 'Depth drift for cut-out images (use different depths per layer).',
    defaultDurationInSeconds: 5,
    parameters: { depth: { type: 'number', default: 1, min: 0, max: 5 }, direction: direction('left') },
    build: (pr, { durationInFrames }) => ({
      animations: [{ type: 'parallax', depth: param.num(pr, 'depth'), direction: param.str<Direction>(pr, 'direction'), distance: 60, durationInFrames, easing: 'linear' }],
      effects: [],
    }),
  }),
  definePreset({
    id: 'screenshot-focus',
    category: 'imageTreatment',
    label: 'Screenshot focus',
    description: 'Card shadow and a zoom towards the relevant part of a screenshot.',
    defaultDurationInSeconds: 1.2,
    parameters: { zoom: { type: 'number', default: 1.35, min: 1, max: 4 }, focusX: { type: 'number', default: 0.5, min: 0, max: 1 }, focusY: { type: 'number', default: 0.3, min: 0, max: 1 } },
    build: (pr, { durationInFrames }) => ({
      animations: [{ type: 'zoom', from: 1, to: param.num(pr, 'zoom'), origin: { x: param.num(pr, 'focusX'), y: param.num(pr, 'focusY') }, startFrame: 10, durationInFrames, easing: 'easeInOutCubic' }],
      effects: [{ type: 'dropShadow', x: 0, y: 20, blur: 60, color: 'rgba(0,0,0,0.45)' }],
    }),
  }),
];

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

const transitionPresets = [
  definePreset({ id: 'hard-cut', category: 'transition', label: 'Hard cut', description: 'No transition.', parameters: {}, build: () => ({ type: 'cut', durationInFrames: 0 }) }),
  definePreset({
    id: 'smooth-crossfade',
    category: 'transition',
    label: 'Smooth crossfade',
    description: 'Soft dissolve between scenes.',
    defaultDurationInSeconds: 0.5,
    parameters: {},
    build: (_pr, { durationInFrames }) => ({ type: 'crossfade', durationInFrames, easing: 'easeInOut' }),
  }),
  definePreset({
    id: 'dip-to-black',
    category: 'transition',
    label: 'Dip to black',
    description: 'Fade out to black then in. Marks a chapter change.',
    defaultDurationInSeconds: 0.8,
    parameters: { color: { type: 'color', default: '#000000' } },
    build: (pr, { durationInFrames }) => ({ type: 'fade', durationInFrames, easing: 'easeInOut', params: { color: param.str(pr, 'color') } }),
  }),
  definePreset({
    id: 'whip-fast',
    category: 'transition',
    label: 'Fast whip',
    description: 'Energetic whip pan, for fast-paced edits.',
    defaultDurationInSeconds: 0.27,
    parameters: { direction: direction('left'), intensity: intensity(1) },
    build: (pr, { durationInFrames }) => ({ type: 'whip', durationInFrames, direction: param.str<Direction>(pr, 'direction'), intensity: param.num(pr, 'intensity'), easing: 'easeInOutCubic' }),
  }),
  definePreset({
    id: 'flash-cut',
    category: 'transition',
    label: 'Flash cut',
    description: 'White flash hiding the cut, great on beats.',
    defaultDurationInSeconds: 0.23,
    parameters: { color: { type: 'color', default: '#ffffff' } },
    build: (pr, { durationInFrames }) => ({ type: 'flash', durationInFrames, params: { color: param.str(pr, 'color') } }),
  }),
  definePreset({
    id: 'glitch-hit',
    category: 'transition',
    label: 'Glitch hit',
    description: 'Short digital glitch between scenes.',
    defaultDurationInSeconds: 0.3,
    parameters: { intensity: intensity(1), seed: { type: 'number', default: 7, min: 0, max: 100000 } },
    build: (pr, { durationInFrames }) => ({ type: 'glitch', durationInFrames, intensity: param.num(pr, 'intensity'), params: { seed: param.num(pr, 'seed') } }),
  }),
  definePreset({
    id: 'zoom-blur-punch',
    category: 'transition',
    label: 'Zoom blur punch',
    description: 'Fast zoom with motion blur.',
    defaultDurationInSeconds: 0.33,
    parameters: { intensity: intensity(1) },
    build: (pr, { durationInFrames }) => ({ type: 'zoomBlur', durationInFrames, intensity: param.num(pr, 'intensity'), easing: 'easeInOutQuad' }),
  }),
  definePreset({
    id: 'push-slide',
    category: 'transition',
    label: 'Push',
    description: 'Next scene pushes the current one out.',
    defaultDurationInSeconds: 0.5,
    parameters: { direction: direction('left') },
    build: (pr, { durationInFrames }) => ({ type: 'push', durationInFrames, direction: param.str<Direction>(pr, 'direction'), easing: 'easeInOutCubic' }),
  }),
];

export const BUILT_IN_PRESETS: readonly AnyPresetDefinition[] = [
  ...animationPresets,
  ...cameraPresets,
  ...typographyPresets,
  ...captionPresets,
  ...textEffectPresets,
  ...treatmentPresets,
  ...transitionPresets,
] as readonly AnyPresetDefinition[];
