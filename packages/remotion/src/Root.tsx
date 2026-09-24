import React from 'react';
import { Composition } from 'remotion';
import { buildRemotionPlan } from '@studio-engine/scene-engine';
import { EngineComposition } from './EngineComposition';
import { buildDemoProject } from './demoProject';
import { buildShotPlanDemoProject } from './shotPlanDemo';
import { buildBrainDemoProject } from './brainDemo';

const project = buildDemoProject();
const { composition } = buildRemotionPlan(project);
const shotPlanProject = buildShotPlanDemoProject();
const shotPlanComposition = buildRemotionPlan(shotPlanProject).composition;
const brainProject = buildBrainDemoProject();
const brainComposition = buildRemotionPlan(brainProject).composition;

export const RemotionRoot: React.FC = () => (
  <>
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
  <Composition
    id="ShotPlanDemo"
    component={EngineComposition}
    width={shotPlanComposition.width}
    height={shotPlanComposition.height}
    fps={shotPlanComposition.fps}
    durationInFrames={shotPlanComposition.durationInFrames}
    defaultProps={{ project: shotPlanProject }}
  />
  <Composition
    id="BrainDemo"
    component={EngineComposition}
    width={brainComposition.width}
    height={brainComposition.height}
    fps={brainComposition.fps}
    durationInFrames={brainComposition.durationInFrames}
    defaultProps={{ project: brainProject }}
  />
  </>
);
