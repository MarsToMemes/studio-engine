import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { shotPlanDemo } from '@studio-engine/remotion';
import { toTimeline, type ShotPlan, type VideoProject } from '@studio-engine/scene-engine';
import { compilePreview, posterFrame, setSkill, shotRange, skillOptions } from './state/plan';
import { commit, createHistory, redo, seal, undo, type History } from './state/history';
import { deleteShot, duplicateShot, removeSfx, shotAtFrame } from './state/timeline';
import { PreviewPlayer } from './components/PreviewPlayer';
import { ShotList } from './components/ShotList';
import { ShotInspector } from './components/ShotInspector';
import { IssuesPanel } from './components/IssuesPanel';
import { Timeline, type EditOptions, type SfxSelection } from './components/timeline/Timeline';

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['TEXTAREA', 'SELECT'].includes(el.tagName) || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type)));

/** Seek request applied after the next render (so the Player already has the new plan and loop range). */
type PendingSeek = { frame: number } | { posterOf: string };

export function App() {
  const [history, setHistory] = useState<History<ShotPlan>>(() => createHistory(structuredClone(shotPlanDemo)));
  const plan = history.present;
  const [selectedId, setSelectedId] = useState(plan.shots[0]!.id);
  const [selectedSfx, setSelectedSfx] = useState<SfxSelection>();
  const playerRef = useRef<PlayerRef>(null);
  // Open on a meaningful frame of the first shot, not its empty entrance.
  const [pendingSeek, setPendingSeek] = useState<PendingSeek | undefined>(() => ({ posterOf: shotPlanDemo.shots[0]!.id }));
  const [frame, setFrame] = useState(0);
  const [loopShot, setLoopShot] = useState(true);
  const [toast, setToast] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const onFrame = useCallback((f: number) => setFrame(f), []);

  const compiled = useMemo(() => compilePreview(plan), [plan]);
  // Keep showing the last valid version while the plan is temporarily invalid.
  const lastGood = useRef<VideoProject | undefined>(undefined);
  if (compiled.project) lastGood.current = compiled.project;
  const project = compiled.project ?? lastGood.current;
  const timeline = useMemo(() => toTimeline(plan), [plan]);

  const selected = plan.shots.find((s) => s.id === selectedId) ?? plan.shots[0]!;
  const range = useMemo(() => (loopShot ? shotRange(plan, selected.id) : undefined), [loopShot, plan, selected.id]);

  useEffect(() => {
    if (!pendingSeek) return;
    const target = 'frame' in pendingSeek ? pendingSeek.frame : posterFrame(plan, project, pendingSeek.posterOf);
    playerRef.current?.seekTo(target);
    setFrame(target);
    setPendingSeek(undefined);
  }, [pendingSeek, plan, project, range]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  /** Every change to the plan goes through here (undoable). */
  const edit = useCallback(
    (next: ShotPlan, options: EditOptions = {}) => {
      setHistory((h) => commit(h, next, options.group));
      if (options.select) setSelectedId(options.select);
      setPendingSeek(options.seek !== undefined ? { frame: options.seek } : { posterOf: options.select ?? selectedId });
    },
    [selectedId],
  );
  const sealHistory = useCallback(() => setHistory((h) => seal(h)), []);

  const select = (id: string) => {
    setSelectedId(id);
    setSelectedSfx(undefined);
    setPendingSeek({ posterOf: id });
  };
  /** Seek to a frame; the shot under it becomes the selection (and the loop range). */
  const seek = useCallback(
    (f: number) => {
      const shot = shotAtFrame(timeline.shots, f);
      if (shot) setSelectedId(shot.id);
      setSelectedSfx(undefined);
      setPendingSeek({ frame: f });
    },
    [timeline],
  );

  // The SFX selection is positional (shot + index): drop it when the plan jumps.
  const doUndo = () => {
    setSelectedSfx(undefined);
    setHistory((h) => undo(seal(h)));
  };
  const doRedo = () => {
    setSelectedSfx(undefined);
    setHistory((h) => redo(h));
  };
  const duplicate = () => {
    const r = duplicateShot(plan, selected.id);
    edit(r.plan, { select: r.id });
  };
  const remove = () => {
    if (selectedSfx) {
      edit(removeSfx(plan, selectedSfx.shotId, selectedSfx.index), { seek: frame });
      setSelectedSfx(undefined);
      return;
    }
    const r = deleteShot(plan, selected.id);
    if (r.plan !== plan) edit(r.plan, { select: r.selectId });
  };
  const dropSkill = (shotId: string, skillId: string) => {
    const shot = plan.shots.find((s) => s.id === shotId);
    if (!shot) return;
    if (!skillOptions(shot.type).some((s) => s.id === skillId)) {
      setToast(`"${skillId}" cannot be applied to a ${shot.type} shot`);
      return;
    }
    edit(setSkill(plan, shotId, skillId), { select: shotId });
  };

  // Keyboard shortcuts (ignored while typing in a field). Handlers read the latest render's values.
  const keys = useRef({ doUndo, doRedo, duplicate, remove, select, seek, frame, plan, selected, timeline });
  keys.current = { doUndo, doRedo, duplicate, remove, select, seek, frame, plan, selected, timeline };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'z' || key === 'y')) {
        if (isTyping(e.target)) return; // native undo inside the field
        e.preventDefault();
        return key === 'y' || e.shiftKey ? k.doRedo() : k.doUndo();
      }
      if (isTyping(e.target)) return;
      const player = playerRef.current;
      if (e.key === ' ') {
        e.preventDefault();
        player?.toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        player?.pause();
        const step = e.shiftKey ? k.plan.fps : 1;
        k.seek(Math.max(0, Math.min(k.timeline.durationInFrames - 1, k.frame + (e.key === 'ArrowLeft' ? -step : step))));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const i = k.plan.shots.findIndex((s) => s.id === k.selected.id);
        const next = k.plan.shots[Math.max(0, Math.min(k.plan.shots.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)))];
        if (next) k.select(next.id);
      } else if (mod && key === 'd') {
        e.preventDefault();
        k.duplicate();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        k.remove();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = shotAtFrame(timeline.shots, frame);

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Studio Engine</strong>
        <span className="muted" data-testid="summary">{plan.shots.length} shots · {(timeline.durationInFrames / plan.fps).toFixed(1)} s · compile {compiled.compileMs.toFixed(1)} ms</span>
        <span className="muted" data-testid="current-frame" data-frame={frame} data-shot={current?.id} data-playing={playing}>
          frame {frame} · {current?.id}
        </span>
        <div className="spacer" />
        <label className="toggle">
          <input type="checkbox" data-testid="loop-shot" checked={loopShot} onChange={(e) => setLoopShot(e.target.checked)} /> Loop selected shot
        </label>
        <button onClick={() => download('shot-plan.json', plan)}>Export plan</button>
        <button onClick={() => download('timeline.json', timeline)}>Export timeline</button>
        <button onClick={() => edit(structuredClone(shotPlanDemo), { select: shotPlanDemo.shots[0]!.id })}>Reset</button>
      </header>
      <aside className="shots">
        <ShotList plan={plan} timeline={timeline} selectedId={selected.id} onSelect={select} />
      </aside>
      <main className="stage">
        {project ? <PreviewPlayer playerRef={playerRef} project={project} onFrame={onFrame} onPlayingChange={setPlaying} {...(range ? { range } : {})} /> : <div className="empty">The plan has errors and no valid preview yet.</div>}
        <IssuesPanel compiled={compiled} />
      </main>
      <aside className="inspector">
        <ShotInspector plan={plan} shot={selected} onChange={(p, group) => edit(p, group ? { group } : {})} onSeal={sealHistory} />
      </aside>
      <Timeline
        plan={plan}
        project={project}
        frame={frame}
        selectedId={selected.id}
        {...(selectedSfx ? { selectedSfx } : {})}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={doUndo}
        onRedo={doRedo}
        onSelect={select}
        onSelectSfx={setSelectedSfx}
        onSeek={seek}
        onEdit={edit}
        onGestureEnd={sealHistory}
        onDuplicate={duplicate}
        onDelete={remove}
        onSkillDrop={dropSkill}
      />
      {toast ? <div className="toast" role="status" data-testid="toast">{toast}</div> : null}
    </div>
  );
}
