import type { AudioTrack, VoiceoverSegment } from './audio.js';
import type { AssetRegistry } from './assets.js';
import type { Animation } from './animation.js';
import type { Background } from './background.js';
import type { CaptionTrack } from './captions.js';
import type { Effect } from './effects.js';
import type { Layer } from './layer.js';
import type { AspectRatio, Dimensions, Frames, JsonObject } from './primitives.js';
import type { Transition } from './transition.js';

/**
 * Built-in scene types. The union is open (`string & {}`) so new types can be
 * registered at runtime through the scene type registry without editing this file.
 */
export type BuiltInSceneType =
  | 'video'
  | 'image'
  | 'title'
  | 'text'
  | 'broll'
  | 'talking_head'
  | 'quote'
  | 'statistic'
  | 'chart'
  | 'screenshot'
  | 'montage'
  | 'endcard'
  | 'custom';

export type SceneType = BuiltInSceneType | (string & {});

/** Narrative function of a scene. Used by AI generation and pacing heuristics. */
export type SceneRole =
  | 'hook'
  | 'intro'
  | 'context'
  | 'explanation'
  | 'example'
  | 'evidence'
  | 'statistic'
  | 'twist'
  | 'recap'
  | 'cta'
  | 'outro'
  | (string & {});

export interface SceneMetadata {
  role?: SceneRole;
  title?: string;
  /** How the scene was produced. */
  source?: 'manual' | 'ai' | 'template';
  /** Id of the script segment the scene illustrates. */
  scriptSegmentId?: string;
  tags?: string[];
  notes?: string;
  /** Free data for integrations (AI prompt, confidence, stock search query…). */
  extra?: JsonObject;
}

export interface Scene {
  id: string;
  type: SceneType;
  /**
   * Optional authoring hint. The authoritative start is always DERIVED from the
   * scene order, durations and transition overlaps by `resolveTimeline()`.
   * When present and different from the derived value, validation warns.
   */
  startFrame?: Frames;
  durationInFrames: Frames;
  /** Must equal the project fps when set. Kept for portability of single scenes. */
  fps?: number;
  /** Must equal the project aspect ratio when set. */
  aspectRatio?: AspectRatio;
  background: Background;
  layers: Layer[];
  audio: AudioTrack[];
  voiceover?: VoiceoverSegment;
  captions?: CaptionTrack;
  /** Scene-level animations (camera moves, parallax, shake) applied to the whole layer stack. */
  animations: Animation[];
  /** Scene-level effects (color grade, grain…) applied after compositing the layers. */
  effects: Effect[];
  transitionIn?: Transition;
  transitionOut?: Transition;
  metadata?: SceneMetadata;
}

export interface VideoProject {
  id: string;
  name?: string;
  /** Schema version of the serialized document. */
  schemaVersion: number;
  fps: number;
  dimensions: Dimensions;
  aspectRatio: AspectRatio;
  /** Background shown behind scenes and during edge transitions. */
  background: Background;
  scenes: Scene[];
  assets: AssetRegistry;
  /** Project-wide audio (music bed, global SFX). Frames are absolute. */
  audio: AudioTrack[];
  metadata?: JsonObject;
}
