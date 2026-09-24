import { defaultSceneTypeRegistry, type SceneTypeRegistry } from '../core/sceneTypes.js';
import { defaultPresetRegistry, type PresetRegistry } from '../presets/registry.js';
import type { PresetCategory } from '../presets/types.js';
import { isFiniteNumber, isNonEmptyString, isObject, isString } from '../validation/guards.js';
import { IssueCollector, type ValidationResult } from '../validation/issues.js';

export interface BlueprintValidationOptions {
  sceneTypes?: SceneTypeRegistry;
  presets?: PresetRegistry;
  /** Known asset ids. When given, media / narration references are checked. */
  assetIds?: ReadonlySet<string>;
}

/**
 * Validate an AI-produced blueprint BEFORE compiling it. Messages are written
 * so they can be fed back to the model for self-correction.
 */
export function validateBlueprint(doc: unknown, options: BlueprintValidationOptions = {}): ValidationResult {
  const issues = new IssueCollector();
  const sceneTypes = options.sceneTypes ?? defaultSceneTypeRegistry;
  const presets = options.presets ?? defaultPresetRegistry;

  const checkPreset = (value: unknown, path: string, categories: PresetCategory[]) => {
    if (value === undefined) return;
    const ref = isString(value) ? { presetId: value } : value;
    if (!isObject(ref) || !isNonEmptyString(ref.presetId)) return issues.error(path, 'blueprint.preset.invalid', 'must be a preset id or { presetId, parameters? }');
    if (!presets.has(ref.presetId)) return issues.error(path, 'blueprint.preset.unknown', `unknown preset "${ref.presetId}"`);
    const cat = presets.get(ref.presetId).category;
    if (!categories.includes(cat)) return issues.error(path, 'blueprint.preset.category', `"${ref.presetId}" is a ${cat} preset, expected ${categories.join(' or ')}`);
    if (ref.parameters !== undefined) {
      try {
        presets.resolveParams(ref.presetId, ref.parameters as never);
      } catch (e) {
        issues.error(`${path}.parameters`, 'blueprint.preset.parameters', (e as Error).message);
      }
    }
  };
  const checkAsset = (id: unknown, path: string) => {
    if (!isNonEmptyString(id)) return issues.error(path, 'blueprint.asset.invalid', 'assetId must be a non-empty string');
    if (options.assetIds && !options.assetIds.has(id)) issues.error(path, 'blueprint.asset.missing', `asset "${id}" does not exist`);
  };

  if (!isObject(doc)) {
    issues.error('', 'blueprint.invalid', 'blueprint must be an object');
    return issues.result();
  }
  if (doc.version !== 1) issues.error('version', 'blueprint.version', 'version must be 1');
  if (doc.fps !== undefined && !(isFiniteNumber(doc.fps) && doc.fps > 0)) issues.error('fps', 'blueprint.fps', 'fps must be > 0');
  if (isObject(doc.narration)) checkAsset(doc.narration.assetId, 'narration.assetId');
  if (isObject(doc.music)) checkAsset(doc.music.assetId, 'music.assetId');
  if (isObject(doc.style)) {
    const s = doc.style;
    checkPreset(s.typography, 'style.typography', ['typography']);
    checkPreset(s.textEffect, 'style.textEffect', ['textEffect', 'animation']);
    checkPreset(s.captions, 'style.captions', ['caption']);
    checkPreset(s.transition, 'style.transition', ['transition']);
    checkPreset(s.brollTreatment, 'style.brollTreatment', ['brollTreatment']);
    checkPreset(s.imageTreatment, 'style.imageTreatment', ['imageTreatment']);
  }
  if (!Array.isArray(doc.scenes) || doc.scenes.length === 0) {
    issues.error('scenes', 'blueprint.scenes', 'scenes must be a non-empty array');
    return issues.result();
  }

  let prevEnd = 0;
  doc.scenes.forEach((s, i) => {
    const p = `scenes[${i}]`;
    if (!isObject(s)) return issues.error(p, 'blueprint.scene.invalid', 'scene must be an object');
    if (!isNonEmptyString(s.type) || !sceneTypes.has(s.type)) {
      issues.error(`${p}.type`, 'blueprint.scene.type', `type must be one of ${sceneTypes.list().map((d) => d.type).join(', ')}`);
    }
    const hasStart = s.startSeconds !== undefined;
    const hasEnd = s.endSeconds !== undefined;
    if (hasStart !== hasEnd) issues.error(p, 'blueprint.timing.partial', 'give both startSeconds and endSeconds, or neither');
    if (hasStart && hasEnd) {
      if (!isFiniteNumber(s.startSeconds) || !isFiniteNumber(s.endSeconds) || s.endSeconds <= s.startSeconds) {
        issues.error(p, 'blueprint.timing.invalid', 'endSeconds must be greater than startSeconds');
      } else {
        if (Math.abs(s.startSeconds - prevEnd) > 0.001) {
          issues.error(`${p}.startSeconds`, 'blueprint.timing.gap', `scene must start where the previous one ended (${prevEnd}s), got ${s.startSeconds}s`);
        }
        prevEnd = s.endSeconds;
      }
    } else if (s.durationSeconds !== undefined) {
      if (!isFiniteNumber(s.durationSeconds) || s.durationSeconds <= 0) issues.error(`${p}.durationSeconds`, 'blueprint.duration', 'durationSeconds must be > 0');
      else prevEnd += s.durationSeconds;
    }
    if (Array.isArray(s.media)) s.media.forEach((m, mi) => {
      if (!isObject(m)) return issues.error(`${p}.media[${mi}]`, 'blueprint.media.invalid', 'media must be an object');
      checkAsset(m.assetId, `${p}.media[${mi}].assetId`);
      checkPreset(m.treatment, `${p}.media[${mi}].treatment`, ['brollTreatment', 'imageTreatment']);
    });
    else if (s.media !== undefined) issues.error(`${p}.media`, 'blueprint.media.invalid', 'media must be an array');
    checkPreset(s.typography, `${p}.typography`, ['typography']);
    checkPreset(s.textEffect, `${p}.textEffect`, ['textEffect', 'animation']);
    checkPreset(s.camera, `${p}.camera`, ['camera']);
    checkPreset(s.transitionIn, `${p}.transitionIn`, ['transition']);
    if (isObject(s.statistic) && !isFiniteNumber(s.statistic.value)) issues.error(`${p}.statistic.value`, 'blueprint.statistic', 'statistic.value must be a number');
    if (isObject(s.quote) && !isNonEmptyString(s.quote.text)) issues.error(`${p}.quote.text`, 'blueprint.quote', 'quote.text is required');
    if (Array.isArray(s.words)) s.words.forEach((w, wi) => {
      if (!isObject(w) || !isString(w.text) || !isFiniteNumber(w.startSeconds) || !isFiniteNumber(w.endSeconds) || w.endSeconds <= w.startSeconds) {
        issues.error(`${p}.words[${wi}]`, 'blueprint.word', 'word needs text, startSeconds < endSeconds');
      }
    });
  });
  return issues.result();
}
