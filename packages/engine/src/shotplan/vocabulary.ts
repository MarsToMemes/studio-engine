/**
 * Closed vocabularies of the editorial layer (ShotPlan version 2), the words
 * of VIDEO_EDITING_BIBLE.md. The AI director picks from these lists; anything
 * else is a validation error (or, for registries like camera moves, a
 * fallback).
 */

/** What the shot is for (bible §4, grammar). */
export const EDITORIAL_INTENTS = [
  'hook',
  'context',
  'fact',
  'important_fact',
  'keyword',
  'number',
  'statistic',
  'comparison',
  'quote',
  'proof',
  'location',
  'process',
  'contradiction',
  'revelation',
  'aftermath',
  'chapter',
  'conclusion',
] as const;
export type EditorialIntent = (typeof EDITORIAL_INTENTS)[number];

/** Narrative step of a shot inside its scene (bible §3). */
export const BEATS = ['setup', 'development', 'contradiction', 'escalation', 'revelation', 'proof', 'payoff', 'aftermath', 'transition'] as const;
export type Beat = (typeof BEATS)[number];

/** Beats that resolve a scene (SCENE-02). */
export const RESOLVING_BEATS: readonly Beat[] = ['payoff', 'revelation', 'proof'];

/** Music states (bible §12). */
export const MUSIC_STATES = ['calm', 'build', 'tension', 'reveal', 'aftermath'] as const;
export type MusicState = (typeof MUSIC_STATES)[number];

/** Camera movements (bible §7). Implemented in `skills/camera.ts`. */
export const SHOT_CAMERA_MOVES = ['static', 'push_in', 'pull_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'tracking', 'parallax', 'punch_in', 'punch_out', 'shake'] as const;
export type ShotCameraMove = (typeof SHOT_CAMERA_MOVES)[number];

/**
 * Shot size. `wide` → `extreme_close_up` crop the media around `focus`;
 * `overhead` and `pov` describe the source image (used to pick assets) and
 * do not transform it.
 */
export const FRAMINGS = ['wide', 'medium', 'close_up', 'extreme_close_up', 'overhead', 'pov'] as const;
export type Framing = (typeof FRAMINGS)[number];

/** Scale of a framing on the media (1 = the whole media). */
export const FRAMING_SCALE: Record<Framing, number | undefined> = {
  wide: 1,
  medium: 1.15,
  close_up: 1.4,
  extreme_close_up: 1.8,
  overhead: undefined,
  pov: undefined,
};

/** Controlled silences before a revelation (bible §13). */
export const SILENCE_KINDS = ['music_drop', 'sfx_drop', 'ambient_drop'] as const;
export type SilenceKind = (typeof SILENCE_KINDS)[number];

/** Who took a decision: the AI director, the user, the deterministic rules, or a v1 → v2 migration. */
export const DECIDED_BY = ['ai', 'user', 'rules', 'migration'] as const;
export type DecidedBy = (typeof DECIDED_BY)[number];

/**
 * Editorial heuristics are ordinal levels 1 (low) → 5 (maximal), never
 * decimals presented as measurements (bible §0).
 */
export type EditorialLevel = 1 | 2 | 3 | 4 | 5;
export const isEditorialLevel = (v: unknown): v is EditorialLevel => v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
