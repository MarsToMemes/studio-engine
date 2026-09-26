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
export const REFERENCE_RENDERER_GRAPHIC_KINDS = ['counter', 'statCard', 'barChart', 'lineChart', 'pieChart', 'comparison', 'map', 'mapTiles', 'progress', 'timeline', 'hyperframes'] as const satisfies readonly GraphicKind[];
export type ReferenceRendererGraphicKind = (typeof REFERENCE_RENDERER_GRAPHIC_KINDS)[number];

/** Last resort before "no motion": one sober skill that animates any shot of the type. */
export const SAFE_FALLBACKS: Readonly<Record<ShotType, string>> = {
  text: 'word_reveal',
  revelation: 'word_reveal',
  chapter: 'word_reveal',
  number: 'number_count',
  chart: 'chart_reveal',
  map: 'map_zoom',
  document: 'document_zoom',
  image: 'slow_zoom',
  video: 'slow_zoom',
};

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
  /** The chain was exhausted and the shot type's safe fallback was used. */
  safe?: boolean;
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

  /** Metadata of an installed skill (check `isAvailable` for this renderer). */
  getMotionSkill(id: string): MotionSkill | undefined {
    const s = this.skills.get(id);
    return s ? toMetadata(s) : undefined;
  }

  /** Available skills that can animate this shot type. */
  getCompatibleSkills(shotType: ShotType, filter: Omit<SkillFilter, 'shotType'> = {}): MotionSkill[] {
    return this.getAvailableMotionSkills({ ...filter, shotType });
  }

  /**
   * First available fallback of a skill (its fallback chain, then the safe
   * fallback of the shot type). `undefined` = the static version (no motion).
   * Without a composed shot, applicability (`canApply`) is not checked:
   * `resolve()` does it at compile time.
   */
  getFallbackSkill(id: string, shotType?: ShotType): MotionSkill | undefined {
    const visited = new Set<string>([id]);
    const queue = [...(this.skills.get(id)?.fallback ?? this.fallbacks[id] ?? [])];
    while (queue.length) {
      const next = queue.shift()!;
      if (visited.has(next)) continue;
      visited.add(next);
      const s = this.skills.get(next);
      if (s && this.isAvailable(next) && (!shotType || s.compatibleShotTypes.includes(shotType))) return toMetadata(s);
      queue.push(...(s?.fallback ?? this.fallbacks[next] ?? []));
    }
    const safe = shotType ? SAFE_FALLBACKS[shotType] : undefined;
    return safe && safe !== id && this.isAvailable(safe) ? this.getMotionSkill(safe) : undefined;
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
    let skill = visit(id);
    let safe = false;
    // Chain exhausted: the safe fallback of the shot type, before the static version (brief §34).
    if (!skill) {
      const candidate = SAFE_FALLBACKS[target.shot.type];
      if (candidate && !visited.has(candidate)) skill = visit(candidate);
      safe = skill !== undefined;
    }
    return { ...(skill ? { skill } : {}), tried, ...(skill?.id !== id && reason ? { reason } : {}), ...(safe ? { safe } : {}) };
  }

  /** Adapter for `compileShotPlan({ applySkill })`. */
  toResolver(): ShotSkillResolver {
    return (target, ctx) => {
      const requested = target.shot.motionSkill!;
      const { skill, reason, safe } = this.resolve(requested, target);
      if (!skill) return { note: `${reason ?? `"${requested}" unavailable`}; no fallback applies, shot left without motion` };
      const notes: string[] = [];
      if (skill.id !== requested) notes.push(`${reason}; fell back to "${skill.id}"${safe ? ` (safe fallback of ${target.shot.type} shots)` : ''}`);
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
