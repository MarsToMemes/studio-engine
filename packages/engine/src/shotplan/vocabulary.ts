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

/**
 * Kinds of media, from the most authentic to pure motion design (bible §27,
 * MED-01). A shot records the level it uses in `mediaTier`.
 */
export const MEDIA_TIERS = ['real_video', 'real_photo', 'document', 'data_viz', 'generated', 'motion'] as const;
export type MediaTier = (typeof MEDIA_TIERS)[number];

/** What a media file is. Set by the author or the pipeline; otherwise derived from its kind, rights and tags. */
export const MEDIA_NATURES = ['real_video', 'real_photo', 'archive', 'screenshot', 'document', 'generated'] as const;
export type MediaNature = (typeof MEDIA_NATURES)[number];

/** Level of the authenticity scale a media file belongs to. */
export const NATURE_TIER: Record<MediaNature, MediaTier> = {
  real_video: 'real_video',
  real_photo: 'real_photo',
  archive: 'real_photo',
  screenshot: 'document',
  document: 'document',
  generated: 'generated',
};

/**
 * What the sentence needs the picture to do (bible §27, MED-02..06): the
 * need is decided before the authenticity scale.
 */
export const MEDIA_NEEDS = [
  'explain_number',
  'show_relation',
  'connect_concepts',
  'abstract_mechanism',
  'historical_context',
  'introduce_entity',
  'archival_evidence',
  'human_behavior',
  'product_in_use',
  'atmosphere',
  'platform_reference',
  'financial_document',
  'source_interface',
  'none',
] as const;
export type MediaNeed = (typeof MEDIA_NEEDS)[number];

/** Preferred media of each need, best first (bible §27 table). `none`: the scale in order. */
export const MEDIA_NEED_TIERS: Record<MediaNeed, readonly MediaTier[]> = {
  explain_number: ['data_viz', 'motion'],
  show_relation: ['data_viz', 'motion'],
  connect_concepts: ['motion', 'data_viz'],
  abstract_mechanism: ['motion', 'data_viz'],
  historical_context: ['real_photo', 'real_video', 'document'],
  introduce_entity: ['real_photo', 'real_video'],
  archival_evidence: ['real_photo', 'document'],
  human_behavior: ['real_video', 'real_photo'],
  product_in_use: ['real_video', 'real_photo'],
  atmosphere: ['real_video', 'real_photo'],
  platform_reference: ['document', 'real_photo'],
  financial_document: ['document', 'data_viz'],
  source_interface: ['document'],
  none: MEDIA_TIERS,
};

/** Needs that explain rather than show: motion design or data first, an authentic media as support (MED-03). */
export const EXPLAINING_NEEDS: readonly MediaNeed[] = ['explain_number', 'show_relation', 'connect_concepts', 'abstract_mechanism'];

/** Needs about reality: a generated visual must never stand for them (MED-07). */
export const REAL_SUBJECT_NEEDS: readonly MediaNeed[] = ['historical_context', 'introduce_entity', 'archival_evidence', 'platform_reference', 'financial_document', 'source_interface'];
