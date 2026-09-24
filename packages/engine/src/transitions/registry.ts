import { getEasingFunction } from '../animation/easing.js';
import type { Frames } from '../model/primitives.js';
import type { Transition } from '../model/transition.js';
import { secondsToFrames } from '../timing/frames.js';
import { BUILT_IN_TRANSITIONS } from './definitions.js';
import type {
  NormalizedTransition,
  RemotionCapabilities,
  RemotionPresentationSpec,
  RemotionTimingSpec,
  TransitionDefinition,
  TransitionEvaluationContext,
  TransitionFrameState,
} from './types.js';

export class TransitionRegistry {
  private readonly defs = new Map<string, TransitionDefinition>();

  constructor(definitions: readonly TransitionDefinition[] = BUILT_IN_TRANSITIONS) {
    for (const d of definitions) this.defs.set(d.type, d);
  }

  register(definition: TransitionDefinition): this {
    this.defs.set(definition.type, definition);
    return this;
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  get(type: string): TransitionDefinition {
    const d = this.defs.get(type);
    if (!d) throw new Error(`Unknown transition type "${type}"`);
    return d;
  }

  list(): TransitionDefinition[] {
    return [...this.defs.values()];
  }

  /** Build a transition from a type with every default applied. */
  create(type: string, fps: number, overrides: Partial<Omit<Transition, 'type'>> = {}): Transition {
    const d = this.get(type);
    const t: Transition = {
      type,
      durationInFrames: overrides.durationInFrames ?? secondsToFrames(d.defaultDurationInSeconds, fps),
      easing: overrides.easing ?? d.defaultEasing,
      intensity: overrides.intensity ?? d.defaultIntensity,
    };
    const direction = overrides.direction ?? d.defaultDirection;
    if (direction) t.direction = direction;
    const params = { ...(d.defaultParams ?? {}), ...(overrides.params ?? {}) };
    if (Object.keys(params).length > 0) t.params = params;
    if (overrides.id) t.id = overrides.id;
    if (overrides.presetId) t.presetId = overrides.presetId;
    return t;
  }

  normalize(transition: Transition): NormalizedTransition {
    const d = this.get(transition.type);
    const n: NormalizedTransition = {
      ...transition,
      durationInFrames: transition.type === 'cut' ? 0 : transition.durationInFrames,
      easing: transition.easing ?? d.defaultEasing,
      intensity: transition.intensity ?? d.defaultIntensity,
      params: { ...(d.defaultParams ?? {}), ...(transition.params ?? {}) },
    };
    const direction = transition.direction ?? d.defaultDirection;
    if (direction) n.direction = direction;
    return n;
  }

  /**
   * State of both scenes at `frame` frames into the transition.
   * Progress is eased with the transition easing.
   */
  evaluate(transition: Transition, frame: Frames, ctx: TransitionEvaluationContext): TransitionFrameState {
    const n = this.normalize(transition);
    const d = this.get(n.type);
    const raw = n.durationInFrames <= 0 ? 1 : Math.min(1, Math.max(0, frame / n.durationInFrames));
    return d.evaluate(n, getEasingFunction(n.easing)(raw), ctx);
  }

  /**
   * State at an already-eased progress in [0, 1]. Use this when the host
   * applies the timing itself (Remotion passes an eased `presentationProgress`).
   */
  evaluateAtProgress(transition: Transition, progress: number, ctx: TransitionEvaluationContext): TransitionFrameState {
    const n = this.normalize(transition);
    return this.get(n.type).evaluate(n, Math.min(1, Math.max(0, progress)), ctx);
  }

  /**
   * Remotion `<TransitionSeries.Transition>` description, or `undefined` for a cut.
   * Shader presentations are only chosen when `capabilities.htmlInCanvas` is true.
   */
  toRemotion(
    transition: Transition,
    ctx: TransitionEvaluationContext & { capabilities?: Partial<RemotionCapabilities> },
  ): { presentation: RemotionPresentationSpec; timing: RemotionTimingSpec } | undefined {
    const n = this.normalize(transition);
    const d = this.get(n.type);
    const mapping = { box: ctx.box, capabilities: { htmlInCanvas: ctx.capabilities?.htmlInCanvas ?? false } };
    if (!d.toRemotion || n.durationInFrames <= 0) return undefined;
    const timing: RemotionTimingSpec =
      typeof n.easing === 'object' && n.easing.type === 'spring'
        ? {
            kind: 'spring',
            durationInFrames: n.durationInFrames,
            config: {
              ...(n.easing.mass !== undefined ? { mass: n.easing.mass } : {}),
              ...(n.easing.stiffness !== undefined ? { stiffness: n.easing.stiffness } : {}),
              ...(n.easing.damping !== undefined ? { damping: n.easing.damping } : {}),
            },
          }
        : { kind: 'linear', durationInFrames: n.durationInFrames, easing: n.easing };
    return { presentation: d.toRemotion(n, mapping), timing };
  }
}

export const defaultTransitionRegistry = new TransitionRegistry();
