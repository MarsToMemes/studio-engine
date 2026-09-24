/**
 * ShotPlan validation.
 *
 * Errors: the plan cannot be compiled (missing media, invalid durations…).
 * Warnings: editorial lint from the documentary motion language — they never
 * block a render, because unknown skills / transitions fall back safely.
 */
import type { AssetKind } from '../model/assets.js';
import { isFiniteNumber, isNonEmptyString, isObject, isOneOf, isPositiveInteger, isNonNegativeInteger, isString } from '../validation/guards.js';
import { IssueCollector, type ValidationIssue, type ValidationResult } from '../validation/issues.js';
import { ruleForIssue } from '../bible/index.js';
import { defaultTransitionRegistry, type TransitionRegistry } from '../transitions/registry.js';
import { getEditorialTransition } from './transitions.js';
import { resolveShotTransitions } from './timeline.js';
import { validateEditorialLayer, type SkillCatalog, type ValidationStage } from './validate-editorial.js';
import type { Shot, ShotPlan, ShotType } from './types.js';

export const SHOT_TYPES: readonly ShotType[] = ['image', 'video', 'text', 'number', 'document', 'chart', 'map', 'revelation', 'chapter'];
export const INTENSITIES = ['subtle', 'medium', 'strong'] as const;

/** Documentary pacing rules, in seconds. */
export const PACING = {
  hook: { min: 1.5, max: 2.5 },
  body: { min: 2.5, max: 4 },
  /** A shot longer than this needs movement (a motion skill) to avoid a static image. */
  maxStaticSeconds: 4,
  /** Share of cuts that may use a spectacular transition before it is flagged. */
  maxSpectacularRatio: 0.25,
  /** Glitch transitions per video (bible TRANS-03). */
  maxGlitches: 3,
} as const;

const MEDIA_KINDS: Partial<Record<ShotType, readonly AssetKind[]>> = {
  image: ['image', 'svg'],
  document: ['image', 'svg'],
  video: ['video'],
};

const MEDIA_REQUIRED: readonly ShotType[] = ['image', 'video', 'document'];
const TEXT_REQUIRED: readonly ShotType[] = ['text', 'revelation', 'chapter'];

export interface ShotPlanValidationOptions {
  /** Ids of the motion skills actually installed. When given, unknown skills are reported. */
  skillIds?: ReadonlySet<string>;
  /** Resolves a SFX id to an asset id. Defaults to looking the id up in `plan.assets`. */
  resolveSfx?: (id: string) => string | undefined;
  transitions?: TransitionRegistry;
  /**
   * `draft` (default): blocking editorial rules (intent, reasons, scenes,
   * hierarchy, licenses) are warnings, so a plan in progress can be previewed.
   * `final`: they are errors (before the final render, or for the AI's output).
   */
  stage?: ValidationStage;
  /** Installed skills (categories), for the restraint rule MOT-03. `compileShotPlan` passes its registry. */
  skillCatalog?: SkillCatalog;
}

/** Words of a text, normalised for highlight matching. */
export function normalizeWord(word: string): string {
  return word.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function isHookShot(shot: Shot, index: number): boolean {
  return shot.metadata?.role === 'hook' || (index === 0 && shot.metadata?.role === undefined);
}

/** Validates a plan. Every issue cites the VIDEO_EDITING_BIBLE.md rule it enforces (`issue.rule`) when there is one. */
export function validateShotPlan(input: unknown, options: ShotPlanValidationOptions = {}): ValidationResult {
  const r = collectShotPlanIssues(input, options);
  const cite = (i: ValidationIssue): ValidationIssue => {
    const rule = ruleForIssue(i);
    return rule ? { ...i, rule } : i;
  };
  return { valid: r.valid, errors: r.errors.map(cite), warnings: r.warnings.map(cite) };
}

function collectShotPlanIssues(input: unknown, options: ShotPlanValidationOptions): ValidationResult {
  const issues = new IssueCollector();
  if (!isObject(input)) {
    issues.error('', 'plan.invalid', 'shot plan must be an object');
    return issues.result();
  }
  const plan = input as Partial<ShotPlan> & Record<string, unknown>;
  if (plan.version !== 1 && plan.version !== 2) issues.error('version', 'plan.version', 'version must be 1 or 2');
  const fpsOk = isFiniteNumber(plan.fps) && plan.fps > 0 && plan.fps <= 240;
  if (!fpsOk) issues.error('fps', 'plan.fps', 'fps must be a number in (0, 240]');
  for (const k of ['width', 'height'] as const) {
    if (!isPositiveInteger(plan[k])) issues.error(k, 'plan.size', `${k} must be a positive integer`);
    else if (plan[k] % 2 !== 0) issues.error(k, 'plan.size.odd', `${k} must be even (H.264)`);
  }
  const assets = isObject(plan.assets) ? plan.assets : undefined;
  if (!assets) issues.error('assets', 'plan.assets', 'assets must be an object keyed by asset id');

  const checkAsset = (id: unknown, path: string, kinds: readonly AssetKind[]) => {
    if (!isNonEmptyString(id)) return issues.error(path, 'asset.id.invalid', 'asset id must be a non-empty string');
    const asset = assets?.[id] as { kind?: AssetKind } | undefined;
    if (!asset) return issues.error(path, 'asset.missing', `asset "${id}" is not in plan.assets`);
    if (asset.kind && !kinds.includes(asset.kind)) issues.error(path, 'asset.kind.mismatch', `asset "${id}" is a ${asset.kind}, expected ${kinds.join(' or ')}`);
  };

  if (isObject(plan.narration)) {
    checkAsset(plan.narration.assetId, 'narration.assetId', ['audio', 'video']);
    const words = plan.narration.words;
    if (words !== undefined) {
      if (!Array.isArray(words)) issues.error('narration.words', 'narration.words.invalid', 'words must be an array');
      else {
        let prev = -Infinity;
        words.forEach((w, i) => {
          const p = `narration.words[${i}]`;
          if (!isObject(w) || !isString(w.text) || !isFiniteNumber(w.startMs) || !isFiniteNumber(w.endMs)) return issues.error(p, 'narration.word.invalid', 'word needs text, startMs and endMs');
          if (w.endMs < w.startMs) issues.error(p, 'narration.word.range', 'endMs must be >= startMs');
          if (w.startMs < prev) issues.error(p, 'narration.word.order', 'words must be sorted by startMs');
          prev = w.startMs;
        });
      }
    }
  }
  if (isObject(plan.music)) checkAsset(plan.music.assetId, 'music.assetId', ['audio']);

  if (!Array.isArray(plan.shots) || plan.shots.length === 0) {
    issues.error('shots', 'plan.shots', 'shots must be a non-empty array');
    return issues.result();
  }

  const fps = fpsOk ? (plan.fps as number) : 30;
  const resolveSfx = options.resolveSfx ?? ((id: string) => (assets?.[id] ? id : undefined));
  const ids = new Set<string>();
  let structural = true;

  plan.shots.forEach((raw, i) => {
    const p = `shots[${i}]`;
    if (!isObject(raw)) {
      structural = false;
      return issues.error(p, 'shot.invalid', 'shot must be an object');
    }
    const shot = raw as unknown as Shot;
    if (!isNonEmptyString(shot.id)) issues.error(`${p}.id`, 'shot.id.invalid', 'id must be a non-empty string');
    else if (ids.has(shot.id)) issues.error(`${p}.id`, 'shot.id.duplicate', `duplicate shot id "${shot.id}"`);
    else ids.add(shot.id);
    if (!isOneOf(shot.type, SHOT_TYPES)) {
      structural = false;
      issues.error(`${p}.type`, 'shot.type', `type must be one of ${SHOT_TYPES.join(', ')}`);
      return;
    }
    if (!isPositiveInteger(shot.durationInFrames)) {
      structural = false;
      issues.error(`${p}.durationInFrames`, 'shot.duration', 'durationInFrames must be a positive integer');
    }
    if (shot.intensity !== undefined && !isOneOf(shot.intensity, INTENSITIES)) issues.error(`${p}.intensity`, 'shot.intensity', 'intensity must be subtle, medium or strong');

    const kinds = MEDIA_KINDS[shot.type];
    if (MEDIA_REQUIRED.includes(shot.type) || shot.media !== undefined) checkAsset(shot.media, `${p}.media`, kinds ?? ['image', 'svg', 'video']);
    if (TEXT_REQUIRED.includes(shot.type) && !isNonEmptyString(shot.text)) issues.error(`${p}.text`, 'shot.text.required', `a ${shot.type} shot needs text`);

    if (shot.type === 'number' && !(isObject(shot.number) && isFiniteNumber(shot.number.value))) issues.error(`${p}.number`, 'shot.number.required', 'a number shot needs number.value');
    if (shot.type === 'chart') {
      const c = shot.chart;
      if (!isObject(c) || !isOneOf(c.kind, ['barChart', 'lineChart', 'pieChart'] as const) || !Array.isArray(c.labels) || !Array.isArray(c.values) || c.values.length === 0 || c.labels.length !== c.values.length || !c.values.every(isFiniteNumber)) {
        issues.error(`${p}.chart`, 'shot.chart.invalid', 'chart needs a kind and labels/values arrays of the same non-zero length');
      }
    }
    if (shot.type === 'map') {
      const m = shot.map;
      if (!isObject(m) || !Array.isArray(m.center) || m.center.length !== 2 || !m.center.every(isFiniteNumber)) issues.error(`${p}.map`, 'shot.map.invalid', 'map needs center: [longitude, latitude]');
    }
    if (shot.document?.highlights !== undefined) {
      if (!Array.isArray(shot.document.highlights)) issues.error(`${p}.document.highlights`, 'shot.document.invalid', 'highlights must be an array');
      else shot.document.highlights.forEach((h, hi) => {
        const hp = `${p}.document.highlights[${hi}]`;
        const inRange = (v: unknown) => isFiniteNumber(v) && v >= 0 && v <= 100;
        if (!isObject(h) || ![h.x, h.y, h.width, h.height].every(inRange)) return issues.error(hp, 'shot.document.region', 'highlight needs x, y, width, height in percent (0..100)');
        if (h.at !== undefined && (!isNonNegativeInteger(h.at) || (isPositiveInteger(shot.durationInFrames) && h.at >= shot.durationInFrames))) issues.warn(`${hp}.at`, 'shot.document.at', 'highlight appears outside the shot');
      });
    }

    if (shot.highlightedWords !== undefined) {
      if (!Array.isArray(shot.highlightedWords) || !shot.highlightedWords.every(isString)) issues.error(`${p}.highlightedWords`, 'shot.highlight.invalid', 'highlightedWords must be strings');
      else if (isString(shot.text)) {
        const words = new Set(shot.text.split(/\s+/).map(normalizeWord));
        for (const w of shot.highlightedWords) if (!words.has(normalizeWord(w))) issues.warn(`${p}.highlightedWords`, 'shot.highlight.notFound', `"${w}" does not appear in the shot text`);
      }
    }

    if (shot.sfx !== undefined) {
      if (!Array.isArray(shot.sfx)) issues.error(`${p}.sfx`, 'shot.sfx.invalid', 'sfx must be an array of events');
      else shot.sfx.forEach((e, ei) => {
        const ep = `${p}.sfx[${ei}]`;
        if (!isObject(e) || !isNonEmptyString(e.sfx)) return issues.error(ep, 'shot.sfx.invalid', 'sfx event needs an sfx id');
        if (e.at !== undefined && !isNonNegativeInteger(e.at)) issues.error(`${ep}.at`, 'shot.sfx.at', 'at must be a non-negative integer frame');
        else if (isPositiveInteger(shot.durationInFrames) && (e.at ?? 0) >= shot.durationInFrames) issues.warn(`${ep}.at`, 'shot.sfx.outside', 'sfx starts after the shot ends');
        if (!resolveSfx(e.sfx)) issues.warn(`${ep}.sfx`, 'shot.sfx.unresolved', `sfx "${e.sfx}" cannot be resolved; it will be skipped`);
      });
    }

    if (shot.motionSkill !== undefined) {
      if (!isNonEmptyString(shot.motionSkill)) issues.error(`${p}.motionSkill`, 'shot.skill.invalid', 'motionSkill must be a non-empty string');
      else if (options.skillIds && !options.skillIds.has(shot.motionSkill)) issues.warn(`${p}.motionSkill`, 'skill.unknown', `motion skill "${shot.motionSkill}" is not installed; a fallback will be used`);
    }

    // Editorial lint: pacing.
    if (isPositiveInteger(shot.durationInFrames)) {
      const seconds = shot.durationInFrames / fps;
      if (isHookShot(shot, i) && (seconds < PACING.hook.min || seconds > PACING.hook.max)) {
        issues.warn(`${p}.durationInFrames`, 'pacing.hook', `hook lasts ${seconds.toFixed(2)} s (recommended ${PACING.hook.min}–${PACING.hook.max} s)`);
      }
      const moving = shot.motionSkill !== undefined || (shot.camera !== undefined && shot.camera !== 'static');
      if (seconds > PACING.maxStaticSeconds && !moving && !shot.hold && shot.type !== 'video') {
        issues.warn(`${p}.motionSkill`, 'pacing.static', `${seconds.toFixed(1)} s without a motion skill: add movement, a cut or a new element`);
      }
    }
  });

  // Transitions (need valid durations to resolve).
  if (structural && fpsOk) {
    const shots = plan.shots as Shot[];
    const resolved = resolveShotTransitions({ shots, fps }, options.transitions ?? defaultTransitionRegistry);
    let spectacular = 0;
    let previousSpectacular = false;
    resolved.forEach((r, i) => {
      const p = `shots[${i}].transition`;
      if (r.unknownId) issues.warn(p, 'transition.unknown', `unknown transition "${r.unknownId}"; hard_cut is used`);
      if (r.shortenedFrom !== undefined) issues.warn(p, 'transition.shortened', `transition shortened from ${r.shortenedFrom} to ${r.transition?.durationInFrames ?? 0} frames to fit the neighbouring shots`);
      const tier = getEditorialTransition(r.id)?.tier;
      const isSpectacular = tier === 'spectacular';
      if (isSpectacular) {
        // The first shot's transition is an edge (from black), not a cut between two shots.
        if (i > 0) spectacular++;
        if (previousSpectacular) issues.warn(p, 'transition.spectacular.adjacent', 'two spectacular transitions in a row');
        if (shots[i]!.intensity === 'subtle') issues.warn(p, 'transition.spectacular.subtle', `"${r.id}" on a subtle shot`);
      }
      previousSpectacular = isSpectacular;
    });
    const cuts = Math.max(0, shots.length - 1);
    if (cuts > 0 && spectacular >= 2 && spectacular / cuts > PACING.maxSpectacularRatio) {
      issues.warn('shots', 'transition.spectacular.ratio', `${spectacular} of ${cuts} cuts use spectacular transitions (max ${Math.round(PACING.maxSpectacularRatio * 100)}%)`);
    }
    const glitches = resolved.filter((r) => r.id === 'glitch').length;
    if (glitches > PACING.maxGlitches) issues.warn('shots', 'transition.glitch.max', `${glitches} glitch transitions (max ${PACING.maxGlitches} per video, major revelations only)`);
    if (assets) validateEditorialLayer(plan as ShotPlan, issues, options.stage ?? 'draft', options.transitions, options.skillCatalog);
  }
  return issues.result();
}
