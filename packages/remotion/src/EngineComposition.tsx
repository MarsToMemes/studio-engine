import React, { useMemo } from 'react';
import { AbsoluteFill, Html5Audio, Sequence, spring } from 'remotion';
import { TransitionSeries } from '@remotion/transitions';
import {
  AnimationProviderRegistry,
  audioVolumeAt,
  buildRemotionPlan,
  compileProject,
  createRemotionAnimationProvider,
  nativeAnimationProvider,
  type VideoProject,
} from '@studio-engine/scene-engine';
import { resolveSrc } from './assets';
import { useFonts } from './fonts';
import { toPresentation, toTiming } from './presentations';
import { SceneView } from './SceneView';

export type EngineCompositionProps = { project: VideoProject };

/** Springs are computed by Remotion itself; everything else by the engine's native provider. */
const providers = new AnimationProviderRegistry([nativeAnimationProvider]).register(createRemotionAnimationProvider({ spring }), { default: true });

export const EngineComposition: React.FC<EngineCompositionProps> = ({ project }) => {
  useFonts(project);
  // Compile once per project, not per frame.
  const plan = useMemo(() => buildRemotionPlan(project), [project]);
  const compiled = useMemo(() => compileProject(project, { providers, mode: 'render' }), [project]);
  const { width, height } = plan.composition;
  const bg = project.background.type === 'color' ? project.background.color : '#000';

  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      <TransitionSeries>
        {plan.series.map((item) =>
          item.kind === 'sequence' ? (
            <TransitionSeries.Sequence key={`s-${item.sceneId}`} durationInFrames={item.durationInFrames}>
              <SceneView scene={compiled.scenes[item.sceneIndex]!} options={compiled.options} assets={project.assets} />
            </TransitionSeries.Sequence>
          ) : (
            <TransitionSeries.Transition key={`t-${item.fromSceneId}-${item.toSceneId}`} presentation={toPresentation(item, width, height)} timing={toTiming(item.timing)} />
          ),
        )}
      </TransitionSeries>
      {plan.audio.map((a) => (
        <Sequence key={a.id} from={a.from} durationInFrames={a.durationInFrames} layout="none">
          <Html5Audio src={resolveSrc(a.src)} trimBefore={a.startFrom} trimAfter={a.endAt} playbackRate={a.playbackRate} loop={a.loop} muted={a.muted} volume={(f) => audioVolumeAt(a, f)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
