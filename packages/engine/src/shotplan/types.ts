/**
 * ShotPlan — the editorial language shared by the AI director and the UI.
 *
 * A ShotPlan says WHAT happens (shot type, media, text, motion skill,
 * transition, intensity, sound events). The engine decides HOW, by compiling
 * it into a `VideoProject` (see compile.ts).
 *
 * Two deliberate differences with a naive "Timeline" format:
 * - shots store only their duration; start frames are DERIVED (toTimeline),
 *   so changing one duration never desynchronises the rest;
 * - `sfx` is a list of events, because one shot often has several sounds.
 *
 * The exact flat `Timeline` format (with `startFrame`) is produced by
 * `toTimeline()` and accepted back by `fromTimeline()`.
 */
import type { AssetRegistry } from '../model/assets.js';
import type { JsonObject, JsonValue } from '../model/primitives.js';

export type ShotType = 'image' | 'video' | 'text' | 'number' | 'document' | 'chart' | 'map' | 'revelation' | 'chapter';

export type Intensity = 'subtle' | 'medium' | 'strong';

export interface SfxEvent {
  /** Asset id, or a SFX library id resolved by `CompileShotPlanOptions.resolveSfx`. */
  sfx: string;
  /** Frames from the shot start. Defaults to 0. */
  at?: number;
  /** Gain relative to the SFX asset, in dB. Defaults to -6 dB (subtle). */
  gainDb?: number;
}

export interface NumberPayload {
  value: number;
  from?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** Label under the number, e.g. "of revenue from franchisees". */
  label?: string;
}

export interface ChartPayload {
  kind: 'barChart' | 'lineChart' | 'pieChart';
  labels: string[];
  values: number[];
  unit?: string;
  title?: string;
}

export interface MapPayload {
  /** [longitude, latitude] */
  center: [number, number];
  zoom?: number;
  markers?: Array<{ label?: string; coordinates: [number, number] }>;
  route?: Array<[number, number]>;
  highlightCountries?: string[];
}

/** A highlighted region of a document image, in percent of the image box. */
export interface DocumentHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Frame from the shot start when the highlight appears (sync it with the narration). */
  at?: number;
}

export interface DocumentPayload {
  /** Citation shown on screen, e.g. "The Wall Street Journal, 2023". */
  source?: string;
  highlights?: DocumentHighlight[];
}

export interface Shot {
  /** Stable id. Becomes the scene id, so edits in the UI map back to the plan. */
  id: string;
  type: ShotType;
  durationInFrames: number;
  /** Asset id in `ShotPlan.assets`. */
  media?: string;
  text?: string;
  /** Secondary text: label, citation, chapter number… */
  subtext?: string;
  /** Words of `text` rendered in the accent color (case and punctuation insensitive). */
  highlightedWords?: string[];
  /** Motion skill id from the skill registry. Unknown skills never break the render. */
  motionSkill?: string;
  /** Transition INTO this shot. Defaults to `hard_cut`. */
  transition?: string;
  /** Overrides the transition's default duration. */
  transitionDurationInFrames?: number;
  intensity?: Intensity;
  sfx?: SfxEvent[];
  number?: NumberPayload;
  chart?: ChartPayload;
  map?: MapPayload;
  document?: DocumentPayload;
  metadata?: JsonObject;
}

/** One transcribed word, in absolute milliseconds (same unit as @remotion/captions). */
export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface ShotPlan {
  version: 1;
  fps: number;
  width: number;
  height: number;
  shots: Shot[];
  assets: AssetRegistry;
  /** Continuous voice-over for the whole episode, starting at frame 0. */
  narration?: {
    assetId: string;
    /** Word timings from transcription / forced alignment. Drives captions. */
    words?: TranscriptWord[];
    /** Gain applied to the narration asset in dB (after loudness normalisation). */
    gainDb?: number;
  };
  music?: {
    assetId: string;
    /** Level of the music bed without voice. Default -18 dB. */
    gainDb?: number;
    /** Extra attenuation while the voice plays. Default -6 dB (→ -24 dB under voice). */
    duckDb?: number;
  };
  captions?: {
    enabled: boolean;
    /** Caption preset id. Default `caption-bold-pop`. */
    style?: string;
    wordsPerCue?: number;
    /**
     * Shot types that show captions. Default: image, video, document, chart, map.
     * Full-screen typography shots (text, number, revelation, chapter) already
     * show the words, so repeating them as captions is avoided by default.
     */
    showOn?: ShotType[];
  };
  metadata?: JsonObject;
}

/** The flat Timeline format: a read-only, derived view of a ShotPlan. */
export interface TimelineShot {
  id: string;
  startFrame: number;
  durationInFrames: number;
  type: ShotType;
  media?: string;
  text?: string;
  highlightedWords?: string[];
  motionSkill?: string;
  transition?: string;
  intensity?: Intensity;
  /** First SFX event. The full list is in `metadata.sfxEvents`. */
  sfx?: string;
  metadata?: Record<string, JsonValue>;
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  shots: TimelineShot[];
}
