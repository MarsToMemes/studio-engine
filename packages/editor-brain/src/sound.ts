/**
 * SOUND DESIGNER. Music states follow the scenes and the revelations
 * (MUS-03/04), a controlled silence prepares the major revelation of a
 * chapter (SIL), and sound effects are placed on the editorial events the
 * compiled skills really emit (SND-02), with restraint: priorities, a density
 * budget (SND-03) and asset rotation (REP-03).
 */
import type { MusicState, SfxCategory, SfxEvent, ShotEvent } from '@studio-engine/scene-engine';

/** Controlled silence before a major revelation (bible SIL-02: 0.3–0.6 s). */
export const SILENCE_SECONDS = 0.4;
const SILENCE_GAP_SECONDS = 60;

interface SfxRule {
  categories: SfxCategory[];
  priority: number;
  gainDb: number;
  why: string;
}

/** What an editorial event sounds like, and how much it matters. */
const EVENT_SFX: Partial<Record<ShotEvent['kind'], SfxRule>> = {
  reveal: { categories: ['impact', 'reveal', 'hit'], priority: 5, gainDb: -8, why: 'Impact right after the silence: the revelation lands.' },
  impact: { categories: ['impact', 'hit'], priority: 4, gainDb: -9, why: 'Impact on the punch.' },
  number: { categories: ['impact', 'hit', 'pop'], priority: 4, gainDb: -10, why: 'The figure lands with a hit as it is spoken.' },
  glitch: { categories: ['glitch', 'digital'], priority: 4, gainDb: -10, why: 'The glitch is heard as well as seen.' },
  highlight: { categories: ['document', 'click'], priority: 3, gainDb: -14, why: 'A discreet paper / marker sound as the line is highlighted.' },
  keyword: { categories: ['pop', 'click'], priority: 2, gainDb: -14, why: 'A discreet pop on the key word.' },
  chapter: { categories: ['transition', 'whoosh'], priority: 1, gainDb: -14, why: 'A soft transition sound opens the chapter.' },
  whoosh: { categories: ['whoosh'], priority: 1, gainDb: -16, why: 'A soft movement sound follows the map.' },
};

export interface ShotSound {
  shotId: string;
  startFrame: number;
  durationInFrames: number;
  events: Array<{ kind: string; at: number }>;
  importance: number;
}

export interface SoundPlan {
  sfx: Map<string, SfxEvent[]>;
  why: Map<string, string>;
  missing: SfxCategory[];
}

/**
 * Chooses sound effects. `library`: asset ids by category. Budget: at most
 * 3 effects in 2 s, about one for two shots over 30 s, the same file at most
 * 3 times a minute; lower-priority events are dropped first.
 */
export function designSfx(shots: ShotSound[], library: Partial<Record<SfxCategory, string[]>>, fps: number): SoundPlan {
  type Candidate = { shot: ShotSound; at: number; frame: number; rule: SfxRule };
  const candidates: Candidate[] = [];
  for (const shot of shots) {
    const seen = new Set<string>();
    for (const e of shot.events) {
      const rule = EVENT_SFX[e.kind as ShotEvent['kind']];
      // One effect per kind and shot; keywords only on important sentences.
      if (!rule || seen.has(e.kind) || (e.kind === 'keyword' && shot.importance < 4)) continue;
      seen.add(e.kind);
      candidates.push({ shot, at: e.at, frame: shot.startFrame + e.at, rule });
    }
  }
  candidates.sort((a, b) => b.rule.priority - a.rule.priority || a.frame - b.frame);

  const accepted: Array<{ frame: number; asset: string }> = [];
  const plan: SoundPlan = { sfx: new Map(), why: new Map(), missing: [] };
  const burst = 2 * fps;
  const halfWindow = 15 * fps;
  const minute = 60 * fps;
  for (const c of candidates) {
    if (accepted.filter((a) => Math.abs(a.frame - c.frame) < burst).length >= 3) continue;
    const shotsAround = shots.filter((s) => Math.abs(s.startFrame - c.frame) < halfWindow).length;
    if (accepted.filter((a) => Math.abs(a.frame - c.frame) < halfWindow).length >= Math.max(1, Math.floor(shotsAround / 2))) continue;
    const category = c.rule.categories.find((cat) => library[cat]?.length);
    if (!category) {
      for (const cat of c.rule.categories.slice(0, 1)) if (!plan.missing.includes(cat)) plan.missing.push(cat);
      continue;
    }
    // Rotate files: the least used in the last minute, never more than 3 times.
    const options = library[category]!.map((asset) => ({ asset, uses: accepted.filter((a) => a.asset === asset && Math.abs(a.frame - c.frame) < minute).length })).sort((a, b) => a.uses - b.uses);
    const pick = options[0]!;
    if (pick.uses >= 3) continue;
    accepted.push({ frame: c.frame, asset: pick.asset });
    const list = plan.sfx.get(c.shot.shotId) ?? [];
    list.push({ sfx: pick.asset, ...(c.at ? { at: c.at } : {}), gainDb: c.rule.gainDb });
    plan.sfx.set(c.shot.shotId, list.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)));
    if (!plan.why.has(c.shot.shotId)) plan.why.set(c.shot.shotId, c.rule.why);
  }
  return plan;
}

/**
 * Music state of every shot: one state per scene (the music changes at scene
 * boundaries), `build` in a scene that prepares a revelation, then `reveal`
 * on it and `aftermath` after it.
 */
export function musicStates(shots: Array<{ id: string; sceneId: string; sceneIndexInChapter: number; chapterIndex: number; revelation: boolean }>): Map<string, MusicState> {
  const out = new Map<string, MusicState>();
  const scenes = [...new Set(shots.map((s) => s.sceneId))];
  for (const sceneId of scenes) {
    const inScene = shots.filter((s) => s.sceneId === sceneId);
    const first = inScene[0]!;
    const revealAt = inScene.findIndex((s) => s.revelation);
    const base: MusicState = revealAt >= 0 ? 'build' : first.chapterIndex === 0 && first.sceneIndexInChapter === 0 ? 'tension' : first.sceneIndexInChapter === 0 ? 'calm' : 'tension';
    inScene.forEach((s, i) => out.set(s.id, revealAt < 0 || i < revealAt ? base : i === revealAt ? 'reveal' : 'aftermath'));
  }
  return out;
}

/** Major revelations that get a controlled silence: one per chapter, 60 s apart (SIL-03). */
export function pickSilences(candidates: Array<{ shotId: string; chapterIndex: number; frame: number; importance: number }>, fps: number): Set<string> {
  const chosen = new Set<string>();
  let lastFrame = -Infinity;
  const byChapter = new Map<number, typeof candidates>();
  for (const c of candidates) byChapter.set(c.chapterIndex, [...(byChapter.get(c.chapterIndex) ?? []), c]);
  for (const [, list] of [...byChapter].sort((a, b) => a[0] - b[0])) {
    const best = [...list].sort((a, b) => b.importance - a.importance || a.frame - b.frame)[0]!;
    if (best.frame - lastFrame < SILENCE_GAP_SECONDS * fps) continue;
    chosen.add(best.shotId);
    lastFrame = best.frame;
  }
  return chosen;
}
