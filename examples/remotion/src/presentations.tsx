/**
 * Maps plan transition items to Remotion presentations.
 * - `builtin`: Remotion's own presentations (never re-implemented).
 * - `custom`: one generic presentation that renders the engine's deterministic
 *   `evaluateAtProgress()` state. Remotion has already eased the progress.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { linearTiming, springTiming, type TransitionPresentation, type TransitionPresentationComponentProps, type TransitionTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide, type SlideDirection } from '@remotion/transitions/slide';
import { wipe, type WipeDirection } from '@remotion/transitions/wipe';
import { flip, type FlipDirection } from '@remotion/transitions/flip';
import { iris } from '@remotion/transitions/iris';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { zoomBlur } from '@remotion/transitions/zoom-blur';
import { filmBurn } from '@remotion/transitions/film-burn';
import { ripple } from '@remotion/transitions/ripple';
import { zoomInOut } from '@remotion/transitions/zoom-in-out';
import {
  defaultTransitionRegistry,
  getEasingFunction,
  stateToStyle,
  type RemotionTransitionItem,
  type RemotionTimingSpec,
  type Transition,
} from '@studio-engine/scene-engine';

type EngineProps = { transition: Transition; width: number; height: number };

const EnginePresentation: React.FC<TransitionPresentationComponentProps<EngineProps>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const { transition, width, height } = passedProps;
  const state = defaultTransitionRegistry.evaluateAtProgress(transition, presentationProgress, { box: { width, height } });
  const side = presentationDirection === 'entering' ? state.entering : state.exiting;
  const onTop = (state.top ?? 'entering') === presentationDirection;
  return (
    <AbsoluteFill style={{ zIndex: onTop ? 1 : 0 }}>
      <AbsoluteFill style={stateToStyle(side) as React.CSSProperties}>{children}</AbsoluteFill>
      {presentationDirection === 'entering' && state.overlay && state.overlay.opacity > 0 ? (
        <AbsoluteFill style={{ backgroundColor: state.overlay.color, opacity: state.overlay.opacity, mixBlendMode: state.overlay.blendMode ?? 'normal', pointerEvents: 'none' }} />
      ) : null}
    </AbsoluteFill>
  );
};

export function toPresentation(item: RemotionTransitionItem, width: number, height: number): TransitionPresentation<Record<string, unknown>> {
  const p = item.presentation;
  const props = p.props as Record<string, unknown>;
  if (p.kind === 'custom') {
    return { component: EnginePresentation, props: { transition: item.transition, width, height } } as unknown as TransitionPresentation<Record<string, unknown>>;
  }
  const cast = (x: unknown) => x as TransitionPresentation<Record<string, unknown>>;
  switch (p.name) {
    case 'fade':
      return cast(fade());
    case 'slide':
      return cast(slide({ direction: props.direction as SlideDirection }));
    case 'wipe':
      return cast(wipe({ direction: props.direction as WipeDirection }));
    case 'flip':
      return cast(flip({ direction: props.direction as FlipDirection }));
    case 'iris':
      return cast(iris({ width, height }));
    case 'clockWipe':
      return cast(clockWipe({ width, height }));
    case 'zoomBlur':
      return cast(zoomBlur(props as { rotation?: number }));
    case 'filmBurn':
      return cast(filmBurn(props as { seed?: number }));
    case 'ripple':
      return cast(ripple(props as { amplitude?: number; speed?: number }));
    case 'zoomInOut':
      return cast(zoomInOut({}));
  }
}

export function toTiming(spec: RemotionTimingSpec): TransitionTiming {
  if (spec.kind === 'spring') return springTiming({ durationInFrames: spec.durationInFrames, config: spec.config });
  return linearTiming({ durationInFrames: spec.durationInFrames, ...(spec.easing ? { easing: getEasingFunction(spec.easing) } : {}) });
}
