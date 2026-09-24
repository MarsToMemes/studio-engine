/**
 * The AI-facing contract.
 *
 * An LLM should not write full `Scene` objects (frames, layer boxes, z-order).
 * It writes a compact, intention-level BLUEPRINT in seconds, with preset ids
 * instead of raw animation data. `compileBlueprint()` turns it into a
 * validated `VideoProject`. Everything here is plain JSON.
 */
import type { AspectRatio, JsonObject } from '../model/primitives.js';
import type { SceneRole, SceneType } from '../model/scene.js';
import type { PresetRef } from '../presets/types.js';

/** A preset id, or a preset reference with parameter overrides. */
export type PresetChoice = string | PresetRef;

export interface BlueprintWord {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface BlueprintMedia {
  /** Id of an asset in the asset registry passed to the compiler. */
  assetId: string;
  /** `background`: full frame behind everything. `main`: primary visual. `inset`: picture-in-picture. */
  role?: 'background' | 'main' | 'inset';
  /** Treatment preset (brollTreatment or imageTreatment). */
  treatment?: PresetChoice;
}

export interface SceneBlueprint {
  /** Scene type, e.g. "title", "broll", "statistic". */
  type: SceneType;
  role?: SceneRole;
  /**
   * Narrative window in the narration, in seconds. When omitted, scenes are
   * laid out back to back using `durationSeconds` or the scene type default.
   */
  startSeconds?: number;
  endSeconds?: number;
  durationSeconds?: number;
  /** Narration spoken during the scene. */
  script?: string;
  /** Word timings from forced alignment / transcription, absolute seconds. */
  words?: BlueprintWord[];
  headline?: string;
  subtext?: string;
  quote?: { text: string; author?: string };
  statistic?: { value: number; from?: number; prefix?: string; suffix?: string; decimals?: number; label?: string };
  chart?: { kind: 'barChart' | 'lineChart' | 'pieChart'; data: JsonObject; title?: string };
  media?: BlueprintMedia[];
  /** What to look for in stock libraries when media is not chosen yet. Stored in metadata. */
  visualQuery?: string;
  typography?: PresetChoice;
  textEffect?: PresetChoice;
  camera?: PresetChoice;
  /** Transition INTO this scene. */
  transitionIn?: PresetChoice;
  captions?: boolean;
  notes?: string;
}

export interface BlueprintDocument {
  version: 1;
  title?: string;
  fps?: number;
  aspectRatio?: AspectRatio;
  /** Whole narration file. Each scene gets its slice as a voiceover segment. */
  narration?: { assetId: string };
  music?: { assetId: string; volume?: number; duckTo?: number };
  /** Defaults applied to every scene that does not choose its own. */
  style?: {
    typography?: PresetChoice;
    textEffect?: PresetChoice;
    captions?: PresetChoice;
    transition?: PresetChoice;
    brollTreatment?: PresetChoice;
    imageTreatment?: PresetChoice;
  };
  scenes: SceneBlueprint[];
}
