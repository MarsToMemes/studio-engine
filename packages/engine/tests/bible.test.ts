import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BIBLE_RULES, enforcedRuleIds, getBibleRule, ISSUE_CODE_RULES, parseBible, renderRulesModule, ruleForIssue, validateShotPlan } from '../src/index';
import { buildEpisodePlan } from './fixtures/shotplan-episode';

const bibleUrl = new URL('../../../VIDEO_EDITING_BIBLE.md', import.meta.url);
const generatedPath = fileURLToPath(new URL('../src/bible/rules.generated.ts', import.meta.url));
const markdown = readFileSync(bibleUrl, 'utf8');

describe('VIDEO_EDITING_BIBLE.md', () => {
  const parsed = parseBible(markdown);

  it('is well formed (ids, severities, sequential numbering, no blocking heuristics)', () => {
    expect(parsed.problems).toEqual([]);
    expect(parsed.rules.length).toBeGreaterThan(100);
  });

  it('the generated rule catalogue is up to date', () => {
    const fresh = renderRulesModule(parsed.rules);
    // `npm run bible` regenerates the file instead of failing.
    if (process.env.UPDATE_BIBLE) writeFileSync(generatedPath, fresh);
    expect(readFileSync(generatedPath, 'utf8')).toBe(fresh);
    // The imported module is the one before regeneration: compare it only on a normal run.
    if (!process.env.UPDATE_BIBLE) expect(BIBLE_RULES).toEqual(parsed.rules);
  });

  it('covers every domain the brief requires', () => {
    const domains = new Set(BIBLE_RULES.map((r) => r.domain));
    for (const d of ['DIR', 'STORY', 'SCENE', 'GRAM', 'RHY', 'HIER', 'CAM', 'TYPO', 'MOT', 'TRANS', 'SND', 'MUS', 'SIL', 'DOC', 'CHART', 'MAP', 'CAP', 'COL', 'REP', 'VAR', 'CALL', 'ESC', 'REV', 'CHAP', 'SRC', 'TECH']) {
      expect(domains, d).toContain(d);
    }
  });

  it('detects format problems', () => {
    const bad = parseBible('## 1. Test (AAA)\n- **AAA-01** · bloquant · HEUR — x\n- **AAA-03** · souvent · AUTO — y\n- **BBB-01** · conseil · AUTO — z\n');
    expect(bad.problems).toEqual([
      'AAA-01: a heuristic check can never be blocking',
      'AAA-03: unknown severity "souvent"',
      'AAA-03: expected AAA-02 (numbering must be sequential)',
      'BBB-01: prefix does not match section AAA',
    ]);
    expect(parseBible('## 1. T (AAA)\n```\n- **AAA-07** · conseil · AUTO — example\n```\n').rules).toEqual([]);
  });
});

describe('issues cite the rule they enforce', () => {
  it('every mapped code points to an existing automatic rule (AUTO or HEUR, never REVUE)', () => {
    for (const [code, id] of Object.entries(ISSUE_CODE_RULES)) {
      const rule = getBibleRule(id);
      expect(rule, `${code} → ${id}`).toBeDefined();
      expect(['auto', 'heuristic'], `${code} → ${id}`).toContain(rule!.enforcement);
      // A heuristic check never blocks (bible §0).
      if (rule!.enforcement === 'heuristic') expect(rule!.severity, id).not.toBe('blocking');
    }
    expect(enforcedRuleIds()).toContain('TECH-02');
  });

  it('validation issues carry the rule id', () => {
    const plan = buildEpisodePlan();
    plan.shots[0]!.durationInFrames = 150; // 5 s hook, no motion skill
    delete plan.shots[0]!.motionSkill;
    const r = validateShotPlan(plan);
    expect(r.warnings.find((w) => w.code === 'pacing.hook')!.rule).toBe('RHY-01');
    expect(r.warnings.find((w) => w.code === 'pacing.static')!.rule).toBe('RHY-03');
    const broken = validateShotPlan({ ...plan, fps: -1 });
    expect(broken.errors.every((e) => e.rule !== undefined)).toBe(true);
    expect(ruleForIssue({ code: 'something.else', severity: 'warning' })).toBeUndefined();
  });
});
