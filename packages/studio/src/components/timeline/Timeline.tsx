import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Thumbnail } from '@remotion/player';
import { EngineComposition, resolveSrc } from '@studio-engine/remotion';
import { audioVolumeAt, buildRemotionPlan, type ShotPlan, type VideoProject } from '@studio-engine/scene-engine';
import { posterFrame, sfxOptions } from '../../state/plan';
import {
  addSfxAt,
  dropIndex,
  fitZoom,
  formatTime,
  layoutTimeline,
  moveShot,
  moveSfx,
  snapFrame,
  snapTargets,
  trimShotEnd,
  ZOOM,
  type ShotBlock,
  type TimelineLayout,
} from '../../state/timeline';
import { WaveTrack } from './WaveTrack';

/** MIME type used to drag a motion skill (from the Motion Library) onto a shot. */
export const SKILL_MIME = 'application/x-motion-skill';

export type EditOptions = { group?: string; seek?: number; select?: string };

export type SfxSelection = { shotId: string; index: number };

type Props = {
  plan: ShotPlan;
  project?: VideoProject;
  frame: number;
  selectedId: string;
  selectedSfx?: SfxSelection;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSelect: (id: string) => void;
  onSelectSfx: (sfx: SfxSelection | undefined) => void;
  onSeek: (frame: number) => void;
  onEdit: (next: ShotPlan, options?: EditOptions) => void;
  onGestureEnd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSkillDrop: (shotId: string, skillId: string) => void;
};

const TRACK = { ruler: 24, video: 64, voice: 44, music: 36, sfx: 30 } as const;
const HEAD_WIDTH = 72;
const DRAG_THRESHOLD = 4;
const SNAP_PX = 8;

type Gesture =
  | { kind: 'scrub' }
  | { kind: 'trim'; id: string; x0: number; cut0: number; start: ShotPlan; targets: number[]; key: string; last: boolean }
  | { kind: 'move'; id: string; x0: number; dragging: boolean }
  | { kind: 'sfx'; shotId: string; index: number; x0: number; frame0: number; start: ShotPlan; dragging: boolean; targets: number[] };

let gestureSeq = 0;

export function Timeline(props: Props) {
  const { plan, project, frame, selectedId, selectedSfx, onEdit, onSeek } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 0 });
  const [ppf, setPpf] = useState<number>(ZOOM.default);
  const [snap, setSnap] = useState(true);
  const [hint, setHint] = useState<{ frame: number; text: string }>();
  const [moveDrag, setMoveDrag] = useState<{ id: string; dx: number }>();
  const [dropTarget, setDropTarget] = useState<string>();
  const gesture = useRef<Gesture | null>(null);

  const layout = useMemo(() => layoutTimeline(plan, project), [plan, project]);
  const thumbs = useThumbProjects(plan, project);
  const contentWidth = Math.ceil(layout.durationInFrames * ppf) + 120;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport({ left: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the whole episode on first display.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || viewport.width < 100) return;
    fitted.current = true;
    setPpf(fitZoom(layout.durationInFrames, viewport.width - 40));
  }, [viewport.width, layout.durationInFrames]);

  // Keep the playhead visible during playback (not while the user drags).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || gesture.current) return;
    const x = frame * ppf;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1);
  }, [frame, ppf]);

  /** Zooms keeping `anchorFrame` (default: the view centre) under the same pixel. */
  const ppfRef = useRef(ppf);
  ppfRef.current = ppf;
  const pendingScroll = useRef<number | undefined>(undefined);
  const setZoom = useCallback((next: number, anchorFrame?: number) => {
    const el = scrollRef.current;
    const old = ppfRef.current;
    const z = Math.max(0.2, Math.min(ZOOM.max, next));
    if (el) {
      const anchor = anchorFrame ?? (el.scrollLeft + el.clientWidth / 2) / old;
      pendingScroll.current = Math.max(0, anchor * z - (anchor * old - el.scrollLeft));
    }
    setPpf(z);
  }, []);
  // Apply the scroll once the content has its new width.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pendingScroll.current !== undefined) el.scrollLeft = pendingScroll.current;
    pendingScroll.current = undefined;
  }, [ppf]);
  const fit = () => {
    setZoom(fitZoom(layout.durationInFrames, viewport.width - 40));
    pendingScroll.current = 0;
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };

  const frameAt = (clientX: number) => {
    const el = scrollRef.current!;
    return Math.max(0, Math.min(layout.durationInFrames - 1, Math.round((clientX - el.getBoundingClientRect().left + el.scrollLeft) / ppf)));
  };
  const snapIn = (f: number, targets: number[], exclude?: number) => (snap ? snapFrame(f, targets, SNAP_PX / ppf, exclude) : f);

  // --- gestures -------------------------------------------------------------
  const capture = (e: ReactPointerEvent) => (e.currentTarget as Element).setPointerCapture(e.pointerId);

  const startScrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    capture(e);
    gesture.current = { kind: 'scrub' };
    onSeek(frameAt(e.clientX));
  };

  const startTrim = (e: ReactPointerEvent, block: ShotBlock) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    capture(e);
    const cut0 = block.startFrame + block.durationInFrames;
    gesture.current = { kind: 'trim', id: block.id, x0: e.clientX, cut0, start: plan, targets: snapTargets(layout), key: `trim:${block.id}:${++gestureSeq}`, last: block.index === layout.shots.length - 1 };
  };

  const startMove = (e: ReactPointerEvent, block: ShotBlock) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    capture(e);
    gesture.current = { kind: 'move', id: block.id, x0: e.clientX, dragging: false };
  };

  const startSfx = (e: ReactPointerEvent, shotId: string, index: number, markerFrame: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    capture(e);
    props.onSelectSfx({ shotId, index });
    gesture.current = { kind: 'sfx', shotId, index, x0: e.clientX, frame0: markerFrame, start: plan, dragging: false, targets: snapTargets(layout) };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'scrub') onSeek(frameAt(e.clientX));
    else if (g.kind === 'trim') {
      const raw = g.cut0 + (e.clientX - g.x0) / ppf;
      const cut = snapIn(raw, g.targets, g.cut0);
      const mode = e.altKey || g.last ? 'ripple' : 'roll';
      const delta = Math.round(cut - g.cut0);
      const next = trimShotEnd(g.start, g.id, delta, mode);
      const block = layoutTimeline(next).shots.find((s) => s.id === g.id)!;
      const newCut = block.startFrame + block.durationInFrames;
      const applied = newCut - g.cut0;
      setHint({ frame: newCut, text: `${applied >= 0 ? '+' : ''}${(applied / plan.fps).toFixed(2)} s · ${mode}` });
      onEdit(next, { group: g.key, seek: newCut - 1 });
    } else if (g.kind === 'move') {
      const dx = e.clientX - g.x0;
      if (!g.dragging && Math.abs(dx) < DRAG_THRESHOLD) return;
      g.dragging = true;
      setMoveDrag({ id: g.id, dx });
    } else if (g.kind === 'sfx') {
      const dx = e.clientX - g.x0;
      if (!g.dragging && Math.abs(dx) < DRAG_THRESHOLD) return;
      g.dragging = true;
      const f = Math.max(0, Math.min(layout.durationInFrames - 1, Math.round(snapIn(g.frame0 + dx / ppf, g.targets))));
      setHint({ frame: f, text: formatTime(f, plan.fps) });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setHint(undefined);
    if (!g) return;
    if (g.kind === 'trim') props.onGestureEnd();
    else if (g.kind === 'move') {
      setMoveDrag(undefined);
      if (!g.dragging) return props.onSelect(g.id);
      const block = layout.shots.find((s) => s.id === g.id)!;
      const center = block.startFrame + block.durationInFrames / 2 + (e.clientX - g.x0) / ppf;
      const next = moveShot(plan, g.id, dropIndex(layout, g.id, center));
      if (next !== plan) onEdit(next, { select: g.id, seek: posterFrame(next, undefined, g.id) });
      props.onGestureEnd();
    } else if (g.kind === 'sfx' && g.dragging) {
      const f = Math.max(0, Math.min(layout.durationInFrames - 1, Math.round(snapIn(g.frame0 + (e.clientX - g.x0) / ppf, g.targets))));
      const next = moveSfx(g.start, g.shotId, g.index, f);
      // Follow the moved event (it may now belong to another shot).
      const moved = layoutTimeline(next).sfx.find((m) => m.frame === f);
      onEdit(next, { seek: f });
      props.onSelectSfx(moved ? { shotId: moved.shotId, index: moved.index } : undefined);
      props.onGestureEnd();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(ppf * (e.deltaY < 0 ? 1.15 : 1 / 1.15), frameAt(e.clientX));
  };

  const addSfxAtPlayhead = () => {
    const first = sfxOptions(plan)[0];
    if (first) onEdit(addSfxAt(plan, first, frame), { seek: frame });
  };

  // --- audio ------------------------------------------------------------------
  const audioItems = useMemo(() => (project ? buildRemotionPlan(project, { validate: false }).audio : []), [project]);
  const voice = audioItems.find((a) => a.role === 'voiceover');
  const music = audioItems.find((a) => a.role === 'music');
  const musicGain = useCallback((f: number) => (music && f >= music.from && f < music.from + music.durationInFrames ? audioVolumeAt(music, f - music.from) : undefined), [music]);
  const srcOf = (assetId: string | undefined) => {
    const a = assetId ? plan.assets[assetId] : undefined;
    return a ? resolveSrc(a.src) : undefined;
  };
  const voiceUrl = srcOf(plan.narration?.assetId);
  const musicUrl = srcOf(plan.music?.assetId);

  const visible = { from: viewport.left / ppf - 30, to: (viewport.left + viewport.width) / ppf + 30 };
  const insertAt = moveDrag ? insertionFrame(layout, moveDrag.id, moveDrag.dx / ppf) : undefined;

  return (
    <section className="timeline" data-testid="timeline" data-ppf={ppf.toFixed(3)}>
      <div className="tl-toolbar">
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo} data-testid="undo" title="Undo (Ctrl+Z)">↶ Undo</button>
        <button type="button" onClick={props.onRedo} disabled={!props.canRedo} data-testid="redo" title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
        <span className="sep" />
        <button type="button" onClick={props.onDuplicate} data-testid="tl-duplicate" title="Duplicate shot (Ctrl+D)">Duplicate</button>
        <button type="button" onClick={props.onDelete} data-testid="tl-delete" title="Delete selection (Del)" disabled={plan.shots.length <= 1 && !selectedSfx}>Delete</button>
        <button type="button" onClick={addSfxAtPlayhead} data-testid="tl-add-sfx" disabled={!sfxOptions(plan).length}>+ SFX at playhead</button>
        <span className="sep" />
        <label className="toggle">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} data-testid="tl-snap" /> Snap
        </label>
        <span className="muted hint-text">Drag a cut: roll (voice stays in sync) · Alt+drag: ripple</span>
        <div className="spacer" />
        <button type="button" onClick={() => setZoom(ppf / 1.5)} title="Zoom out">−</button>
        <input type="range" min={Math.log(0.2)} max={Math.log(ZOOM.max)} step={0.01} value={Math.log(ppf)} onChange={(e) => setZoom(Math.exp(Number(e.target.value)))} data-testid="tl-zoom" aria-label="Zoom" />
        <button type="button" onClick={() => setZoom(ppf * 1.5)} title="Zoom in">+</button>
        <button type="button" onClick={fit} data-testid="tl-fit">Fit</button>
        <span className="timecode" data-testid="tl-time">{formatTime(frame, plan.fps)} / {formatTime(layout.durationInFrames, plan.fps)}</span>
      </div>

      <div className="tl-body">
        <div className="tl-heads" style={{ width: HEAD_WIDTH }}>
          <div style={{ height: TRACK.ruler }} />
          <div style={{ height: TRACK.video }}>Video</div>
          <div style={{ height: TRACK.voice }}>Voice</div>
          <div style={{ height: TRACK.music }}>Music</div>
          <div style={{ height: TRACK.sfx }}>SFX</div>
        </div>
        <div
          className="tl-scroll"
          ref={scrollRef}
          onScroll={(e) => setViewport({ left: e.currentTarget.scrollLeft, width: e.currentTarget.clientWidth })}
          onWheel={onWheel}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="tl-content" style={{ width: contentWidth }}>
            <Ruler fps={plan.fps} ppf={ppf} from={visible.from} to={visible.to} duration={layout.durationInFrames} onPointerDown={startScrub} />

            <div className="tl-track" style={{ height: TRACK.video }} onPointerDown={startScrub} data-testid="tl-video">
              {layout.shots.map((b) =>
                b.startFrame + b.durationInFrames < visible.from || b.startFrame > visible.to ? null : (
                  <ShotBlockView
                    key={b.id}
                    block={b}
                    ppf={ppf}
                    selected={b.id === selectedId}
                    dragDx={moveDrag?.id === b.id ? moveDrag.dx : 0}
                    dropHover={dropTarget === b.id}
                    thumb={thumbs.get(b.id)}
                    plan={plan}
                    onBodyDown={startMove}
                    onTrimDown={startTrim}
                    onDragState={setDropTarget}
                    onSkillDrop={props.onSkillDrop}
                  />
                ),
              )}
              {insertAt !== undefined ? <div className="tl-insert" style={{ left: insertAt * ppf }} data-testid="tl-insert" /> : null}
            </div>

            <div className="tl-track voice" style={{ height: TRACK.voice }} onPointerDown={startScrub} data-testid="tl-voice">
              {voiceUrl ? <WaveTrack url={voiceUrl} fps={plan.fps} pxPerFrame={ppf} scrollLeft={viewport.left} width={viewport.width} height={TRACK.voice} fromFrame={voice?.from ?? 0} toFrame={voice ? voice.from + voice.durationInFrames : 0} color="#5b8def" testId="wave-voice" /> : null}
              {ppf >= 2.5
                ? layout.words
                    .filter((w) => w.startFrame >= visible.from && w.startFrame <= visible.to)
                    .map((w, i) => (
                      <span key={`${w.startFrame}-${i}`} className="tl-word" style={{ left: w.startFrame * ppf, maxWidth: Math.max(8, (w.endFrame - w.startFrame) * ppf + 6) }}>
                        {w.text}
                      </span>
                    ))
                : null}
            </div>

            <div className="tl-track music" style={{ height: TRACK.music }} onPointerDown={startScrub} data-testid="tl-music">
              {musicUrl ? <WaveTrack url={musicUrl} fps={plan.fps} pxPerFrame={ppf} scrollLeft={viewport.left} width={viewport.width} height={TRACK.music} fromFrame={music?.from ?? 0} toFrame={music ? music.from + music.durationInFrames : 0} loop={music?.loop ?? false} color="#2b4a3b" gainAt={musicGain} testId="wave-music" label={`level ${plan.music?.gainDb ?? -18} dB · duck ${plan.music?.duckDb ?? -6} dB (yellow line)`} /> : null}
            </div>

            <div
              className="tl-track sfx"
              style={{ height: TRACK.sfx }}
              onPointerDown={startScrub}
              onDoubleClick={(e) => {
                const first = sfxOptions(plan)[0];
                if (first) onEdit(addSfxAt(plan, first, frameAt(e.clientX)));
              }}
              data-testid="tl-sfx"
            >
              {layout.sfx.map((m) => (
                <button
                  type="button"
                  key={`${m.shotId}-${m.index}`}
                  className={selectedSfx?.shotId === m.shotId && selectedSfx.index === m.index ? 'tl-sfx selected' : 'tl-sfx'}
                  style={{ left: m.frame * ppf }}
                  title={`${m.sfx} · ${formatTime(m.frame, plan.fps)} · ${m.gainDb} dB (in ${m.shotId})`}
                  onPointerDown={(e) => startSfx(e, m.shotId, m.index, m.frame)}
                  data-testid={`tl-sfx-${m.shotId}-${m.index}`}
                  data-frame={m.frame}
                >
                  <i />
                  {m.sfx.replace(/^sfx-/, '')}
                </button>
              ))}
            </div>

            <div className="tl-playhead" style={{ left: frame * ppf }} data-testid="tl-playhead" />
            {hint ? (
              <div className="tl-hint" style={{ left: hint.frame * ppf }} data-testid="tl-hint">
                {hint.text}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Where a dragged shot would land, as the frame of the insertion line. */
function insertionFrame(layout: TimelineLayout, id: string, dxFrames: number): number {
  const block = layout.shots.find((s) => s.id === id)!;
  const index = dropIndex(layout, id, block.startFrame + block.durationInFrames / 2 + dxFrames);
  const others = layout.shots.filter((s) => s.id !== id);
  if (index >= others.length) {
    const last = others[others.length - 1];
    return last ? last.startFrame + last.durationInFrames : 0;
  }
  return others[index]!.startFrame;
}

function Ruler({ fps, ppf, from, to, duration, onPointerDown }: { fps: number; ppf: number; from: number; to: number; duration: number; onPointerDown: (e: ReactPointerEvent) => void }) {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  const step = steps.find((s) => s * fps * ppf >= 64) ?? 300;
  const ticks: number[] = [];
  const first = Math.max(0, Math.floor(from / (step * fps)));
  for (let k = first; k * step * fps <= Math.min(to, duration); k++) ticks.push(k * step);
  return (
    <div className="tl-ruler" style={{ height: TRACK.ruler }} onPointerDown={onPointerDown} data-testid="tl-ruler">
      {ticks.map((t) => (
        <span key={t} className="tick" style={{ left: t * fps * ppf }}>
          {formatTime(t * fps, fps).replace(/\.0$/, '')}
        </span>
      ))}
    </div>
  );
}

type BlockProps = {
  block: ShotBlock;
  ppf: number;
  selected: boolean;
  dragDx: number;
  dropHover: boolean;
  thumb: ThumbProject | undefined;
  plan: ShotPlan;
  onBodyDown: (e: ReactPointerEvent, b: ShotBlock) => void;
  onTrimDown: (e: ReactPointerEvent, b: ShotBlock) => void;
  onDragState: (id: string | undefined) => void;
  onSkillDrop: (shotId: string, skillId: string) => void;
};

function ShotBlockView({ block: b, ppf, selected, dragDx, dropHover, thumb, plan, onBodyDown, onTrimDown, onDragState, onSkillDrop }: BlockProps) {
  const width = b.durationInFrames * ppf;
  const cls = ['tl-shot', `type-${b.type}`, selected ? 'selected' : '', dragDx ? 'dragging' : '', dropHover ? 'drop' : ''].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      style={{ left: b.startFrame * ppf, width, transform: dragDx ? `translateX(${dragDx}px)` : undefined, zIndex: dragDx ? 5 : selected ? 3 : 1 + (b.index % 2) }}
      onPointerDown={(e) => onBodyDown(e, b)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SKILL_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        onDragState(b.id);
      }}
      onDragLeave={() => onDragState(undefined)}
      onDrop={(e) => {
        const skill = e.dataTransfer.getData(SKILL_MIME);
        onDragState(undefined);
        if (skill) {
          e.preventDefault();
          onSkillDrop(b.id, skill);
        }
      }}
      data-testid={`tl-shot-${b.id}`}
      data-start={b.startFrame}
      data-duration={b.durationInFrames}
      title={`${b.id} · ${b.type} · ${(b.durationInFrames / plan.fps).toFixed(2)} s${b.motionSkill ? ` · ${b.motionSkill}` : ''}${b.transition !== 'hard_cut' ? ` · in: ${b.transition}` : ''}`}
    >
      {b.transitionInFrames > 0 ? <div className="tl-transition" style={{ width: b.transitionInFrames * ppf }} title={`${b.transition} (${b.transitionInFrames} frames)`} /> : null}
      {width >= 120 && thumb ? <ShotThumb thumb={thumb} /> : null}
      <div className="tl-shot-text">
        <span className="tl-shot-label">{b.label}</span>
        {width >= 60 ? (
          <span className="tl-shot-meta">
            {b.appliedSkill ? <s title={`fallback → ${b.appliedSkill}`}>{b.motionSkill}</s> : b.motionSkill ?? b.type}
            {b.offSyncWords.length ? (
              <em className="tl-offsync" title={`Not spoken during this shot: ${b.offSyncWords.join(', ')}`} data-testid={`tl-offsync-${b.id}`}>
                ⚠ sync
              </em>
            ) : null}
          </span>
        ) : null}
      </div>
      {b.events.map((ev, i) => (
        <span key={i} className={`tl-event ev-${ev.kind}`} style={{ left: (ev.frame - b.startFrame) * ppf }} title={`${ev.kind} @ ${formatTime(ev.frame, plan.fps)}`} />
      ))}
      <div className="tl-trim" onPointerDown={(e) => onTrimDown(e, b)} data-testid={`tl-trim-${b.id}`} title="Drag: roll edit · Alt+drag: ripple" />
    </div>
  );
}

/**
 * Real frame of the shot, rendered by the same composition as the final video.
 * `project` here is a one-scene project that only changes when THIS shot's
 * compiled scene changes (see `useThumbProjects`), so editing one shot never
 * re-renders the other thumbnails.
 */
const ShotThumb = memo(function ShotThumb({ thumb }: { thumb: ThumbProject }) {
  const { composition } = useMemo(() => buildRemotionPlan(thumb.project, { validate: false }), [thumb.project]);
  const inputProps = useMemo(() => ({ project: thumb.project }), [thumb.project]);
  return (
    <div className="tl-thumb">
      <Thumbnail
        component={EngineComposition}
        inputProps={inputProps}
        compositionWidth={composition.width}
        compositionHeight={composition.height}
        durationInFrames={composition.durationInFrames}
        fps={composition.fps}
        frameToDisplay={Math.min(composition.durationInFrames - 1, thumb.frame)}
        style={{ width: 96, height: 54 }}
      />
    </div>
  );
});

type ThumbProject = { project: VideoProject; frame: number };

const THUMB_DEBOUNCE_MS = 350;

/**
 * One-scene projects for thumbnails, debounced (typing never waits on them)
 * and memoised per shot by the scene's content.
 */
function useThumbProjects(plan: ShotPlan, project: VideoProject | undefined): Map<string, ThumbProject> {
  const [source, setSource] = useState({ plan, project });
  useEffect(() => {
    const t = setTimeout(() => setSource({ plan, project }), THUMB_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [plan, project]);
  const cache = useRef(new Map<string, { key: string; value: ThumbProject }>());
  return useMemo(() => {
    const out = new Map<string, ThumbProject>();
    const { plan: p, project: proj } = source;
    if (!proj) return out;
    const starts = new Map(layoutTimeline(p).shots.map((s) => [s.id, s.startFrame]));
    for (const scene of proj.scenes) {
      const { transitionIn: _in, transitionOut: _out, ...rest } = scene;
      const frame = posterFrame(p, proj, scene.id) - (starts.get(scene.id) ?? 0);
      const key = `${frame}|${JSON.stringify(rest)}`;
      const hit = cache.current.get(scene.id);
      if (hit && hit.key === key) {
        out.set(scene.id, hit.value);
        continue;
      }
      const value: ThumbProject = { project: { ...proj, scenes: [rest], audio: [] }, frame };
      cache.current.set(scene.id, { key, value });
      out.set(scene.id, value);
    }
    return out;
  }, [source]);
}
