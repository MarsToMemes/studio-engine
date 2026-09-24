import type { Animation } from '../../model/animation.js';
import { nativeAnimationProvider } from './native.js';
import type { AnimationProvider } from './types.js';

export type EvaluationMode = 'preview' | 'render';

export interface ProviderResolution {
  provider: AnimationProvider | undefined;
  /** True when the requested provider could not be used and another one was picked. */
  fallback: boolean;
  reason?: string;
}

export class AnimationProviderRegistry {
  private readonly providers = new Map<string, AnimationProvider>();
  private defaultId: string;

  constructor(providers: readonly AnimationProvider[] = [nativeAnimationProvider], defaultId = 'native') {
    for (const p of providers) this.providers.set(p.id, p);
    if (!this.providers.has(defaultId)) throw new Error(`Default provider "${defaultId}" is not registered`);
    this.defaultId = defaultId;
  }

  register(provider: AnimationProvider, options: { default?: boolean } = {}): this {
    this.providers.set(provider.id, provider);
    if (options.default) {
      if (!provider.deterministic) throw new Error(`Default provider must be deterministic ("${provider.id}" is not)`);
      this.defaultId = provider.id;
    }
    return this;
  }

  get(id: string): AnimationProvider | undefined {
    return this.providers.get(id);
  }

  get default(): AnimationProvider {
    return this.providers.get(this.defaultId)!;
  }

  list(): AnimationProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Pick the provider for an animation. In `render` mode only deterministic
   * providers are allowed; anything else falls back to the default provider.
   */
  resolve(animation: Animation, mode: EvaluationMode): ProviderResolution {
    const requestedId = animation.provider ?? this.defaultId;
    const requested = this.providers.get(requestedId);
    if (requested && requested.supports(animation) && (mode === 'preview' || requested.deterministic)) {
      return { provider: requested, fallback: false };
    }
    const reason = !requested
      ? `provider "${requestedId}" is not registered`
      : !requested.supports(animation)
        ? `provider "${requestedId}" does not support "${animation.type}"`
        : `provider "${requestedId}" is not deterministic and cannot be used for render`;
    const fallback = this.default;
    if (fallback.supports(animation)) return { provider: fallback, fallback: true, reason };
    return { provider: undefined, fallback: true, reason: `${reason}; no fallback supports "${animation.type}"` };
  }
}

export function createAnimationProviderRegistry(providers?: readonly AnimationProvider[], defaultId?: string): AnimationProviderRegistry {
  return new AnimationProviderRegistry(providers, defaultId);
}
