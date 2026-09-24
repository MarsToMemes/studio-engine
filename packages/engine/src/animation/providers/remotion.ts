/**
 * Remotion-backed provider.
 *
 * The engine never imports `remotion`. The Remotion project injects the few
 * primitives it wants the engine to use, so springs are computed by exactly
 * the same code as the rest of the Remotion composition. Everything else is
 * delegated to the native provider, whose `interpolate` and easing contracts
 * already match Remotion's.
 *
 *   import { spring } from 'remotion';
 *   registry.register(createRemotionAnimationProvider({ spring }), { default: true });
 */
import type { Animation } from '../../model/animation.js';
import { evaluateNative, nativeAnimationProvider, propertyDelta } from './native.js';
import type { AnimationEvaluationContext, AnimationProvider } from './types.js';

export interface RemotionSpringOptions {
  frame: number;
  fps: number;
  config?: Partial<{ mass: number; stiffness: number; damping: number; overshootClamping: boolean }>;
  durationInFrames?: number;
  from?: number;
  to?: number;
}

/** Structural subset of the `remotion` package used by the provider. */
export interface RemotionPrimitives {
  spring: (options: RemotionSpringOptions) => number;
}

export function createRemotionAnimationProvider(primitives: RemotionPrimitives): AnimationProvider {
  return {
    id: 'remotion',
    deterministic: true,
    description: 'Final render inside Remotion. Uses Remotion spring(); delegates the rest to the native provider.',
    supports: nativeAnimationProvider.supports,
    evaluate(animation: Animation, ctx: AnimationEvaluationContext) {
      if (animation.type === 'spring' && !animation.repeat && !animation.loop && !animation.yoyo) {
        const config: RemotionSpringOptions['config'] = {};
        if (animation.mass !== undefined) config.mass = animation.mass;
        if (animation.stiffness !== undefined) config.stiffness = animation.stiffness;
        if (animation.damping !== undefined) config.damping = animation.damping;
        if (animation.overshootClamping !== undefined) config.overshootClamping = animation.overshootClamping;
        const value = primitives.spring({
          frame: Math.max(0, ctx.frame - ctx.window.startFrame),
          fps: ctx.fps,
          config,
          from: animation.from,
          to: animation.to,
          ...(animation.durationInFrames !== undefined ? { durationInFrames: animation.durationInFrames } : {}),
        });
        return propertyDelta(animation.property, value);
      }
      return evaluateNative(animation, ctx);
    },
  };
}
