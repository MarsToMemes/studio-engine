import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { shotPlanDemo } from '@studio-engine/remotion';
import { toTimeline, type ShotPlan, type VideoProject } from '@studio-engine/scene-engine';
import { compilePreview, posterFrame, shotRange } from './state/plan';
import { PreviewPlayer } from './components/PreviewPlayer';
import { ShotList } from './components/ShotList';
import { ShotInspector } from './components/ShotInspector';
import { IssuesPanel } from './components/IssuesPanel';

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [plan, setPlan] = useState<ShotPlan>(() => structuredClone(shotPlanDemo));
  const [selectedId, setSelectedId] = useState(plan.shots[0]!.id);
  const playerRef = useRef<PlayerRef>(null);
  const pendingSeek = useRef<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [loopShot, setLoopShot] = useState(true);
  const onFrame = useCallback((f: number) => setFrame(f), []);

  const compiled = useMemo(() => compilePreview(plan), [plan]);
  // Keep showing the last valid version while the plan is temporarily invalid.
  const lastGood = useRef<VideoProject | undefined>(undefined);
  if (compiled.project) lastGood.current = compiled.project;
  const project = compiled.project ?? lastGood.current;
  const timeline = useMemo(() => toTimeline(plan), [plan]);

  // After an edit, jump to the edited shot so the result is visible immediately.
  const seekToShot = (id: string, p: ShotPlan, proj: VideoProject | undefined) => {
    const target = posterFrame(p, proj, id);
    playerRef.current?.seekTo(target);
    setFrame(target);
  };

  useEffect(() => {
    if (!pendingSeek.current) return;
    seekToShot(pendingSeek.current, plan, project);
    pendingSeek.current = null;
  }, [plan, project]);

  const edit = (next: ShotPlan) => {
    pendingSeek.current = selectedId;
    setPlan(next);
  };
  const select = (id: string) => {
    setSelectedId(id);
    seekToShot(id, plan, project);
  };
  const selected = plan.shots.find((s) => s.id === selectedId) ?? plan.shots[0]!;
  const range = useMemo(() => (loopShot ? shotRange(plan, selected.id) : undefined), [loopShot, plan, selected.id]);
  // Shot under the playhead (the incoming shot wins during a transition overlap).
  const current = [...timeline.shots].reverse().find((s) => frame >= s.startFrame);

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Studio Engine</strong>
        <span className="muted" data-testid="summary">{plan.shots.length} shots · {(timeline.durationInFrames / plan.fps).toFixed(1)} s · compile {compiled.compileMs.toFixed(1)} ms</span>
        <span className="muted" data-testid="current-frame" data-frame={frame} data-shot={current?.id}>
          frame {frame} · {current?.id}
        </span>
        <div className="spacer" />
        <label className="toggle">
          <input type="checkbox" data-testid="loop-shot" checked={loopShot} onChange={(e) => setLoopShot(e.target.checked)} /> Loop selected shot
        </label>
        <button onClick={() => download('shot-plan.json', plan)}>Export plan</button>
        <button onClick={() => download('timeline.json', timeline)}>Export timeline</button>
        <button onClick={() => edit(structuredClone(shotPlanDemo))}>Reset</button>
      </header>
      <aside className="shots">
        <ShotList plan={plan} timeline={timeline} selectedId={selected.id} onSelect={select} />
      </aside>
      <main className="stage">
        {project ? <PreviewPlayer playerRef={playerRef} project={project} onFrame={onFrame} {...(range ? { range } : {})} /> : <div className="empty">The plan has errors and no valid preview yet.</div>}
        <IssuesPanel compiled={compiled} />
      </main>
      <aside className="inspector">
        <ShotInspector plan={plan} shot={selected} onChange={edit} />
      </aside>
    </div>
  );
}
