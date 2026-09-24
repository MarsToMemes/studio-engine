import { describe, expect, it } from 'vitest';
import {
  AssetLibrary,
  collectAssetReferences,
  createLayer,
  createProject,
  createScene,
  getUsedAssetIds,
  nextZIndex,
  pruneUnusedAssets,
  SceneTypeRegistry,
  SCHEMA_VERSION,
  sequentialIds,
  validateScene,
} from '../src/index.js';

describe('project and scene creation', () => {
  it('creates a project with explicit defaults', () => {
    const p = createProject({ aspectRatio: '9:16', fps: 60, name: 'Short' });
    expect(p).toMatchObject({ schemaVersion: SCHEMA_VERSION, fps: 60, aspectRatio: '9:16', dimensions: { width: 1080, height: 1920 }, scenes: [], audio: [], assets: {} });
    expect(p.id).toMatch(/^project_/);
  });

  it('uses the scene type default duration and role', () => {
    const s = createScene('title', {}, { fps: 30, ids: sequentialIds() });
    expect(s).toMatchObject({ id: 'scene_1', type: 'title', durationInFrames: 90, layers: [], audio: [], animations: [], effects: [], metadata: { role: 'hook' } });
    expect(createScene('talking_head', {}, { fps: 25 }).durationInFrames).toBe(150);
  });

  it('keeps explicit values and never adds undefined keys', () => {
    const s = createScene('custom', { id: 'x', durationInFrames: 12 });
    expect(s.id).toBe('x');
    expect(Object.values(s).includes(undefined)).toBe(false);
    expect('transitionIn' in s).toBe(false);
  });

  it('creates layers with neutral transforms', () => {
    const l = createLayer('text', { text: 'Hello', style: { fontSize: 40 } }, { ids: sequentialIds('t') });
    expect(l).toMatchObject({ id: 't_layer_1', type: 'text', zIndex: 0, scale: 1, rotation: 0, opacity: 1, animations: [], effects: [], position: { anchor: 'center', x: 0, y: 0, units: 'percent' } });
    expect(nextZIndex([l, { ...l, zIndex: 7 }])).toBe(8);
    expect(nextZIndex([])).toBe(0);
  });

  it('sequential ids are deterministic per prefix', () => {
    const ids = sequentialIds();
    expect([ids('scene'), ids('layer'), ids('scene')]).toEqual(['scene_1', 'layer_1', 'scene_2']);
  });

  it('supports registering new scene types without touching the model', () => {
    const registry = new SceneTypeRegistry().register({
      type: 'map',
      label: 'Map',
      description: 'Animated map route',
      defaultDurationInSeconds: 6,
      allowedLayerTypes: ['background', 'graphic', 'text'],
      check: (s) => (s.layers.some((l) => l.type === 'graphic') ? undefined : 'a map scene needs a graphic layer'),
    });
    const scene = createScene('map', {}, { fps: 30, sceneTypes: registry });
    expect(scene.durationInFrames).toBe(180);
    expect(validateScene(scene, { fps: 30 }, { sceneTypes: registry }).errors.map((e) => e.code)).toEqual(['scene.type.contract']);
    scene.layers.push(createLayer('graphic', { kind: 'custom', data: { route: [] } }));
    expect(validateScene(scene, { fps: 30 }, { sceneTypes: registry }).valid).toBe(true);
    scene.layers.push(createLayer('video', { assetId: 'v', fit: 'cover' }));
    expect(validateScene(scene, { fps: 30 }, { sceneTypes: registry }).errors.map((e) => e.code)).toContain('scene.layer.notAllowed');
    expect(validateScene(scene, { fps: 30 }).errors.map((e) => e.code)).toContain('scene.type.unknown');
  });
});

describe('asset library', () => {
  it('deduplicates by kind + src and by checksum', () => {
    const lib = new AssetLibrary({}, sequentialIds());
    const a = lib.add({ kind: 'image', src: 'a.png' });
    expect(lib.add({ kind: 'image', src: 'a.png', width: 10 })).toBe(a);
    expect(lib.add({ kind: 'video', src: 'a.png' })).not.toBe(a);
    const c = lib.add({ kind: 'image', src: 'https://cdn/x.png', checksum: 'abc' });
    expect(lib.add({ kind: 'image', src: 'https://mirror/x.png', checksum: 'abc' })).toBe(c);
    expect(lib.size).toBe(3);
    expect(() => lib.add({ id: a, kind: 'audio', src: 'other.mp3' })).toThrow();
  });

  it('collects references with their paths and prunes unused assets', () => {
    const p = createProject({ id: 'p' });
    p.assets = { img: { id: 'img', kind: 'image', src: 'i.png' }, unused: { id: 'unused', kind: 'image', src: 'u.png' }, vo: { id: 'vo', kind: 'audio', src: 'v.mp3' } };
    p.scenes = [createScene('image', { id: 's', background: { type: 'image', assetId: 'img' }, voiceover: { id: 'v', assetId: 'vo', durationInFrames: 10 } })];
    expect(collectAssetReferences(p).map((r) => r.path)).toEqual(['scenes[0].background.assetId', 'scenes[0].voiceover.assetId']);
    expect(getUsedAssetIds(p)).toEqual(['img', 'vo']);
    expect(Object.keys(pruneUnusedAssets(p).assets)).toEqual(['img', 'vo']);
  });
});
