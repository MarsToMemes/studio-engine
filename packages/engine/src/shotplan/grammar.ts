/**
 * The editorial grammar of VIDEO_EDITING_BIBLE.md §4 as data: for each
 * editorial intent, the treatments a professional editor would use, in order
 * of preference. The editor brain picks from it; validation (GRAM-01) checks
 * that a plan stays inside it or says why.
 *
 * Skill ids may name skills that are not installed yet (the bible's
 * catalogue): callers filter them through the Motion Skill Registry.
 */
import type { ShotType } from './types.js';
import type { EditorialIntent, ShotCameraMove } from './vocabulary.js';

/** Sound library categories (bible §11). */
export const SFX_CATEGORIES = ['whoosh', 'impact', 'hit', 'riser', 'drop', 'glitch', 'click', 'pop', 'bass', 'reveal', 'transition', 'notification', 'document', 'camera', 'digital', 'ambient'] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];

export interface GrammarEntry {
  /** Shot types that tell this kind of information, preferred first. */
  shotTypes: ShotType[];
  /** Motion skills, preferred first. An empty list means "camera only". */
  skills: string[];
  /** Camera moves that suit it, preferred first. */
  camera: ShotCameraMove[];
  /** Sound categories that may accompany it (restraint: optional). */
  sfx: SfxCategory[];
  /** Why this treatment: the default `reasons.motion`. */
  why: string;
}

export const EDITORIAL_GRAMMAR: Record<EditorialIntent, GrammarEntry> = {
  hook: {
    shotTypes: ['text', 'revelation', 'image'],
    skills: ['keyword_pop', 'scale_text', 'mask_reveal', 'highlight_word', 'word_reveal', 'kinetic_statement'],
    camera: ['punch_in', 'push_in'],
    sfx: ['impact'],
    why: 'One strong statement with its key word isolated: the promise of the video.',
  },
  context: { shotTypes: ['image', 'video'], skills: ['slow_zoom', 'slow_push', 'pan_left', 'pan_right'], camera: ['push_in', 'pan_left', 'pan_right', 'static'], sfx: [], why: 'Set the scene with restrained movement.' },
  fact: { shotTypes: ['image', 'video', 'text'], skills: ['slow_zoom', 'slow_push', 'pan_left', 'pan_right', 'word_reveal'], camera: ['push_in', 'pan_left', 'pan_right', 'static'], sfx: [], why: 'A simple fact stays sober: image and restrained movement.' },
  important_fact: {
    shotTypes: ['text', 'image'],
    skills: ['highlight_word', 'word_reveal', 'scale_text', 'mask_reveal', 'underline_word', 'keyword_pop', 'blur_reveal', 'kinetic_statement'],
    camera: ['push_in', 'static'],
    sfx: ['pop', 'click'],
    why: 'An important fact becomes kinetic typography with its key word emphasised.',
  },
  keyword: { shotTypes: ['text'], skills: ['keyword_pop', 'word_reveal', 'scale_text', 'mask_reveal', 'highlight_word', 'underline_word'], camera: ['static', 'punch_in'], sfx: ['click', 'pop'], why: 'The key word is isolated when it is spoken.' },
  number: {
    shotTypes: ['number'],
    skills: ['number_pop', 'number_count', 'percentage_reveal', 'currency_reveal', 'stat_card', 'counter_roll', 'odometer'],
    camera: ['static', 'punch_in'],
    sfx: ['impact'],
    why: 'The figure builds up on screen as it is spoken.',
  },
  statistic: {
    shotTypes: ['chart', 'number'],
    skills: ['bar_animation', 'line_animation', 'chart_growth', 'chart_reveal', 'pie_reveal', 'percentage_bar', 'ranking_animation', 'number_count'],
    camera: ['static'],
    sfx: ['riser'],
    why: 'The data builds step by step with the voice: an evolution, one idea.',
  },
  comparison: { shotTypes: ['chart', 'text'], skills: ['comparison_graph', 'bar_animation', 'scale_text'], camera: ['static'], sfx: [], why: 'Two values side by side make the gap obvious.' },
  quote: { shotTypes: ['text'], skills: ['quote_card', 'word_reveal', 'typewriter'], camera: ['static'], sfx: [], why: 'A quote is shown as a quote, attributed.' },
  proof: {
    shotTypes: ['document'],
    skills: ['document_highlight', 'document_zoom', 'document_pan', 'source_reveal', 'document_focus', 'redaction_reveal'],
    camera: ['push_in', 'pan_left', 'pan_right', 'tilt_down'],
    sfx: ['document', 'click'],
    why: 'Visual proof right after the claim: the exact sentence is highlighted as it is read.',
  },
  location: {
    shotTypes: ['map'],
    skills: ['map_zoom', 'location_pin', 'business_expansion', 'country_highlight', 'map_route', 'city_zoom', 'flight_route'],
    camera: ['static'],
    sfx: ['whoosh'],
    why: 'The map gives scale and moves towards the place as it is named.',
  },
  process: { shotTypes: ['text', 'image'], skills: ['word_reveal', 'slide_text', 'typewriter', 'timeline_event'], camera: ['static'], sfx: ['click'], why: 'Steps appear one after the other.' },
  contradiction: {
    shotTypes: ['text', 'image'],
    skills: ['full_screen_statement', 'scale_text', 'word_reveal'],
    camera: ['static', 'push_in'],
    sfx: ['drop'],
    why: 'A break: hard cut and a plain statement, the music steps back.',
  },
  revelation: {
    shotTypes: ['revelation', 'text'],
    skills: ['blackout_reveal', 'impact_reveal', 'zoom_reveal', 'flash_reveal', 'glitch_reveal', 'text_reveal', 'light_reveal'],
    camera: ['punch_in', 'static'],
    sfx: ['impact', 'riser', 'reveal'],
    why: 'Change of rhythm, silence, impact, then the reveal.',
  },
  aftermath: { shotTypes: ['image', 'video', 'text'], skills: ['slow_zoom', 'slow_push', 'word_reveal', 'highlight_word'], camera: ['push_in', 'static'], sfx: [], why: 'Let the revelation sink in: slower, calmer.' },
  chapter: { shotTypes: ['chapter'], skills: ['chapter_card'], camera: ['static'], sfx: ['whoosh', 'transition'], why: 'A black chapter card marks the new question.' },
  conclusion: { shotTypes: ['image', 'video', 'text'], skills: ['slow_push', 'slow_zoom'], camera: ['pull_out', 'push_in'], sfx: [], why: 'A visual callback and a controlled slowdown close the story.' },
};
