/**
 * JSON (de)serialization with a versioned envelope and forward migrations.
 *
 *   { "format": "studio-engine/project", "schemaVersion": 1, "project": { ... } }
 *
 * The model is plain JSON-safe data by design (no classes, no functions,
 * no Infinity/NaN, no Dates), so serialization is a validated JSON.stringify.
 */
import { SCHEMA_VERSION } from '../core/factories.js';
import type { Scene, VideoProject } from '../model/scene.js';
import type { AssetRegistry } from '../model/assets.js';
import { isObject } from '../validation/guards.js';
import { SceneValidationError, type ValidationIssue, type ValidationResult } from '../validation/issues.js';
import { validateProject, validateScene, type ValidationOptions } from '../validation/validate.js';

export const PROJECT_FORMAT = 'studio-engine/project';
export const SCENE_FORMAT = 'studio-engine/scene';

export interface ProjectDocument {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  project: VideoProject;
}

export interface SceneDocument {
  format: typeof SCENE_FORMAT;
  schemaVersion: number;
  scene: Scene;
}

/** Upgrades a raw project object from `from` to `from + 1`. */
export type Migration = (project: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version they upgrade FROM. Empty while the schema is at v1. */
export const MIGRATIONS: ReadonlyMap<number, Migration> = new Map();

export function migrateProject(raw: Record<string, unknown>, migrations: ReadonlyMap<number, Migration> = MIGRATIONS): Record<string, unknown> {
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  let project = raw;
  while (version < SCHEMA_VERSION) {
    const migrate = migrations.get(version);
    if (!migrate) throw new Error(`No migration from schema version ${version}`);
    project = { ...migrate(project), schemaVersion: version + 1 };
    version++;
  }
  return project;
}

export interface SerializeOptions extends ValidationOptions {
  pretty?: boolean;
  /** Validate before writing (default true). Invalid projects are never written. */
  validate?: boolean;
}

export function serializeProject(project: VideoProject, options: SerializeOptions = {}): string {
  if (options.validate !== false) {
    const result = validateProject(project, options);
    if (!result.valid) throw new SceneValidationError(result);
  }
  const doc: ProjectDocument = { format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, project: { ...project, schemaVersion: SCHEMA_VERSION } };
  return JSON.stringify(doc, null, options.pretty ? 2 : undefined);
}

export type DeserializeResult<T> = { ok: true; value: T; warnings: ValidationIssue[] } | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

function parse(input: string | unknown): { value?: unknown; error?: ValidationIssue } {
  if (typeof input !== 'string') return { value: input };
  try {
    return { value: JSON.parse(input) };
  } catch (e) {
    return { error: { severity: 'error', code: 'json.parse', path: '', message: `invalid JSON: ${(e as Error).message}` } };
  }
}

function fail<T>(result: ValidationResult): DeserializeResult<T> {
  return { ok: false, errors: result.errors, warnings: result.warnings };
}

/**
 * Parse, migrate and validate a project. Accepts a `ProjectDocument` envelope
 * or a bare project object (as produced by an AI agent). Never throws.
 */
export function deserializeProject(input: string | unknown, options: ValidationOptions = {}): DeserializeResult<VideoProject> {
  const parsed = parse(input);
  if (parsed.error) return { ok: false, errors: [parsed.error], warnings: [] };
  const value = parsed.value;
  if (!isObject(value)) return { ok: false, errors: [{ severity: 'error', code: 'document.invalid', path: '', message: 'expected an object' }], warnings: [] };

  let raw: unknown = value;
  if (value.format !== undefined) {
    if (value.format !== PROJECT_FORMAT) {
      return { ok: false, errors: [{ severity: 'error', code: 'document.format', path: 'format', message: `expected format "${PROJECT_FORMAT}"` }], warnings: [] };
    }
    raw = value.project;
  }
  if (!isObject(raw)) return { ok: false, errors: [{ severity: 'error', code: 'document.project', path: 'project', message: 'missing project object' }], warnings: [] };

  let migrated: Record<string, unknown>;
  try {
    migrated = migrateProject(raw);
  } catch (e) {
    return { ok: false, errors: [{ severity: 'error', code: 'document.migration', path: 'schemaVersion', message: (e as Error).message }], warnings: [] };
  }
  const result = validateProject(migrated, options);
  if (!result.valid) return fail(result);
  return { ok: true, value: migrated as unknown as VideoProject, warnings: result.warnings };
}

export function serializeScene(scene: Scene, options: { pretty?: boolean } = {}): string {
  const doc: SceneDocument = { format: SCENE_FORMAT, schemaVersion: SCHEMA_VERSION, scene };
  return JSON.stringify(doc, null, options.pretty ? 2 : undefined);
}

export function deserializeScene(input: string | unknown, context: { fps: number; assets?: AssetRegistry }, options: ValidationOptions = {}): DeserializeResult<Scene> {
  const parsed = parse(input);
  if (parsed.error) return { ok: false, errors: [parsed.error], warnings: [] };
  const value = parsed.value;
  const raw = isObject(value) && value.format === SCENE_FORMAT ? value.scene : value;
  const result = validateScene(raw, context, options);
  if (!result.valid) return fail(result);
  return { ok: true, value: raw as Scene, warnings: result.warnings };
}

/** Deep copy through JSON. Cheap way to get an independent editable project. */
export function cloneProject(project: VideoProject): VideoProject {
  return JSON.parse(JSON.stringify(project)) as VideoProject;
}
