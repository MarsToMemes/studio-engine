/** A rule of VIDEO_EDITING_BIBLE.md (the editorial reference of the engine). */
export type BibleSeverity = 'blocking' | 'warning' | 'advice';

/**
 * - `auto`: deterministic check in code.
 * - `heuristic`: approximate automatic check (never blocking).
 * - `review`: editorial judgement (AI critic or human).
 */
export type BibleEnforcement = 'auto' | 'heuristic' | 'review';

export interface BibleRule {
  /** Stable id, e.g. `RHY-03`. */
  id: string;
  /** Domain prefix, e.g. `RHY`. */
  domain: string;
  /** Title of the bible section, e.g. `Rythme et durée des plans`. */
  section: string;
  severity: BibleSeverity;
  enforcement: BibleEnforcement;
  text: string;
}
