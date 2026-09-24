import type { Intensity, Shot, ShotPlan } from '@studio-engine/scene-engine';
import {
  mediaOptions,
  setHighlightedWords,
  setIntensity,
  setMapZoom,
  setShotSeconds,
  setSfx,
  setSkill,
  setTransition,
  sfxOptions,
  skillOptions,
  transitionOptions,
  updateShot,
} from '../state/plan';

/** `group` merges consecutive edits of one field (typing) into one undo step. */
type Props = { plan: ShotPlan; shot: Shot; onChange: (plan: ShotPlan, group?: string) => void; onSeal?: () => void };

export function ShotInspector({ plan, shot, onChange, onSeal }: Props) {
  const media = mediaOptions(plan, shot.type);
  const skills = skillOptions(shot.type);
  const sfx = shot.sfx ?? [];
  const sfxChoices = sfxOptions(plan);
  return (
    <form className="inspector-form" onSubmit={(e) => e.preventDefault()} onBlur={onSeal} data-testid="inspector">
      <h2>
        {shot.id} <span className="muted">{shot.type}</span>
      </h2>

      <label>
        Text
        <textarea data-testid="field-text" value={shot.text ?? ''} rows={3} onChange={(e) => onChange(updateShot(plan, shot.id, { text: e.target.value }), `text:${shot.id}`)} />
      </label>
      <label>
        Highlighted words
        <input data-testid="field-highlights" value={(shot.highlightedWords ?? []).join(', ')} onChange={(e) => onChange(setHighlightedWords(plan, shot.id, e.target.value), `highlights:${shot.id}`)} />
      </label>
      <label>
        Duration (s)
        <input data-testid="field-duration" type="number" step={0.1} min={0.5} value={(shot.durationInFrames / plan.fps).toFixed(1)} onChange={(e) => onChange(setShotSeconds(plan, shot.id, Number(e.target.value)), `duration:${shot.id}`)} />
      </label>

      {media.length > 0 ? (
        <label>
          Media
          <select data-testid="field-media" value={shot.media ?? ''} onChange={(e) => onChange(updateShot(plan, shot.id, { media: e.target.value }))}>
            {media.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
      ) : null}

      <label>
        Motion skill
        <select data-testid="field-skill" value={shot.motionSkill ?? ''} onChange={(e) => onChange(setSkill(plan, shot.id, e.target.value))}>
          <option value="">— none —</option>
          {skills.map((s) => <option key={s.id} value={s.id} title={s.description}>{s.name} ({s.id})</option>)}
        </select>
      </label>
      <label>
        Intensity
        <select data-testid="field-intensity" value={shot.intensity ?? ''} onChange={(e) => onChange(setIntensity(plan, shot.id, e.target.value as Intensity | ''))}>
          <option value="">skill default</option>
          <option value="subtle">subtle</option>
          <option value="medium">medium</option>
          <option value="strong">strong</option>
        </select>
      </label>

      {shot.map ? (
        <label>
          Map zoom
          <input data-testid="field-zoom" type="range" min={0} max={8} step={0.1} value={shot.map.zoom ?? 0} onChange={(e) => onChange(setMapZoom(plan, shot.id, Number(e.target.value)), `zoom:${shot.id}`)} />
        </label>
      ) : null}

      <label>
        Transition in
        <select data-testid="field-transition" value={shot.transition ?? 'hard_cut'} onChange={(e) => onChange(setTransition(plan, shot.id, e.target.value))}>
          {transitionOptions().map((t) => <option key={t.id} value={t.id} title={t.description}>{t.id}{t.tier === 'spectacular' ? ' ★' : ''}</option>)}
        </select>
      </label>

      <fieldset>
        <legend>Sound effects</legend>
        {sfx.map((e, i) => (
          <div className="row" key={i}>
            <select value={e.sfx} onChange={(ev) => onChange(setSfx(plan, shot.id, sfx.map((x, k) => (k === i ? { ...x, sfx: ev.target.value } : x))))}>
              {[...new Set([e.sfx, ...sfxChoices])].map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            <input type="number" min={0} step={1} value={e.at ?? 0} title="frame" onChange={(ev) => onChange(setSfx(plan, shot.id, sfx.map((x, k) => (k === i ? { ...x, at: Math.max(0, Math.round(Number(ev.target.value))) } : x))))} />
            <button type="button" onClick={() => onChange(setSfx(plan, shot.id, sfx.filter((_, k) => k !== i)))}>✕</button>
          </div>
        ))}
        {sfxChoices.length > 0 ? (
          <button type="button" data-testid="add-sfx" onClick={() => onChange(setSfx(plan, shot.id, [...sfx, { sfx: sfxChoices[0]! }]))}>+ Add SFX</button>
        ) : null}
      </fieldset>
    </form>
  );
}
