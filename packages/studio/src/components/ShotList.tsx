import type { ShotPlan, Timeline } from '@studio-engine/scene-engine';

export function ShotList({ plan, timeline, selectedId, onSelect }: { plan: ShotPlan; timeline: Timeline; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <ol className="shot-list">
      {timeline.shots.map((t, i) => (
        <li key={t.id}>
          <button className={t.id === selectedId ? 'shot selected' : 'shot'} onClick={() => onSelect(t.id)} data-testid={`shot-${t.id}`}>
            <span className="index">{i + 1}</span>
            <span className="body">
              <span className="title">{t.text ?? t.id}</span>
              <span className="meta">
                {t.type} · {(t.startFrame / plan.fps).toFixed(1)}s · {(t.durationInFrames / plan.fps).toFixed(1)}s
              </span>
              <span className="tags">
                {t.motionSkill ? <span className="tag">{t.motionSkill}</span> : null}
                {t.transition && t.transition !== 'hard_cut' ? <span className="tag alt">{t.transition}</span> : null}
                {t.intensity ? <span className="tag dim">{t.intensity}</span> : null}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
