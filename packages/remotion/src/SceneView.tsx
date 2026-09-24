import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { sampleScene, type AssetRegistry, type CompiledScene, type ResolvedRenderOptions } from '@studio-engine/scene-engine';
import { BackgroundView, LayerView } from './layers';

/**
 * Renders one scene. `useCurrentFrame()` inside a <TransitionSeries.Sequence>
 * is already relative to the scene start, which is exactly `sceneFrame`.
 */
export const SceneView: React.FC<{ scene: CompiledScene; options: ResolvedRenderOptions; assets: AssetRegistry }> = ({ scene, options, assets }) => {
  const sceneFrame = useCurrentFrame();
  const frame = sampleScene(scene, sceneFrame, options);
  const edge = frame.edgeTransition;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={(edge?.style ?? {}) as React.CSSProperties}>
        <BackgroundView background={scene.scene.background} assets={assets} />
        <AbsoluteFill style={frame.cameraStyle as React.CSSProperties}>
          {frame.layers.map((l) => (
            <LayerView key={l.compiled.layer.id} frame={l} scene={scene} sceneFrame={sceneFrame} options={options} assets={assets} />
          ))}
        </AbsoluteFill>
      </AbsoluteFill>
      {edge?.state.overlay && edge.state.overlay.opacity > 0 ? <AbsoluteFill style={{ backgroundColor: edge.state.overlay.color, opacity: edge.state.overlay.opacity }} /> : null}
    </AbsoluteFill>
  );
};
