import { isEasingPreset } from '../animation/easing.js';
import type { Animation } from '../model/animation.js';
import type { JsonValue } from '../model/primitives.js';
import { secondsToFrames } from '../timing/frames.js';
import { BUILT_IN_PRESETS } from './builtins.js';
import type { AnyPresetDefinition, PresetCategory, PresetDefinition, PresetOutputs, PresetParameter, PresetParams, PresetRef, Treatment } from './types.js';

export class PresetError extends Error {
  constructor(
    readonly presetId: string,
    message: string,
  ) {
    super(`Preset "${presetId}": ${message}`);
    this.name = 'PresetError';
  }
}

function checkParam(presetId: string, name: string, def: PresetParameter, value: JsonValue): JsonValue {
  switch (def.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new PresetError(presetId, `parameter "${name}" must be a number`);
      if ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) {
        throw new PresetError(presetId, `parameter "${name}" must be in [${def.min ?? '-∞'}, ${def.max ?? '∞'}] (got ${value})`);
      }
      return value;
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new PresetError(presetId, `parameter "${name}" must be a boolean`);
      return value;
    case 'string':
    case 'color':
      if (typeof value !== 'string' || value === '') throw new PresetError(presetId, `parameter "${name}" must be a non-empty string`);
      return value;
    case 'enum':
      if (typeof value !== 'string' || !def.options.includes(value)) throw new PresetError(presetId, `parameter "${name}" must be one of ${def.options.join(', ')}`);
      return value;
    case 'easing':
      if (!(isEasingPreset(value) || (typeof value === 'object' && value !== null && !Array.isArray(value) && 'type' in value))) {
        throw new PresetError(presetId, `parameter "${name}" must be an easing`);
      }
      return value;
  }
}

export interface ApplyContext {
  fps: number;
  canvas?: { width: number; height: number };
}

export class PresetRegistry {
  private readonly presets = new Map<string, AnyPresetDefinition>();

  constructor(presets: readonly AnyPresetDefinition[] = BUILT_IN_PRESETS) {
    for (const preset of presets) this.register(preset);
  }

  register<C extends PresetCategory>(preset: PresetDefinition<C>): this {
    for (const [name, def] of Object.entries(preset.parameters)) checkParam(preset.id, name, def, def.default);
    this.presets.set(preset.id, preset as unknown as AnyPresetDefinition);
    return this;
  }

  has(id: string): boolean {
    return this.presets.has(id);
  }

  get(id: string): AnyPresetDefinition {
    const preset = this.presets.get(id);
    if (!preset) throw new PresetError(id, 'not registered');
    return preset;
  }

  list(category?: PresetCategory): AnyPresetDefinition[] {
    const all = [...this.presets.values()];
    return category ? all.filter((p) => p.category === category) : all;
  }

  /** Defaults merged with overrides, validated. Unknown parameters are rejected. */
  resolveParams(id: string, overrides: PresetParams = {}): PresetParams {
    const preset = this.get(id);
    for (const key of Object.keys(overrides)) {
      if (!(key in preset.parameters)) throw new PresetError(id, `unknown parameter "${key}"`);
    }
    const out: PresetParams = {};
    for (const [name, def] of Object.entries(preset.parameters)) out[name] = checkParam(id, name, def, overrides[name] ?? def.default);
    return out;
  }

  /** Build the output of a preset reference, checking its category. */
  apply<C extends PresetCategory>(category: C, ref: PresetRef | string, ctx: ApplyContext): PresetOutputs[C] {
    const r: PresetRef = typeof ref === 'string' ? { presetId: ref } : ref;
    const preset = this.get(r.presetId);
    if (preset.category !== category) throw new PresetError(r.presetId, `is a "${preset.category}" preset, expected "${category}"`);
    const params = this.resolveParams(r.presetId, r.parameters);
    const durationInFrames = r.durationInFrames ?? secondsToFrames(preset.defaultDurationInSeconds ?? 1, ctx.fps);
    const output = (preset as PresetDefinition<C>).build(params, { fps: ctx.fps, durationInFrames, ...(ctx.canvas ? { canvas: ctx.canvas } : {}) });
    return tag(output, category, r.presetId);
  }

  /**
   * Apply any preset that targets a layer (animation, camera, text effect,
   * b-roll / image treatment) and normalize the result to a `Treatment`.
   */
  applyToLayer(ref: PresetRef | string, ctx: ApplyContext): Treatment {
    const id = typeof ref === 'string' ? ref : ref.presetId;
    const category = this.get(id).category;
    switch (category) {
      case 'animation':
      case 'camera':
        return { animations: this.apply(category, ref, ctx), effects: [] };
      case 'textEffect':
      case 'brollTreatment':
      case 'imageTreatment':
        return this.apply(category, ref, ctx);
      default:
        throw new PresetError(id, `is a "${category}" preset and cannot be applied to a layer`);
    }
  }
}

export type LayerPresetCategory = 'animation' | 'camera' | 'textEffect' | 'brollTreatment' | 'imageTreatment';
export const LAYER_PRESET_CATEGORIES: readonly LayerPresetCategory[] = ['animation', 'camera', 'textEffect', 'brollTreatment', 'imageTreatment'];

/** Stamp generated animations / transitions with their preset id (editor round-trip). */
function tag<C extends PresetCategory>(output: PresetOutputs[C], category: C, presetId: string): PresetOutputs[C] {
  const tagAnimations = (list: Animation[]) => list.map((a) => ({ ...a, presetId }));
  switch (category) {
    case 'animation':
    case 'camera':
      return tagAnimations(output as Animation[]) as PresetOutputs[C];
    case 'transition':
      return { ...(output as PresetOutputs['transition']), presetId } as PresetOutputs[C];
    case 'textEffect':
    case 'brollTreatment':
    case 'imageTreatment': {
      const t = output as Treatment;
      return { ...t, animations: tagAnimations(t.animations) } as PresetOutputs[C];
    }
    default:
      return output;
  }
}

export const defaultPresetRegistry = new PresetRegistry();
