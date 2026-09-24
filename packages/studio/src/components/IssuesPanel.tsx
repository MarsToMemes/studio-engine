import { getBibleRule, type ValidationIssue } from '@studio-engine/scene-engine';
import type { PreviewCompilation } from '../state/plan';

/** `[RHY-03]` badge; hovering shows the VIDEO_EDITING_BIBLE.md rule. */
function RuleBadge({ issue }: { issue: ValidationIssue }) {
  if (!issue.rule) return null;
  const rule = getBibleRule(issue.rule);
  return (
    <abbr className="rule" title={rule ? `${rule.section} — ${rule.text}` : issue.rule} data-testid="rule-badge">
      {issue.rule}
    </abbr>
  );
}

export function IssuesPanel({ compiled }: { compiled: PreviewCompilation }) {
  const { errors, warnings, notes } = compiled;
  if (!errors.length && !warnings.length && !notes.length) return <div className="issues ok" data-testid="issues">✓ No issues</div>;
  return (
    <div className="issues" data-testid="issues">
      {errors.map((e, i) => <div key={`e${i}`} className="issue error">✕ <RuleBadge issue={e} /> {e.path}: {e.message}</div>)}
      {warnings.map((w, i) => <div key={`w${i}`} className="issue warning">⚠ <RuleBadge issue={w} /> {w.path}: {w.message}</div>)}
      {notes.map((n, i) => <div key={`n${i}`} className="issue note">ℹ {n}</div>)}
    </div>
  );
}
