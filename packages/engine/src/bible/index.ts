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
  'transition.glitch.max': 'TRANS-03',
  // Editorial layer (plan version 2 and every plan with the data).
  'editorial.intent.missing': 'DIR-01',
  'editorial.reason.missing': 'DIR-01',
  'camera.unknown': 'DIR-03',
  'scene.missing': 'SCENE-01',
  'scene.purpose.missing': 'SCENE-01',
  'scene.beats': 'SCENE-02',
  'hierarchy.primary.missing': 'HIER-01',
  'pacing.hold.max': 'RHY-04',
  'pacing.cut.word': 'RHY-08',
  'variety.consecutive': 'VAR-01',
  'chapter.duration': 'CHAP-01',
  'chapter.title.long': 'CHAP-02',
  'reveal.setup': 'REV-02',
  'music.state.missing': 'MUS-03',
  'music.state.change': 'MUS-03',
  'silence.duration': 'SIL-02',
  'silence.frequency': 'SIL-03',
  'silence.payoff': 'SIL-04',
  'asset.license.missing': 'SRC-01',
  'asset.license.noncommercial': 'SRC-02',
  // Craft: repetition, contrast, restraint, typography, documents, data, sound.
  'grammar.skill': 'GRAM-01',
  'grammar.camera': 'GRAM-01',
  'typography.words': 'TYPO-02',
  'typography.emphasis': 'TYPO-03',
  'document.static': 'DOC-01',
  'document.source': 'DOC-05',
  'chart.categories': 'CHART-04',
  'map.labels': 'MAP-03',
  'intensity.strong.ratio': 'MOT-02',
  'intensity.strong.intent': 'MOT-02',
  'motion.restraint': 'MOT-03',
  'camera.shake.max': 'CAM-07',
  'repetition.skill': 'REP-01',
  'repetition.transition': 'REP-02',
  'repetition.sfx': 'REP-03',
  'repetition.camera': 'REP-04',
  'repetition.typography': 'REP-05',
  'variety.window': 'VAR-02',
  'sound.density': 'SND-03',
};

/**
 * Rule enforced by an issue. Structural errors without a specific rule fall
 * under TECH-02 (the plan must be structurally valid).
 */
export function ruleForIssue(issue: { code: string; severity: 'error' | 'warning' }): string | undefined {
  return ISSUE_CODE_RULES[issue.code] ?? (issue.severity === 'error' ? 'TECH-02' : undefined);
}

/** Rules with at least one automatic (AUTO or HEUR) check in the code today. */
export function enforcedRuleIds(): string[] {
  return [...new Set(Object.values(ISSUE_CODE_RULES)).add('TECH-02')].sort();
}
