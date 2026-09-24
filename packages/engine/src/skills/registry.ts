/**
 * MotionSkillRegistry — the only vocabulary the AI director can use.
 *
 * - getAvailableMotionSkills() lists skills that can ACTUALLY be rendered with
 *   the renderer capabilities given to the registry (never a phantom skill).
 * - resolve() walks the fallback chain: requested → fallbacks (depth first,
 *   cycle-safe) → "no motion". A missing or unusable skill never fails a render.
 */
import type { GraphicKind } from '../model/layer.js';
import type { PresetParams } from '../presets/types.js';
import { resolveParameterValues } from '../presets/registry.js';
import type { ComposedShot, ShotSkillResolver } from '../shotplan/compile.js';
import type { Intensity, ShotType } from '../shotplan/types.js';
import type { MotionSkill, SkillCategory, SkillDefinition } from './types.js';

/** Graphic kinds drawn by the reference Remotion renderer (packages/remotion). */
export const REFERENCE_RENDERER_GRAPHIC_KINDS = ['counter', 'statCard', 'barChart', 'lineChart', 'pieChart', 'comparison', 'map'] as const satisfies readonly GraphicKind[];
export type ReferenceRendererGraphicKind = (typeof REFERENCE_RENDERER_GRAPHIC_KINDS)[number];

export interface RendererCapabilities {
  graphicKinds: ReadonlySet<GraphicKind>;
}

export const REFERENCE_RENDERER_CAPABILITIES: RendererCapabilities = { graphicKinds: new Set(REFERENCE_RENDERER_GRAPHIC_KINDS) };

export interface SkillFilter {
  category?: SkillCategory;
  shotType?: ShotType;
  intensity?: Intensity;
  query?: string;
}

export interface SkillResolution {
  skill?: SkillDefinition;
  /** Ids tried, in order. */
  tried: string[];
  /** Why the requested skill was not used, when a fallback (or nothing) was chosen. */
  reason?: string;
}

export class MotionSkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  /**
   * @param fallbacks Fallback table for skill ids that may NOT be installed
   *   (e.g. an AI asks for "glitch_reveal" on a renderer without it). Installed
   *   skills use their own `fallback` list.
   */
  constructor(
    definitions: readonly SkillDefinition[] = [],
    private readonly capabilities: RendererCapabilities = REFERENCE_RENDERER_CAPABILITIES,
    private readonly fallbacks: Readonly<Record<string, readonly string[]>> = {},
  ) {
    for (const d of definitions) this.register(d);
  }

  register(definition: SkillDefinition): this {
    if (!/^[a-z][a-z0-9_]*$/.test(definition.id)) throw new Error(`Skill id "${definition.id}" must be snake_case`);
    this.skills.set(definition.id, definition);
    return this;
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  /** Installed AND renderable with the current renderer capabilities. */
  isAvailable(id: string): boolean {
    const s = this.skills.get(id);
    if (!s) return false;
    return (s.requires?.graphicKinds ?? []).every((k) => this.capabilities.graphicKinds.has(k));
  }

  /** Serializable metadata of the available skills — what an AI agent receives. */
  getAvailableMotionSkills(filter: SkillFilter = {}): MotionSkill[] {
    const q = filter.query?.toLowerCase();
    return [...this.skills.values()]
      .filter((s) => this.isAvailable(s.id))
      .filter((s) => !filter.category || s.category === filter.category)
      .filter((s) => !filter.shotType || s.compatibleShotTypes.includes(filter.shotType))
      .filter((s) => !filter.intensity || s.intensity === filter.intensity)
      .filter((s) => !q || `${s.id} ${s.name} ${s.description}`.toLowerCase().includes(q))
      .map(toMetadata);
  }

  availableIds(): Set<string> {
    return new Set([...this.skills.keys()].filter((id) => this.isAvailable(id)));
  }

  /** Validated parameters (defaults + overrides). Throws `PresetError` on invalid values. */
  resolveParams(id: string, overrides: PresetParams = {}): PresetParams {
    const s = this.skills.get(id);
    if (!s) throw new Error(`Unknown skill "${id}"`);
    return resolveParameterValues(id, s.parameters, overrides);
  }

  /** First usable skill for a shot, following fallbacks. */
  resolve(id: string, target: ComposedShot): SkillResolution {
    const tried: string[] = [];
    const visited = new Set<string>();
    let reason: string | undefined;
    const visit = (candidate: string): SkillDefinition | undefined => {
      if (visited.has(candidate)) return undefined;
      visited.add(candidate);
      tried.push(candidate);
      const s = this.skills.get(candidate);
      const why = !s
        ? `"${candidate}" is not installed`
        : !this.isAvailable(candidate)
          ? `"${candidate}" needs a renderer feature that is not available`
          : !s.compatibleShotTypes.includes(target.shot.type)
            ? `"${candidate}" does not apply to ${target.shot.type} shots`
            : s.canApply && !s.canApply(target)
              ? `"${candidate}" has nothing to animate in this shot`
              : undefined;
      if (!why) return s;
      reason ??= why;
      for (const next of s?.fallback ?? this.fallbacks[candidate] ?? []) {
        const found = visit(next);
        if (found) return found;
      }
      return undefined;
    };
    const skill = visit(id);
    return { ...(skill ? { skill } : {}), tried, ...(skill?.id !== id && reason ? { reason } : {}) };
  }

  /** Adapter for `compileShotPlan({ applySkill })`. */
  toResolver(): ShotSkillResolver {
    return (target, ctx) => {
      const requested = target.shot.motionSkill!;
      const { skill, reason } = this.resolve(requested, target);
      if (!skill) return { note: `${reason ?? `"${requested}" unavailable`}; no fallback applies, shot left without motion` };
      const notes: string[] = [];
      if (skill.id !== requested) notes.push(`${reason}; fell back to "${skill.id}"`);
      // Parameters were written for the requested skill; a fallback uses its own defaults.
      let params: PresetParams;
      try {
        params = this.resolveParams(skill.id, skill.id === requested ? (target.shot.motionParams ?? {}) : {});
      } catch (e) {
        notes.push(`invalid motionParams (${(e as Error).message}); defaults used`);
        params = this.resolveParams(skill.id);
      }
      const intensity = target.shot.intensity ?? skill.intensity;
      const result = skill.apply(target, { ...ctx, intensity, params, durationInFrames: target.shot.durationInFrames }) ?? {};
      return { applied: skill.id, ...(notes.length ? { note: notes.join('; ') } : {}), ...(result.events?.length ? { events: result.events } : {}) };
    };
  }
}

function toMetadata(s: SkillDefinition): MotionSkill {
  const { apply: _apply, canApply: _canApply, ...meta } = s;
  return JSON.parse(JSON.stringify(meta)) as MotionSkill;
}
