/**
 * MOTION DIRECTOR. Picks motion skills that exist (the registry), that the
 * grammar of the intent asks for, that can animate this shot, and that were
 * not over-used recently (repetition manager, bible §19). Stills get no
 * content animation: their camera moves them, which keeps restraint (MOT-03).
 */
import { EDITORIAL_GRAMMAR, type Intensity, type MotionSkillRegistry, type ShotType } from '@studio-engine/scene-engine';
import type { EditorialUnit } from './types.js';
import type { Visual } from './visual.js';

const WINDOW = 10;
const MAX_IN_WINDOW = 3;
const TYPOGRAPHIC: readonly ShotType[] = ['text', 'revelation'];
const NEEDS_EMPHASIS = new Set(['keyword_pop', 'highlight_word', 'underline_word']);
const CHART_SKILLS: Record<string, string[]> = { barChart: ['bar_animation', 'chart_growth', 'chart_reveal', 'comparison_graph'], lineChart: ['line_animation', 'chart_growth', 'chart_reveal'], pieChart: ['pie_reveal', 'chart_reveal'] };
const SUPPORT_TEXT = ['word_reveal', 'slide_text', 'blur_reveal', 'mask_reveal', 'scale_text'];

export interface MotionChoice {
  skill?: string;
  why?: string;
}

export class MotionDirector {
  private readonly history: Array<{ skill?: string; type: ShotType }> = [];
  private glitches = 0;

  constructor(private readonly registry: MotionSkillRegistry) {}

  /** `afterSilence`: the shot follows a controlled silence (a blackout reveal fits). */
  choose(v: Visual, u: EditorialUnit, role: 'key' | 'support', afterSilence: boolean): MotionChoice {
    const grammar = EDITORIAL_GRAMMAR[u.intent];
    let candidates = role === 'key' ? grammar.skills : TYPOGRAPHIC.includes(v.type) ? SUPPORT_TEXT : [];
    if (v.type === 'chapter') candidates = ['chapter_card'];
    candidates = candidates.filter((id) => this.fits(id, v, u, afterSilence));
    const recent = this.history.slice(-WINDOW + 1);
    const prevTypo = this.history.slice(-2).filter((h) => TYPOGRAPHIC.includes(h.type));
    const fresh = candidates.filter((id) => recent.filter((h) => h.skill === id).length < MAX_IN_WINDOW);
    // Two typographic shots in a row never share a treatment (REP-05 keeps it to 2).
    const varied = TYPOGRAPHIC.includes(v.type) ? fresh.filter((id) => prevTypo[prevTypo.length - 1]?.skill !== id) : fresh;
    const skill = varied[0] ?? fresh[0] ?? candidates.sort((a, b) => this.uses(a) - this.uses(b))[0];
    this.history.push({ ...(skill ? { skill } : {}), type: v.type });
    if (skill === 'glitch_reveal') this.glitches++;
    if (!skill) return {};
    const why = role === 'key' ? grammar.why : 'The spoken words appear as they are said.';
    return { skill, why: skill === candidates[0] || role === 'support' ? why : `${why} (${skill}: alternatives were used recently)` };
  }

  private uses(id: string): number {
    return this.history.filter((h) => h.skill === id).length;
  }

  /** Installed, available, compatible, and with something to animate. */
  private fits(id: string, v: Visual, u: EditorialUnit, afterSilence: boolean): boolean {
    const def = this.registry.get(id);
    if (!def || !this.registry.isAvailable(id) || !def.compatibleShotTypes.includes(v.type)) return false;
    // Camera moves go through the shot `camera` (one per shot, CAM-02), never a camera-style skill.
    if (def.category === 'images') return false;
    if (NEEDS_EMPHASIS.has(id) && !v.highlightedWords?.length) return false;
    if (id === 'percentage_reveal' && v.number?.suffix !== '%') return false;
    if (id === 'currency_reveal' && !v.number?.prefix) return false;
    if (v.type === 'chart' && def.category === 'data' && !(CHART_SKILLS[v.chart!.kind] ?? []).includes(id)) return false;
    if (id === 'document_highlight' && !v.document?.highlights?.length) return false;
    if (id === 'source_reveal' && !v.document?.source) return false;
    if (id === 'location_pin' && !(v.map?.markers?.length)) return false;
    if (id === 'business_expansion' && (v.map?.markers?.length ?? 0) < 3) return false;
    if (id === 'map_route' && (v.map?.route?.length ?? 0) < 2) return false;
    if (id === 'country_highlight' && !v.map?.highlightCountries?.length) return false;
    if (id === 'blackout_reveal' && !afterSilence) return false;
    if (id === 'glitch_reveal' && (u.importance < 5 || this.glitches >= 3)) return false;
    return true;
  }

  controlsCamera(skill: string | undefined): boolean {
    return skill ? (this.registry.get(skill)?.controlsCamera ?? false) : false;
  }
}

/** Strong for the hook and the major revelations only; the rest by importance (MOT-02). */
export function intensityOf(u: EditorialUnit, role: 'key' | 'support', majorRevelation: boolean): Intensity {
  if (role === 'key' && (u.intent === 'hook' || majorRevelation)) return 'strong';
  if (role === 'key' && u.importance >= 4) return 'medium';
  return 'subtle';
}
