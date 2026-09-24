/**
 * Parser of VIDEO_EDITING_BIBLE.md. The markdown is the single source of
 * truth: `rules.generated.ts` is produced from it and a test fails when the
 * two diverge. Pure (no I/O) so it can also feed LLM prompts.
 */
import type { BibleEnforcement, BibleRule, BibleSeverity } from './types.js';

const SEVERITY: Record<string, BibleSeverity> = { bloquant: 'blocking', avertissement: 'warning', conseil: 'advice' };
const ENFORCEMENT: Record<string, BibleEnforcement> = { AUTO: 'auto', HEUR: 'heuristic', REVUE: 'review' };

const SECTION = /^## \d+\. (.+?) \(([A-Z]+)\)\s*$/;
const RULE = /^- \*\*([A-Z]+)-(\d{2})\*\* · (\S+) · (\S+) — (.+)$/;

export interface BibleParseResult {
  rules: BibleRule[];
  /** Format problems: unknown severity, prefix outside its section, numbering gaps… */
  problems: string[];
}

export function parseBible(markdown: string): BibleParseResult {
  const rules: BibleRule[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const next = new Map<string, number>();
  let section: { title: string; domain: string } | undefined;
  let fenced = false;
  markdown.split(/\r?\n/).forEach((line, i) => {
    // Examples inside code blocks are not rules.
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced) return;
    const s = SECTION.exec(line);
    if (s) {
      section = { title: s[1]!, domain: s[2]! };
      return;
    }
    if (!line.startsWith('- **')) return;
    const m = RULE.exec(line);
    if (!m) {
      if (/^- \*\*[A-Z]+-\d+\*\*/.test(line)) problems.push(`line ${i + 1}: malformed rule`);
      return;
    }
    const [, domain, num, sev, enf, text] = m as unknown as [string, string, string, string, string, string];
    const id = `${domain}-${num}`;
    const severity = SEVERITY[sev];
    const enforcement = ENFORCEMENT[enf];
    if (!severity) problems.push(`${id}: unknown severity "${sev}"`);
    if (!enforcement) problems.push(`${id}: unknown enforcement "${enf}"`);
    if (!section) problems.push(`${id}: rule outside a section`);
    else if (section.domain !== domain) problems.push(`${id}: prefix does not match section ${section.domain}`);
    if (seen.has(id)) problems.push(`${id}: duplicate id`);
    const expected = next.get(domain) ?? 1;
    if (Number(num) !== expected) problems.push(`${id}: expected ${domain}-${String(expected).padStart(2, '0')} (numbering must be sequential)`);
    if (severity === 'blocking' && enforcement === 'heuristic') problems.push(`${id}: a heuristic check can never be blocking`);
    seen.add(id);
    next.set(domain, Number(num) + 1);
    if (severity && enforcement && section) rules.push({ id, domain, section: section.title, severity, enforcement, text: text.trim() });
  });
  return { rules, problems };
}

/** Source of `rules.generated.ts`. */
export function renderRulesModule(rules: readonly BibleRule[]): string {
  const body = rules.map((r) => `  ${JSON.stringify(r)},`).join('\n');
  return (
    '// Generated from VIDEO_EDITING_BIBLE.md — do not edit.\n' +
    '// Regenerate: npm run bible -w @studio-engine/scene-engine\n' +
    "import type { BibleRule } from './types.js';\n\n" +
    `export const BIBLE_RULES: readonly BibleRule[] = [\n${body}\n];\n`
  );
}
