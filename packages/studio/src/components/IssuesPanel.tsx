import type { PreviewCompilation } from '../state/plan';

export function IssuesPanel({ compiled }: { compiled: PreviewCompilation }) {
  const { errors, warnings, notes } = compiled;
  if (!errors.length && !warnings.length && !notes.length) return <div className="issues ok" data-testid="issues">✓ No issues</div>;
  return (
    <div className="issues" data-testid="issues">
      {errors.map((e, i) => <div key={`e${i}`} className="issue error">✕ {e.path}: {e.message}</div>)}
      {warnings.map((w, i) => <div key={`w${i}`} className="issue warning">⚠ {w.path}: {w.message}</div>)}
      {notes.map((n, i) => <div key={`n${i}`} className="issue note">ℹ {n}</div>)}
    </div>
  );
}
