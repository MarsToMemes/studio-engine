import type { Animation } from '../model/animation.js';
import type { Effect } from '../model/effects.js';
import type { Dimensions, Frames, JsonValue } from '../model/primitives.js';
import type { CaptionStyle, TextStyle } from '../model/text.js';
import type { Transition } from '../model/transition.js';

export type PresetCategory =
  | 'animation'
  | 'transition'
  | 'typography'
  | 'camera'
  | 'caption'
  | 'textEffect'
  | 'brollTreatment'
  | 'imageTreatment';

/** A bundle of animations + effects (+ optional text style) applied to a layer. */
export interface Treatment {
  animations: Animation[];
  effects: Effect[];
  style?: Partial<TextStyle>;
}

/** What each category builds. */
export interface PresetOutputs {
  animation: Animation[];
  camera: Animation[];
  transition: Transition;
  typography: TextStyle;
  caption: CaptionStyle;
  textEffect: Treatment;
  brollTreatment: Treatment;
  imageTreatment: Treatment;
}

export type PresetParameter =
  | { type: 'number'; default: number; min?: number; max?: number; description?: string }
  | { type: 'boolean'; default: boolean; description?: string }
  | { type: 'string'; default: string; description?: string }
  | { type: 'color'; default: string; description?: string }
  | { type: 'enum'; default: string; options: readonly string[]; description?: string }
  | { type: 'easing'; default: JsonValue; description?: string };

export type PresetParams = Record<string, JsonValue>;

export interface PresetBuildContext {
  fps: number;
  /** Resolved duration of the preset in frames (ref override or default). */
  durationInFrames: Frames;
  canvas?: Dimensions;
}

export interface PresetDefinition<C extends PresetCategory = PresetCategory> {
  id: string;
  category: C;
  label: string;
  description: string;
  tags?: readonly string[];
  /** Default length. Omit for timeless presets (typography, caption styles). */
  defaultDurationInSeconds?: number;
  parameters: Record<string, PresetParameter>;
  build: (params: PresetParams, ctx: PresetBuildContext) => PresetOutputs[C];
}

/**
 * Reference to a preset, as stored in a project or produced by an AI agent:
 *   { presetId: 'cinematic-zoom', durationInFrames: 45, parameters: { intensity: 0.35 } }
 */
export interface PresetRef {
  presetId: string;
  durationInFrames?: Frames;
  parameters?: PresetParams;
}

export type AnyPresetDefinition = { [C in PresetCategory]: PresetDefinition<C> }[PresetCategory];
