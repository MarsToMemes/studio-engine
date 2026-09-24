import React from 'react';
import { Composition } from 'remotion';
import { buildRemotionPlan } from '@studio-engine/scene-engine';
import { EngineComposition } from './EngineComposition';
import { buildDemoProject } from './demoProject';

const project = buildDemoProject();
const { composition } = buildRemotionPlan(project);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="EngineDemo"
    component={EngineComposition}
    width={composition.width}
    height={composition.height}
    fps={composition.fps}
    durationInFrames={composition.durationInFrames}
    defaultProps={{ project }}
    // Any project JSON can be rendered by passing it as input props; duration and size follow it.
    calculateMetadata={({ props }) => {
      const c = buildRemotionPlan(props.project).composition;
      return { durationInFrames: c.durationInFrames, width: c.width, height: c.height, fps: c.fps };
    }}
  />
);
