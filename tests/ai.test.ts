import { describe, expect, it } from 'vitest';
import {
  buildAgentCatalog,
  buildBlueprintJsonSchema,
  buildCaptionCues,
  buildRemotionPlan,
  compileBlueprint,
  defaultPresetRegistry,
  getTimelineDuration,
  resolveTimeline,
  SceneComposerRegistry,
  sequentialIds,
  validateBlueprint,
  type AssetRegistry,
  type BlueprintDocument,
} from '../src/index.js';
import { codes } from './helpers.js';

const assets: AssetRegistry = {
  narration: { id: 'narration', kind: 'audio', src: 'vo.mp3', durationInSeconds: 20 },
  music: { id: 'music', kind: 'audio', src: 'bed.mp3', durationInSeconds: 90 },
  restaurant: { id: 'restaurant', kind: 'video', src: 'restaurant.mp4', durationInSeconds: 10 },
  kitchen: { id: 'kitchen', kind: 'video', src: 'kitchen.mp4', durationInSeconds: 10 },
  land: { id: 'land', kind: 'image', src: 'land.jpg' },
  article: { id: 'article', kind: 'image', src: 'article.png' },
};

/** The example from the spec, expressed as a blueprint an LLM would output. */
const mcdonalds: BlueprintDocument = {
  version: 1,
  title: 'McDonalds is a real estate company',
  aspectRatio: '16:9',
  narration: { assetId: 'narration' },
  music: { assetId: 'music', volume: 0.3, duckTo: 0.25 },
  style: { captions: 'caption-bold-pop', transition: 'smooth-crossfade', brollTreatment: 'broll-cinematic' },
  scenes: [
    { type: 'title', role: 'hook', startSeconds: 0, endSeconds: 4, script: "McDonald's doesn't actually make most of its money from burgers…", headline: 'Not a burger company', textEffect: 'kinetic-slam-words', media: [{ assetId: 'restaurant', role: 'background' }], camera: 'cinematic-zoom' },
    { type: 'broll', role: 'explanation', startSeconds: 4, endSeconds: 9, script: 'It makes it from the land under its restaurants.', headline: 'The real business', media: [{ assetId: 'kitchen' }], transitionIn: 'whip-fast' },
    { type: 'statistic', role: 'statistic', startSeconds: 9, endSeconds: 13, script: 'Rent and royalties bring in the majority of revenue.', statistic: { value: 61, suffix: '%', label: 'of revenue from franchisees' }, camera: { presetId: 'impact-shake', durationInFrames: 12 }, transitionIn: 'flash-cut' },
    { type: 'chart', startSeconds: 13, endSeconds: 17, script: 'Franchised revenue dwarfs company-operated sales.', chart: { kind: 'barChart', data: { labels: ['Company', 'Franchised'], values: [8.3, 15.4] }, title: 'Revenue 2023 (B$)' } },
    { type: 'screenshot', startSeconds: 17, endSeconds: 20, script: 'Analysts have said it for years.', media: [{ assetId: 'article' }], transitionIn: { presetId: 'push-slide', parameters: { direction: 'up' } } },
  ],
};

describe('AI blueprint → project', () => {
  const result = compileBlueprint(mcdonalds, { assets, ids: sequentialIds('ai') });

  it('compiles the spec example into a valid project', () => {
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
    expect(result.validation.errors).toEqual([]);
    expect(result.project.scenes.map((s) => s.type)).toEqual(['title', 'broll', 'statistic', 'chart', 'screenshot']);
    expect(result.project.scenes.map((s) => s.metadata?.role)).toEqual(['hook', 'explanation', 'statistic', 'evidence', 'evidence']);
  });

  it('keeps every scene aligned with its narrative window', () => {
    if (!result.ok) throw new Error('compile failed');
    const t = resolveTimeline(result.project);
    expect(t.scenes.map((s) => s.startFrame)).toEqual([0, 120, 270, 390, 510]);
    expect(getTimelineDuration(result.project.scenes)).toBe(600);
    const vo = t.audio.filter((a) => a.role === 'voiceover');
    expect(vo.map((v) => [v.startFrame, v.endFrame])).toEqual([[0, 120], [120, 270], [270, 390], [390, 510], [510, 600]]);
    expect(result.project.scenes[1]!.voiceover!.trim).toEqual({ startFrom: 120, endAt: 270 });
  });

  it('expands presets into plain data', () => {
    if (!result.ok) throw new Error('compile failed');
    const [hook, broll, stat, chart, shot] = result.project.scenes;
    expect(hook!.animations[0]).toMatchObject({ type: 'camera', presetId: 'cinematic-zoom' });
    expect(hook!.layers.find((l) => l.type === 'text')!.animations[0]).toMatchObject({ type: 'kineticTypography', style: 'slam' });
    expect(broll!.transitionIn).toMatchObject({ type: 'whip', presetId: 'whip-fast' });
    expect(broll!.layers.find((l) => l.type === 'video')!.effects.map((e) => e.type)).toEqual(['colorGrade', 'vignette', 'grain']);
    expect(stat!.layers.find((l) => l.type === 'graphic')).toMatchObject({ kind: 'counter', data: { from: 0, to: 61, suffix: '%' } });
    expect(stat!.animations[0]).toMatchObject({ type: 'shake', durationInFrames: 12 });
    expect(chart!.transitionIn).toMatchObject({ type: 'crossfade' }); // style default
    expect(shot!.transitionIn).toMatchObject({ type: 'push', direction: 'up' });
    expect(result.project.audio[0]).toMatchObject({ role: 'music', ducking: { amount: 0.25 } });
  });

  it('adds caption tracks and caption layers', () => {
    if (!result.ok) throw new Error('compile failed');
    for (const s of result.project.scenes) {
      expect(s.captions!.cues.length).toBeGreaterThan(0);
      expect(s.layers.some((l) => l.type === 'caption')).toBe(true);
      const last = s.captions!.cues[s.captions!.cues.length - 1]!;
      expect(last.endFrame).toBeLessThanOrEqual(s.voiceover!.durationInFrames);
    }
  });

  it('is deterministic', () => {
    const again = compileBlueprint(mcdonalds, { assets, ids: sequentialIds('ai') });
    expect(again).toEqual(result);
  });

  it('feeds straight into the Remotion adapter', () => {
    if (!result.ok) throw new Error('compile failed');
    expect(buildRemotionPlan(result.project).composition.durationInFrames).toBe(600);
  });

  it('lays out untimed scenes back to back with type defaults', () => {
    const r = compileBlueprint({ version: 1, scenes: [{ type: 'title', headline: 'Hi' }, { type: 'text', headline: 'There', durationSeconds: 2, transitionIn: 'smooth-crossfade' }, { type: 'endcard', headline: 'Bye' }] }, { assets });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.project.scenes.map((s) => s.durationInFrames)).toEqual([90 + 15, 60, 150]);
    expect(getTimelineDuration(r.project.scenes)).toBe(300);
  });

  it('shortens transitions that do not fit and says so', () => {
    const r = compileBlueprint({ version: 1, scenes: [{ type: 'text', headline: 'a', durationSeconds: 0.5 }, { type: 'text', headline: 'b', durationSeconds: 0.5, transitionIn: 'dip-to-black' }] }, { assets });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.scenes[1]!.transitionIn!.durationInFrames).toBe(7);
      expect(r.notes[0]).toMatch(/shortened/);
    }
  });

  it('supports custom composers for new scene types', () => {
    const composers = new SceneComposerRegistry().register('text', () => []);
    const r = compileBlueprint({ version: 1, scenes: [{ type: 'custom', headline: 'x' }] }, { composers });
    expect(r.ok).toBe(true);
    const r2 = compileBlueprint({ version: 1, scenes: [{ type: 'text', headline: 'x' }] }, { composers });
    expect(!r2.ok && codes(r2.errors)).toContain('scene.type.contract'); // empty composer output violates the "text" contract
  });
});

describe('blueprint validation (feedback for the model)', () => {
  const errors = (doc: unknown) => codes(validateBlueprint(doc, { assetIds: new Set(Object.keys(assets)) }).errors);
  it('catches common LLM mistakes', () => {
    expect(errors({ version: 2, scenes: [] })).toEqual(['blueprint.version', 'blueprint.scenes']);
    expect(errors({ version: 1, scenes: [{ type: 'vlog' }] })).toEqual(['blueprint.scene.type']);
    expect(errors({ version: 1, scenes: [{ type: 'title', startSeconds: 0, endSeconds: 3 }, { type: 'title', startSeconds: 4, endSeconds: 6 }] })).toEqual(['blueprint.timing.gap']);
    expect(errors({ version: 1, scenes: [{ type: 'title', startSeconds: 0 }] })).toEqual(['blueprint.timing.partial']);
    expect(errors({ version: 1, scenes: [{ type: 'title', camera: 'fade-in' }] })).toEqual(['blueprint.preset.category']);
    expect(errors({ version: 1, scenes: [{ type: 'title', transitionIn: 'star-wipe' }] })).toEqual(['blueprint.preset.unknown']);
    expect(errors({ version: 1, scenes: [{ type: 'title', camera: { presetId: 'cinematic-zoom', parameters: { intensity: 99 } } }] })).toEqual(['blueprint.preset.parameters']);
    expect(errors({ version: 1, scenes: [{ type: 'broll', media: [{ assetId: 'ghost' }] }] })).toEqual(['blueprint.asset.missing']);
    expect(errors({ version: 1, scenes: [{ type: 'statistic', statistic: { value: 'lots' } }] })).toEqual(['blueprint.statistic']);
  });
  it('compileBlueprint returns the same errors instead of throwing', () => {
    const r = compileBlueprint({ version: 1, scenes: [{ type: 'vlog' }] } as unknown as BlueprintDocument);
    expect(r.ok).toBe(false);
  });
});

describe('caption cue estimation', () => {
  it('spreads cues over the window proportionally to text length', () => {
    const cues = buildCaptionCues({ type: 'text', script: 'one two three four five six seven eight' }, { startFrame: 0, endFrame: 80 }, 30, sequentialIds(), 4);
    expect(cues.map((c) => c.text)).toEqual(['one two three four', 'five six seven eight']);
    expect(cues[0]!.startFrame).toBe(0);
    expect(cues[1]!.endFrame).toBe(80);
  });
  it('uses word timings when available', () => {
    const cues = buildCaptionCues(
      { type: 'text', words: [{ text: 'hello', startSeconds: 10, endSeconds: 10.5 }, { text: 'there', startSeconds: 10.5, endSeconds: 11 }] },
      { startFrame: 300, endFrame: 360 },
      30,
      sequentialIds(),
    );
    expect(cues).toEqual([{ id: 'cue_1', text: 'hello there', startFrame: 0, endFrame: 30, words: [{ text: 'hello', startFrame: 0, endFrame: 15 }, { text: 'there', startFrame: 15, endFrame: 30 }] }]);
  });
});

describe('schema and catalog for LLMs', () => {
  it('is generated from the live registries', () => {
    const schema = buildBlueprintJsonSchema() as { properties: { scenes: { items: { properties: { type: { enum: string[] }; camera: { anyOf: Array<{ enum?: string[] }> } } } } } };
    const sceneProps = schema.properties.scenes.items.properties;
    expect(sceneProps.type.enum).toEqual(expect.arrayContaining(['title', 'broll', 'statistic', 'talking_head', 'endcard']));
    expect(sceneProps.camera.anyOf[0]!.enum).toEqual(defaultPresetRegistry.list('camera').map((p) => p.id));
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
  it('lists scene types, presets with parameters, and rules', () => {
    const catalog = buildAgentCatalog();
    expect(catalog.sceneTypes).toHaveLength(13);
    expect(catalog.presets.find((p) => p.id === 'cinematic-zoom')!.parameters.intensity).toEqual({ type: 'number', default: 0.35, min: 0, max: 2 });
    expect(catalog.rules.length).toBeGreaterThan(0);
  });
});
