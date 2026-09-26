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
import type { Beat, ShotCameraMove, DecidedBy, EditorialIntent, EditorialLevel, Framing, MusicState, SilenceKind } from './vocabulary.js';
import type { AssetRegistry } from '../model/assets.js';
import type { JsonObject, JsonValue } from '../model/primitives.js';
import type { HyperFramesUse } from '../hyperframes/index.js';

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
  /**
   * MapLibre style URL for street-level maps (skill `city_zoom`): your tile
   * provider or self-hosted PMTiles. Its data licence decides `attribution`.
   */
  style?: string;
  /** Map data attribution shown on screen when the licence requires it (bible MAP-05), e.g. "© OpenStreetMap contributors". */
  attribution?: string;
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
  /** Parameters of the motion skill (validated against the skill definition). */
  motionParams?: JsonObject;
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
  /**
   * HyperFrames catalog item drawn full frame as the shot's visual. It replaces
   * the type's default composition (the type's payload becomes optional);
   * captions, sound and transitions still apply.
   */
  block?: HyperFramesUse;
  /** HyperFrames items layered over the shot: lower thirds, light leaks, callouts… */
  overlays?: HyperFramesUse[];
  metadata?: JsonObject;

  // --- Editorial layer (version 2). Optional in version 1 plans. -------------
  /** Scene the shot belongs to (`ShotPlan.scenes`). Shots of a scene are contiguous. */
  sceneId?: string;
  /** Narrative step inside the scene. */
  beat?: Beat;
  /** What the viewer must understand, feel or discover here (bible DIR-01). */
  editorialIntent?: EditorialIntent;
  /** Why each decision was taken: the inspectable reasoning shown to the user. `shot` is required in v2. */
  reasons?: ShotReasons;
  /** Importance of the information, 1–5. */
  importance?: EditorialLevel;
  /** Editorial heuristics from the analyzer (ordinal, never measurements). */
  analysis?: EditorialAnalysis;
  visualHierarchy?: VisualHierarchy;
  framing?: Framing;
  /** Camera movement on the media, independent of the motion skill (bible §7). */
  camera?: ShotCameraMove;
  /** Point of interest for framing and camera moves, percent of the media (default centre). */
  focus?: { x: number; y: number };
  musicState?: MusicState;
  /** Intentional long shot (> 4 s): the reason (bible RHY-04). */
  hold?: string;
  /** Id of an intentional sequence of same-type shots (archive montage…), exempt from VAR-01. */
  sequence?: string;
  decidedBy?: DecidedBy;
}

export interface ShotReasons {
  /** Why this shot: what the viewer must understand, feel or discover. */
  shot: string;
  motion?: string;
  camera?: string;
  transition?: string;
  sfx?: string;
  music?: string;
}

export interface EditorialAnalysis {
  surprise?: EditorialLevel;
  informationDensity?: EditorialLevel;
  visualPotential?: EditorialLevel;
  tension?: EditorialLevel;
  /** Free label, e.g. "tension", "curiosity". */
  emotion?: string;
  proofRequired?: boolean;
}

export interface VisualHierarchy {
  primary: string;
  secondary?: string;
  background?: string;
}

export interface Chapter {
  id: string;
  title: string;
  /** Question the chapter answers (bible STORY-01, CHAP-05). */
  question?: string;
}

export interface EditorialScene {
  id: string;
  chapterId?: string;
  /** Narrative purpose in one sentence (bible SCENE-01). */
  purpose: string;
  /** Ids of `memory.visualMotifs` used in the scene. */
  motifs?: string[];
}

/**
 * A range of the narration file placed on the timeline. With segments the
 * voice-over is no longer one continuous file from frame 0: pauses and
 * controlled silences become possible and music ducking follows the speech.
 */
export interface NarrationSegment {
  id: string;
  /** Range of `narration.assetId`, in milliseconds. */
  sourceStartMs: number;
  sourceEndMs: number;
  /** Timeline frame where the range starts playing. */
  startFrame: number;
  text?: string;
}

export interface MusicCue {
  id: string;
  /** Absolute timeline frame. */
  atFrame: number;
  state: MusicState;
  /** Music level from this cue, in dB (default: the music gain). */
  gainDb?: number;
  fadeInFrames?: number;
}

/** A controlled silence that ends where `beforeShotId` starts (bible §13). */
export interface ControlledSilence {
  id: string;
  beforeShotId: string;
  durationInFrames: number;
  kinds: SilenceKind[];
}

/** Visual concepts introduced during the episode, for callbacks (bible §21). */
export interface EditorialMemory {
  visualMotifs?: Array<{ id: string; description: string; assetId?: string; introducedIn?: string }>;
  introducedConcepts?: Array<{ id: string; label: string; introducedIn?: string }>;
  callbackCandidates?: Array<{ motifId: string; callbackShotId?: string; note?: string }>;
}

/** One transcribed word, in absolute milliseconds (same unit as @remotion/captions). */
export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface ShotPlan {
  /** 1: shots only. 2: editorial plan (scenes, intents, reasons, camera, music, silences). */
  version: 1 | 2;
  fps: number;
  width: number;
  height: number;
  shots: Shot[];
  assets: AssetRegistry;
  /**
   * Voice-over. Without `segments` it is one continuous file starting at
   * frame 0; with `segments`, ranges of the file are placed on the timeline.
   */
  narration?: {
    assetId: string;
    /** Word timings from transcription / forced alignment, in milliseconds of the narration FILE. Drives captions. */
    words?: TranscriptWord[];
    /** Gain applied to the narration asset in dB (after loudness normalisation). */
    gainDb?: number;
    segments?: NarrationSegment[];
  };
  music?: {
    assetId: string;
    /** Level of the music bed without voice. Default -18 dB. */
    gainDb?: number;
    /** Extra attenuation while the voice plays. Default -6 dB (→ -24 dB under voice). */
    duckDb?: number;
    /** Explicit music cues. Default: derived from the shots' `musicState`. */
    cues?: MusicCue[];
  };
  /** Ambience bed (room tone, city, wind…), looped under everything; cut by `ambient_drop` silences. */
  ambience?: {
    assetId: string;
    /** Default -28 dB. */
    gainDb?: number;
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
  // --- Editorial layer (version 2) -------------------------------------------
  chapters?: Chapter[];
  scenes?: EditorialScene[];
  silences?: ControlledSilence[];
  memory?: EditorialMemory;
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
  // Editorial layer (v2). `reasons`, `visualHierarchy`, `analysis`, `focus`,
  // `sequence` and `decidedBy` travel in `metadata`.
  sceneId?: string;
  beat?: Beat;
  editorialIntent?: EditorialIntent;
  importance?: EditorialLevel;
  camera?: ShotCameraMove;
  framing?: Framing;
  musicState?: MusicState;
  hold?: string;
  metadata?: Record<string, JsonValue>;
}

export interface Timeline {
  /** Version of the plan it was derived from (absent = 1). */
  version?: 1 | 2;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  shots: TimelineShot[];
  chapters?: Chapter[];
  scenes?: EditorialScene[];
  /** Effective music cues: explicit ones, or derived from the shots' `musicState` (bible MUS-05). */
  musicCues?: MusicCue[];
  /** Controlled silences with their resolved position. */
  silences?: Array<ControlledSilence & { startFrame: number }>;
  narrationSegments?: NarrationSegment[];
  memory?: EditorialMemory;
}
