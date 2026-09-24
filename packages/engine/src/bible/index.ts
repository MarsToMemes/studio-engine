/**
 * VIDEO_EDITING_BIBLE.md as data: the rule catalogue and the link between
 * validation / QC issue codes and the rule they enforce.
 */
import { BIBLE_RULES } from './rules.generated.js';
import type { BibleRule } from './types.js';

export * from './types.js';
export { parseBible, renderRulesModule, type BibleParseResult } from './parse.js';
export { BIBLE_RULES };

const byId = new Map(BIBLE_RULES.map((r) => [r.id, r]));

export function getBibleRule(id: string): BibleRule | undefined {
  return byId.get(id);
}

/** Editorial checks already implemented, by issue code. */
export const ISSUE_CODE_RULES: Readonly<Record<string, string>> = {
  'pacing.hook': 'RHY-01',
  'pacing.static': 'RHY-03',
  'skill.unknown': 'DIR-03',
  'transition.unknown': 'TRANS-02',
  'transition.shortened': 'TRANS-07',
  'transition.spectacular.ratio': 'TRANS-04',
  'transition.spectacular.adjacent': 'TRANS-05',
  'transition.spectacular.subtle': 'TRANS-06',
  'shot.highlight.notFound': 'TYPO-04',
  'asset.missing': 'TECH-01',
  'asset.kind.mismatch': 'TECH-01',
};

/**
 * Rule enforced by an issue. Structural errors without a specific rule fall
 * under TECH-02 (the plan must be structurally valid).
 */
export function ruleForIssue(issue: { code: string; severity: 'error' | 'warning' }): string | undefined {
  return ISSUE_CODE_RULES[issue.code] ?? (issue.severity === 'error' ? 'TECH-02' : undefined);
}

/** Rules with at least one automatic check in the code today. */
export function enforcedRuleIds(): string[] {
  return [...new Set(Object.values(ISSUE_CODE_RULES)).add('TECH-02')].sort();
}
