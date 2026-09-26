/**
 * Inputs and outputs of the editor brain.
 *
 * SCRIPT + VOICE (+ transcript) + ASSETS (+ catalogue) + MUSIC + SFX
 *   → EDITORIAL ANALYSIS (units)
 *   → STORY STRUCTURE (chapters, scenes, beats)
 *   → SHOT PLAN (types, durations on the voice, visuals, camera, motion, sound)
 *   → ShotPlan version 2, validated against VIDEO_EDITING_BIBLE.md
 */
import type {
  AssetRegistry,
  Beat,
  ChartPayload,
  DocumentPayload,
  EditorialAnalysis,
  EditorialIntent,
  EditorialLevel,
  MapPayload,
  MotionSkillRegistry,
  NumberPayload,
  SfxCategory,
  ShotPlan,
  TranscriptWord,
  ValidationIssue,
} from '@studio-engine/scene-engine';

/** A script is a list of chapters headings and sentences-or-paragraphs of narration. */
export type ScriptBlock = { kind: 'chapter'; title: string; question?: string } | { kind: 'text'; text: string; hints?: UnitHints };

/**
 * Facts the heuristics cannot guess and must never invent: chart data,
 * document regions, exact places. Written by the author, by the local
 * pipeline, or (Phase 4) by the LLM analyzer.
 */
export interface UnitHints {
  intent?: EditorialIntent;
  importance?: EditorialLevel;
  highlightedWords?: string[];
  /** Asset to use for this sentence. */
  media?: string;
  number?: NumberPayload;
  chart?: ChartPayload & { source?: string };
  map?: MapPayload;
  document?: DocumentPayload;
  places?: string[];
  /** Apple style: a word of the sentence struck through as it ends ("isn't a ~burger~ company"). */
  strike?: string;
  /** Apple style: a share to show as lit units (studio-units), e.g. { value: 57, label: "of the land" }. Never guessed. */
  share?: { value: number; of?: number; label?: string };
  /** Apple style: the document rebuilt as a card (studio-document). `*word*` in the sentence is highlighted when spoken. */
  documentCard?: { header?: string; heading?: string; sentence: string; rows?: string | Array<[string, string]>; column?: string; footnote?: string };
  /** Source line shown under a figure. */
  source?: string;
}

/** What an asset shows, so the visual director can match it to the narration. */
export interface CatalogEntry {
  assetId: string;
  description?: string;
  tags?: string[];
  /** For documents: regions of text, in percent of the page, to highlight when they are spoken. */
  regions?: Array<{ text: string; x: number; y: number; width: number; height: number }>;
}

export type Pacing = 'calm' | 'standard' | 'dynamic';

export interface BrainInput {
  fps?: number;
  width?: number;
  height?: number;
  title?: string;
  script: ScriptBlock[];
  assets: AssetRegistry;
  /** Defaults to `asset.metadata.description` / `asset.metadata.tags`. */
  catalog?: CatalogEntry[];
  /** Narration FILE and its word timings (milliseconds of the file). Without it, timing is estimated. */
  narration?: { assetId: string; words: TranscriptWord[]; gainDb?: number };
  music?: { assetId: string; gainDb?: number; duckDb?: number };
  /** Ambience bed (room tone, city…), looped at -28 dB by default; it drops with the music before a revelation. */
  ambience?: { assetId: string; gainDb?: number };
  /** Sound library: asset ids by category. */
  sfx?: Partial<Record<SfxCategory, string[]>>;
  captions?: boolean;
  /** Edit style. `apple`: studio blocks timed to the voice, hard cuts, no burned-in captions. Default: the engine's compositions. */
  style?: 'default' | 'apple';
  /** Length of the pauses kept between sentences. Default `standard`. */
  pacing?: Pacing;
  /**
   * MapLibre style of a licensed tile provider (or self-hosted PMTiles), with
   * its on-screen attribution. With it, a map of one place zooms to street
   * level (`city_zoom`); without it, maps stay on the offline world map.
   */
  mapStyle?: { url: string; attribution: string };
  skills?: MotionSkillRegistry;
}

export interface NumberEntity {
  value: number;
  /** Words as written in the script ("sixty one percent", "61 %"). */
  text: string;
  prefix?: string;
  suffix?: string;
  /** Index of the first word of the number inside the sentence. */
  wordIndex: number;
  /** Words after the number, e.g. "of its revenue comes from franchisees". */
  label?: string;
}

export interface Place {
  name: string;
  coordinates: [number, number];
  wordIndex: number;
}

/** EDITORIAL ANALYZER output: one unit per sentence of narration. */
export interface EditorialUnit {
  id: string;
  index: number;
  chapterIndex: number;
  text: string;
  /** Words of the sentence (as written). */
  words: string[];
  /** Timing in milliseconds of the narration FILE (estimated without a transcript). */
  startMs: number;
  endMs: number;
  /** Start of each word of the sentence, same unit. */
  wordStartsMs: number[];
  estimatedTiming: boolean;
  intent: EditorialIntent;
  importance: EditorialLevel;
  analysis: EditorialAnalysis;
  entities: { numbers: NumberEntity[]; emphasis: string[]; places: Place[]; quote?: string };
  /** Why the analyzer chose this intent: the cue it found. */
  why: string;
  hints?: UnitHints;
}

/** STORY ARCHITECT output. */
export interface StoryStructure {
  chapters: Array<{ id: string; title: string; question?: string; unitIds: string[] }>;
  scenes: Array<{ id: string; chapterId: string; purpose: string; unitIds: string[] }>;
  beats: Record<string, Beat>;
}

/** Something the brain needs and must not invent. */
export interface AssetRequest {
  unitId: string;
  need: 'image' | 'video' | 'document' | 'chart-data' | 'map-place' | 'document-region' | 'sfx';
  description: string;
}

export interface BrainResult {
  plan: ShotPlan;
  analysis: EditorialUnit[];
  structure: StoryStructure;
  assetRequests: AssetRequest[];
  /** Notable decisions and fallbacks, in plain language. */
  decisions: string[];
  /** Final validation (stage `final`) and compile notes of the produced plan. */
  qc: { valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[]; notes: string[] };
}
