import { describe, expect, it } from 'vitest';
import { cloneProject, deserializeProject, deserializeScene, migrateProject, PROJECT_FORMAT, SceneValidationError, serializeProject, serializeScene } from '../src/index.js';
import { buildDocumentaryProject } from './fixtures/documentary.js';
import { codes, simpleProject } from './helpers.js';

describe('project serialization', () => {
  it('round-trips through a versioned envelope', () => {
    const project = simpleProject([90, 60], [undefined, { type: 'crossfade', durationInFrames: 10 }]);
    const json = serializeProject(project, { pretty: true });
    const doc = JSON.parse(json);
    expect(doc).toMatchObject({ format: PROJECT_FORMAT, schemaVersion: 1 });
    const back = deserializeProject(json);
    expect(back.ok && back.value).toEqual(project);
  });

  it('accepts a bare project object (e.g. from an AI agent)', () => {
    const project = simpleProject([30]);
    expect(deserializeProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
  });

  it('never writes an invalid project', () => {
    const project = simpleProject([30]);
    project.scenes[0]!.durationInFrames = -3;
    expect(() => serializeProject(project)).toThrow(SceneValidationError);
    expect(() => serializeProject(project, { validate: false })).not.toThrow();
  });

  it('reports parse, format, version and validation errors without throwing', () => {
    const r1 = deserializeProject('{not json');
    expect(!r1.ok && codes(r1.errors)).toEqual(['json.parse']);
    const r2 = deserializeProject({ format: 'other/format', project: {} });
    expect(!r2.ok && codes(r2.errors)).toEqual(['document.format']);
    const future = { ...simpleProject([30]), schemaVersion: 7 };
    const r3 = deserializeProject(future);
    expect(!r3.ok && codes(r3.errors)).toContain('project.schema.future');
    const broken = simpleProject([30]) as unknown as Record<string, unknown>;
    (broken.scenes as Array<Record<string, unknown>>)[0]!.layers = 'x';
    const r4 = deserializeProject(broken);
    expect(!r4.ok && codes(r4.errors)).toContain('scene.layers.invalid');
  });

  it('runs migrations in order up to the current version', () => {
    const migrations = new Map([[0, (p: Record<string, unknown>) => ({ ...p, renamed: true })]]);
    expect(migrateProject({ schemaVersion: 0 }, migrations)).toEqual({ schemaVersion: 1, renamed: true });
    expect(() => migrateProject({ schemaVersion: 0 })).toThrow(/No migration/);
  });

  it('produces JSON-safe data only (no undefined, Infinity or NaN)', () => {
    const project = buildDocumentaryProject();
    const json = serializeProject(project);
    expect(json).not.toMatch(/null/); // Infinity / NaN would serialize to null
    expect(JSON.parse(json).project).toEqual(project);
  });

  it('clones deeply', () => {
    const project = buildDocumentaryProject();
    const copy = cloneProject(project);
    copy.scenes[0]!.durationInFrames = 1;
    expect(project.scenes[0]!.durationInFrames).not.toBe(1);
  });
});

describe('scene serialization', () => {
  it('round-trips a single scene (clipboard / AI edits)', () => {
    const project = buildDocumentaryProject();
    const scene = project.scenes[3]!;
    const back = deserializeScene(serializeScene(scene), { fps: 30, assets: project.assets });
    expect(back.ok && back.value).toEqual(scene);
    const missingAssets = deserializeScene(serializeScene(scene), { fps: 30, assets: {} });
    expect(!missingAssets.ok && codes(missingAssets.errors)).toContain('asset.missing');
  });
});
