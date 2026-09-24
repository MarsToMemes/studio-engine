/**
 * Machine-readable description of the blueprint contract, generated from the
 * live registries (scene types, presets) so it can never drift from what the
 * compiler accepts. Use it as a tool / structured-output schema for an LLM,
 * and `buildAgentCatalog()` as the reference material in its prompt.
 */
import { defaultSceneTypeRegistry, type SceneTypeRegistry } from '../core/sceneTypes.js';
import { defaultPresetRegistry, type PresetRegistry } from '../presets/registry.js';
import type { PresetCategory } from '../presets/types.js';

type Schema = Record<string, unknown>;

export interface SchemaOptions {
  sceneTypes?: SceneTypeRegistry;
  presets?: PresetRegistry;
}

function presetChoice(presets: PresetRegistry, categories: PresetCategory[]): Schema {
  const ids = categories.flatMap((c) => presets.list(c).map((p) => p.id));
  return {
    anyOf: [
      { type: 'string', enum: ids },
      { type: 'object', required: ['presetId'], additionalProperties: false, properties: { presetId: { type: 'string', enum: ids }, durationInFrames: { type: 'integer', minimum: 1 }, parameters: { type: 'object' } } },
    ],
  };
}

export function buildBlueprintJsonSchema(options: SchemaOptions = {}): Schema {
  const sceneTypes = options.sceneTypes ?? defaultSceneTypeRegistry;
  const presets = options.presets ?? defaultPresetRegistry;
  const seconds = { type: 'number', minimum: 0 };
  const media = {
    type: 'object',
    required: ['assetId'],
    additionalProperties: false,
    properties: {
      assetId: { type: 'string' },
      role: { type: 'string', enum: ['background', 'main', 'inset'] },
      treatment: presetChoice(presets, ['brollTreatment', 'imageTreatment']),
    },
  };
  const scene = {
    type: 'object',
    required: ['type'],
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: sceneTypes.list().map((d) => d.type) },
      role: { type: 'string', description: 'Narrative role: hook, intro, context, explanation, example, evidence, statistic, twist, recap, cta, outro' },
      startSeconds: seconds,
      endSeconds: seconds,
      durationSeconds: { type: 'number', exclusiveMinimum: 0 },
      script: { type: 'string', description: 'Narration spoken during the scene' },
      words: { type: 'array', items: { type: 'object', required: ['text', 'startSeconds', 'endSeconds'], properties: { text: { type: 'string' }, startSeconds: seconds, endSeconds: seconds } } },
      headline: { type: 'string', description: 'Main on-screen text. Short.' },
      subtext: { type: 'string' },
      quote: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, author: { type: 'string' } } },
      statistic: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'number' }, from: { type: 'number' }, prefix: { type: 'string' }, suffix: { type: 'string' }, decimals: { type: 'integer', minimum: 0 }, label: { type: 'string' } },
      },
      chart: { type: 'object', required: ['kind', 'data'], properties: { kind: { type: 'string', enum: ['barChart', 'lineChart', 'pieChart'] }, data: { type: 'object' }, title: { type: 'string' } } },
      media: { type: 'array', items: media },
      visualQuery: { type: 'string', description: 'Stock footage search query when no media is chosen yet' },
      typography: presetChoice(presets, ['typography']),
      textEffect: presetChoice(presets, ['textEffect', 'animation']),
      camera: presetChoice(presets, ['camera']),
      transitionIn: presetChoice(presets, ['transition']),
      captions: { type: 'boolean' },
      notes: { type: 'string' },
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Scene blueprint document',
    type: 'object',
    required: ['version', 'scenes'],
    additionalProperties: false,
    properties: {
      version: { const: 1 },
      title: { type: 'string' },
      fps: { type: 'number', exclusiveMinimum: 0 },
      aspectRatio: { type: 'string', pattern: '^\\d+(\\.\\d+)?:\\d+(\\.\\d+)?$' },
      narration: { type: 'object', required: ['assetId'], properties: { assetId: { type: 'string' } } },
      music: { type: 'object', required: ['assetId'], properties: { assetId: { type: 'string' }, volume: { type: 'number', minimum: 0, maximum: 1 }, duckTo: { type: 'number', minimum: 0, maximum: 1 } } },
      style: {
        type: 'object',
        additionalProperties: false,
        properties: {
          typography: presetChoice(presets, ['typography']),
          textEffect: presetChoice(presets, ['textEffect', 'animation']),
          captions: presetChoice(presets, ['caption']),
          transition: presetChoice(presets, ['transition']),
          brollTreatment: presetChoice(presets, ['brollTreatment']),
          imageTreatment: presetChoice(presets, ['imageTreatment']),
        },
      },
      scenes: { type: 'array', minItems: 1, items: scene },
    },
  };
}

export interface AgentCatalog {
  sceneTypes: Array<{ type: string; description: string; defaultDurationInSeconds: number; defaultRole?: string }>;
  presets: Array<{ id: string; category: PresetCategory; description: string; parameters: Record<string, { type: string; default: unknown; min?: number; max?: number; options?: readonly string[] }> }>;
  rules: string[];
}

/** Compact reference for an LLM system prompt. */
export function buildAgentCatalog(options: SchemaOptions = {}): AgentCatalog {
  const sceneTypes = options.sceneTypes ?? defaultSceneTypeRegistry;
  const presets = options.presets ?? defaultPresetRegistry;
  return {
    sceneTypes: sceneTypes.list().map((d) => ({
      type: d.type,
      description: d.description,
      defaultDurationInSeconds: d.defaultDurationInSeconds,
      ...(d.defaultRole ? { defaultRole: String(d.defaultRole) } : {}),
    })),
    presets: presets.list().map((p) => ({
      id: p.id,
      category: p.category,
      description: p.description,
      parameters: Object.fromEntries(
        Object.entries(p.parameters).map(([k, v]) => [
          k,
          { type: v.type, default: v.default, ...('min' in v && v.min !== undefined ? { min: v.min } : {}), ...('max' in v && v.max !== undefined ? { max: v.max } : {}), ...('options' in v ? { options: v.options } : {}) },
        ]),
      ),
    })),
    rules: [
      'Times are in seconds. With startSeconds/endSeconds, scenes must be contiguous (each starts where the previous ended).',
      'Only reference assetIds that were provided to you.',
      'transitionIn describes the transition INTO a scene; the first scene has none.',
      'Keep headlines short (max ~8 words); put narration in script.',
      'Prefer one idea per scene; 2–6 seconds per scene for fast-paced edits.',
    ],
  };
}
