import { useEffect, useMemo, type RefObject } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { EngineComposition } from '@studio-engine/remotion';
import { buildRemotionPlan, type VideoProject } from '@studio-engine/scene-engine';

type Props = {
  project: VideoProject;
  playerRef: RefObject<PlayerRef | null>;
  onFrame?: (frame: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Loop playback inside this absolute frame range (end exclusive). */
  range?: [number, number];
};

/**
 * The same composition as the final render, played in the browser: no export
 * needed to see a change. The Player scales the 1080p composition to fit
 * (letterboxed) inside the stage.
 */
export function PreviewPlayer({ project, playerRef, onFrame, onPlayingChange, range }: Props) {
  const { composition } = useMemo(() => buildRemotionPlan(project, { validate: false }), [project]);
  const inputProps = useMemo(() => ({ project }), [project]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !onFrame) return;
    const update = (e: { detail: { frame: number } }) => onFrame(e.detail.frame);
    player.addEventListener('frameupdate', update);
    player.addEventListener('seeked', update);
    return () => {
      player.removeEventListener('frameupdate', update);
      player.removeEventListener('seeked', update);
    };
  }, [playerRef, onFrame]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !onPlayingChange) return;
    const play = () => onPlayingChange(true);
    const pause = () => onPlayingChange(false);
    player.addEventListener('play', play);
    player.addEventListener('pause', pause);
    player.addEventListener('ended', pause);
    return () => {
      player.removeEventListener('play', play);
      player.removeEventListener('pause', pause);
      player.removeEventListener('ended', pause);
    };
  }, [playerRef, onPlayingChange]);

  return (
    <div className="player" data-testid="player">
      <Player
        ref={playerRef}
        component={EngineComposition}
        inputProps={inputProps}
        durationInFrames={composition.durationInFrames}
        compositionWidth={composition.width}
        compositionHeight={composition.height}
        fps={composition.fps}
        controls
        clickToPlay
        loop
        {...(range ? { inFrame: range[0], outFrame: Math.min(composition.durationInFrames, range[1]) - 1 } : {})}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
