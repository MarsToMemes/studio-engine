import type { GraphicKind } from '../model/layer.js';
import type { PresetParameter, PresetParams } from '../presets/types.js';
import type { ComposedShot, ShotEvent, ShotSkillContext } from '../shotplan/compile.js';
import type { Intensity, ShotType } from '../shotplan/types.js';

export type SkillCategory = 'text' | 'numbers' | 'images' | 'documents' | 'data' | 'maps' | 'reveals' | 'editorial';

/**
 * - `remotion`: engine animations (transforms, opacity, masks, kinetic text) rendered by Remotion;
 * - `svg`: a graphic component drawn in SVG (charts, d3 maps, counters);
 * - `maplibre`: MapLibre GL (WebGL) map with tiles;
 * - `lottie` / `canvas` / `gsap`: reserved for skills that need them.
 */
export type SkillImplementation = 'remotion' | 'svg' | 'maplibre' | 'lottie' | 'canvas' | 'gsap';

/**
 * Serializable description of a motion skill — what the AI and the UI see.
 * Mirrors the product spec (`MotionSkill`), plus the fields the engine needs
 * to guarantee a render: fallbacks, renderer requirements, emitted events.
 */
export interface MotionSkill {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  parameters: Record<string, PresetParameter>;
  /** Default intensity. */
  intensity: Intensity;
  /** Duration of the effect, in seconds. */
  duration: { min: number; max: number };
  /** Typical duration of the effect, in seconds. */
  defaultDuration: number;
  /**
   * Near-duplicates share a family (pan_left / pan_right → "pan"): the
   * repetition manager counts families, so alternating names is not variety.
   */
  family: string;
  /**
   * How the skill is rendered. The AI never sees or chooses this: it only
   * picks the skill id (bible §11: the editorial brain stays independent of
   * the implementation).
   */
  implementation: SkillImplementation;
  compatibleShotTypes: ShotType[];
  preview?: string;
  /** Tried in order when this skill cannot be applied. The chain ends with "no motion" (hard cut). */
  fallback: string[];
  /** Editorial events the skill emits (for automatic sound design). */
  events: ShotEvent['kind'][];
  /**
   * The skill moves the camera itself (media layer or scene zoom/pan). A
   * shot `camera` is then ignored (bible CAM-02: one camera move per shot).
   */
  controlsCamera: boolean;
  /** Renderer capabilities the skill needs. */
  requires?: { graphicKinds?: GraphicKind[] };
  version: number;
}

export interface SkillApplyContext extends ShotSkillContext {
  intensity: Intensity;
  params: PresetParams;
  durationInFrames: number;
}

export interface SkillApplyResult {
  events?: ShotEvent[];
}

export interface SkillDefinition extends MotionSkill {
  /** False when the composed shot lacks what the skill targets (e.g. no highlighted word). */
  canApply?: (target: ComposedShot) => boolean;
  apply: (target: ComposedShot, ctx: SkillApplyContext) => SkillApplyResult | void;
}

export type { PresetParams };
