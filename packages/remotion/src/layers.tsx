/**
 * Layer components. Each one only turns engine data into DOM; every position,
 * timing and animation value comes from the engine (`LayerFrame.style`).
 */
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, Img, OffthreadVideo, Sequence } from 'remotion';
import { Lottie, type LottieAnimationData } from '@remotion/lottie';
import {
  decorationProgress,
  getActiveCaption,
  getCaptionLine,
  getMediaPlayback,
  sampleLayerUnits,
  splitText,
  stateToStyle,
  textStyleToCss,
  visibleText,
  type AssetRegistry,
  type Background,
  type CaptionTrack,
  type CompiledScene,
  type LayerFrame,
  type ResolvedRenderOptions,
  type TextDecoration,
} from '@studio-engine/scene-engine';
import { assetSrc, resolveSrc } from './assets';
import { GRAPHIC_COMPONENTS, type GraphicProps } from './graphics';

type CSS = React.CSSProperties;

/**
 * Video that degrades gracefully: if the browser cannot decode the file (e.g.
 * H.264 in an open-source Chromium) the preview shows a placeholder instead of
 * failing. Quality control reports such media before the final render.
 */
const SafeVideo: React.FC<{ src: string; assetId: string; style: CSS } & Omit<React.ComponentProps<typeof OffthreadVideo>, 'src' | 'style' | 'onError'>> = ({ src, assetId, style, ...props }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={{ ...style, background: 'repeating-linear-gradient(45deg,#1b1b1b 0 24px,#232323 24px 48px)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9a9a9a', fontFamily: 'Arial', fontSize: 36 }}>
        Media unavailable: {assetId}
      </div>
    );
  }
  return (
    <OffthreadVideo
      {...props}
      src={src}
      style={style}
      onError={(e) => {
        console.warn(`[studio-engine] cannot play "${assetId}": ${e.message}`);
        setFailed(true);
      }}
    />
  );
};
const css = (s: Record<string, string | number>) => s as CSS;

export const BackgroundView: React.FC<{ background: Background; assets: AssetRegistry }> = ({ background, assets }) => {
  switch (background.type) {
    case 'none':
      return null;
    case 'color':
      return <AbsoluteFill style={{ backgroundColor: background.color }} />;
    case 'gradient': {
      const g = background.gradient;
      const stops = g.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ');
      const image = g.kind === 'radial' ? `radial-gradient(${stops})` : g.kind === 'conic' ? `conic-gradient(from ${g.angle ?? 0}deg, ${stops})` : `linear-gradient(${g.angle ?? 180}deg, ${stops})`;
      return <AbsoluteFill style={{ backgroundImage: image }} />;
    }
    case 'image':
    case 'video': {
      const src = assetSrc(assets[background.assetId]);
      if (!src) return null;
      const style: CSS = { width: '100%', height: '100%', objectFit: background.fit ?? 'cover', filter: background.blur ? `blur(${background.blur}px)` : undefined };
      return (
        <AbsoluteFill>
          {background.type === 'image' ? <Img src={src} style={style} /> : <SafeVideo src={src} assetId={background.assetId} muted style={style} trimBefore={background.trim?.startFrom} trimAfter={background.trim?.endAt} />}
          {background.dim ? <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${background.dim})` }} /> : null}
        </AbsoluteFill>
      );
    }
  }
};

/** Text box CSS split in two: the box (font, alignment) and the plate hugging the text (background). */
function splitTextCss(style: Parameters<typeof textStyleToCss>[0]): { box: CSS; plate: CSS } {
  const { backgroundColor, padding, borderRadius, boxDecorationBreak, WebkitBoxDecorationBreak, ...box } = css(textStyleToCss(style)) as Record<string, string | number>;
  const plate: Record<string, string | number | undefined> = { backgroundColor, padding, borderRadius, boxDecorationBreak, WebkitBoxDecorationBreak };
  return { box: box as CSS, plate: Object.fromEntries(Object.entries(plate).filter(([, v]) => v !== undefined)) as CSS };
}

/** Underline or highlighter marker drawn behind one word, growing from the left. */
const Decoration: React.FC<{ decoration: TextDecoration; progress: number }> = ({ decoration, progress }) => {
  if (progress <= 0) return null;
  const common: CSS = { position: 'absolute', left: 0, width: `${progress * 100}%`, background: decoration.color ?? '#FFC72C', pointerEvents: 'none' };
  return decoration.kind === 'underline'
    ? <span style={{ ...common, bottom: '-0.06em', height: decoration.thickness ?? 8, borderRadius: 4 }} />
    : <span style={{ ...common, top: '6%', left: '-0.08em', width: `calc(${progress * 100}% + 0.16em)`, height: '88%', zIndex: -1, borderRadius: 4, transform: 'skewX(-6deg)' }} />;
};

const TextView: React.FC<{ frame: LayerFrame; scene: CompiledScene; sceneFrame: number; options: ResolvedRenderOptions }> = ({ frame, scene, sceneFrame, options }) => {
  const layer = frame.compiled.layer;
  if (layer.type !== 'text') return null;
  const { box, plate } = splitTextCss(layer.style);
  const base: CSS = { ...box, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: layer.style.textAlign === 'left' ? 'flex-start' : 'center', alignContent: 'center' };
  const text = frame.state.textProgress !== undefined ? visibleText(layer.text, frame.state.textProgress) : layer.text;
  const split = frame.compiled.textSplit ?? 'words';
  // Emphasis and decorations refer to word indices.
  const byWord = split === 'words';
  const emphasis = new Set(byWord ? (layer.emphasis ?? []) : []);
  const decorations = byWord ? (layer.decorations ?? []) : [];
  const accent = layer.style.highlight?.color;
  if (!frame.compiled.hasUnitAnimations && emphasis.size === 0 && decorations.length === 0) return <div style={base}><span style={plate}>{text}</span></div>;
  const parts = splitText(text, split);
  const units = frame.compiled.hasUnitAnimations ? sampleLayerUnits(frame.compiled, sceneFrame, parts.length, scene, options) : [];
  return (
    <div style={base}>
      <span style={{ ...plate, display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'inherit' }}>
        {parts.map((part, i) => {
          const u = units[i];
          const core = part.trimEnd();
          const highlighted = emphasis.has(i) || (u?.highlight ?? 0) > 0.5;
          const decos = decorations.filter((d) => d.words.includes(i));
          // A drawn decoration may recolor its word (dark text on a highlighter marker).
          const recolor = decos.find((d) => d.textColor && decorationProgress(d, frame.localFrame) > 0.5)?.textColor;
          const color = recolor ?? (highlighted ? accent : undefined);
          return (
            <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', ...(u ? (stateToStyle(u) as CSS) : {}), ...(color ? { color } : {}) }}>
              <span style={{ position: 'relative', display: 'inline-block', zIndex: 0 }}>
                {decos.map((d, k) => <Decoration key={k} decoration={d} progress={decorationProgress(d, frame.localFrame)} />)}
                {core}
              </span>
              {part.slice(core.length)}
            </span>
          );
        })}
      </span>
    </div>
  );
};

const CaptionView: React.FC<{ frame: LayerFrame; track: CaptionTrack | undefined; sceneFrame: number }> = ({ frame, track, sceneFrame }) => {
  const layer = frame.compiled.layer;
  if (layer.type !== 'caption' || !track) return null;
  const active = getActiveCaption(track, sceneFrame);
  if (!active) return null;
  const { style } = layer;
  const box: CSS = { ...css(textStyleToCss(style.text)), width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap', columnGap: '0.4em' };
  if (style.mode === 'block') return <div style={box}>{active.cue.text}</div>;
  const line = getCaptionLine(active, style.maxWordsPerLine ?? 6);
  return (
    <div style={box}>
      {line.words.map((w, i) => (
        <span key={i} style={i === line.activeIndex && style.activeWord ? { ...css(textStyleToCss(style.activeWord)), display: 'inline-block', transform: style.activeWord.highlight?.scale ? `scale(${style.activeWord.highlight.scale})` : undefined } : { display: 'inline-block' }}>
          {w}
        </span>
      ))}
    </div>
  );
};

const GraphicView: React.FC<{ frame: LayerFrame; fps: number }> = ({ frame, fps }) => {
  const layer = frame.compiled.layer;
  if (layer.type !== 'graphic') return null;
  const Component = (GRAPHIC_COMPONENTS as Record<string, React.FC<GraphicProps> | undefined>)[layer.kind];
  // Kinds without a component here are never produced by available skills.
  return Component ? <Component layer={layer} frame={frame.localFrame} fps={fps} width={frame.compiled.rect.width} height={frame.compiled.rect.height} /> : null;
};

function useLottieData(src: string | undefined): LottieAnimationData | null {
  const [data, setData] = useState<LottieAnimationData | null>(null);
  const [handle] = useState(() => (src ? delayRender(`Loading Lottie ${src}`) : null));
  useEffect(() => {
    if (!src || handle === null) return;
    fetch(src)
      .then((r) => r.json())
      .then((json: LottieAnimationData) => {
        setData(json);
        continueRender(handle);
      })
      .catch((e: unknown) => {
        console.error(e);
        continueRender(handle);
      });
  }, [src, handle]);
  return data;
}

const LottieView: React.FC<{ frame: LayerFrame; assets: AssetRegistry }> = ({ frame, assets }) => {
  const layer = frame.compiled.layer;
  const source = layer.type === 'lottie' ? layer.source : undefined;
  const src = source?.kind === 'asset' ? assetSrc(assets[source.assetId]) : source?.kind === 'url' ? resolveSrc(source.url) : undefined;
  const fetched = useLottieData(src);
  if (layer.type !== 'lottie') return null;
  const data = source?.kind === 'inline' ? (source.data as unknown as LottieAnimationData) : fetched;
  if (!data) return null;
  return <Lottie animationData={data} loop={layer.loop ?? false} playbackRate={layer.playbackRate ?? 1} direction={layer.direction === 'reverse' ? 'backward' : 'forward'} style={{ width: '100%', height: '100%' }} />;
};

const OverlayView: React.FC<{ frame: LayerFrame; assets: AssetRegistry }> = ({ frame, assets }) => {
  const layer = frame.compiled.layer;
  if (layer.type !== 'overlay') return null;
  const k = layer.intensity ?? 1;
  switch (layer.kind) {
    case 'color':
      return <AbsoluteFill style={{ backgroundColor: layer.color ?? '#000', opacity: k }} />;
    case 'gradient': {
      const g = layer.gradient;
      if (!g) return null;
      return <AbsoluteFill style={{ backgroundImage: `linear-gradient(${g.angle ?? 180}deg, ${g.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})` }} />;
    }
    case 'vignette':
      return <AbsoluteFill style={{ backgroundImage: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${0.85 * k}) 100%)` }} />;
    case 'letterbox':
      return (
        <AbsoluteFill>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${12 * k}%`, background: '#000' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${12 * k}%`, background: '#000' }} />
        </AbsoluteFill>
      );
    case 'grain':
      // Seeded by frame so grain is deterministic and changes every frame.
      return (
        <AbsoluteFill style={{ opacity: k }}>
          <svg width="100%" height="100%">
            <filter id={`g${frame.localFrame}`}>
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={frame.localFrame} />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter={`url(#g${frame.localFrame})`} />
          </svg>
        </AbsoluteFill>
      );
    default: {
      const src = layer.assetId ? assetSrc(assets[layer.assetId]) : undefined;
      return src ? <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: k }} /> : null;
    }
  }
};

export const LayerView: React.FC<{ frame: LayerFrame; scene: CompiledScene; sceneFrame: number; options: ResolvedRenderOptions; assets: AssetRegistry }> = (props) => {
  const { frame, assets } = props;
  const layer = frame.compiled.layer;
  let content: React.ReactNode = null;
  switch (layer.type) {
    case 'background':
      content = <BackgroundView background={layer.background} assets={assets} />;
      break;
    case 'image': {
      const src = assetSrc(assets[layer.assetId]);
      content = src ? <Img src={src} style={{ width: '100%', height: '100%', objectFit: layer.fit }} /> : null;
      break;
    }
    case 'video': {
      const src = assetSrc(assets[layer.assetId]);
      const m = getMediaPlayback(layer);
      // Inside the scene, a Sequence starting at the layer start makes the clip time = layer local frame.
      content = src ? (
        <Sequence from={frame.compiled.localStartFrame} layout="none">
          <SafeVideo src={src} assetId={layer.assetId} muted={m.muted} volume={m.volume} playbackRate={m.playbackRate} trimBefore={m.startFrom} trimAfter={m.endAt} style={{ width: '100%', height: '100%', objectFit: layer.fit }} />
        </Sequence>
      ) : null;
      break;
    }
    case 'text':
      content = <TextView {...props} />;
      break;
    case 'caption':
      content = <CaptionView frame={frame} track={props.scene.scene.captions} sceneFrame={props.sceneFrame} />;
      break;
    case 'shape':
      content = layer.shape === 'rect' || layer.shape === 'ellipse' ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: typeof layer.fill === 'string' ? layer.fill : undefined,
            border: layer.stroke ? `${layer.stroke.width}px solid ${layer.stroke.color}` : undefined,
            borderRadius: layer.shape === 'ellipse' ? '50%' : layer.cornerRadius,
            boxSizing: 'border-box',
          }}
        />
      ) : null;
      break;
    case 'graphic':
      content = <GraphicView frame={frame} fps={props.scene.fps} />;
      break;
    case 'lottie':
      content = <LottieView frame={frame} assets={assets} />;
      break;
    case 'overlay':
      content = <OverlayView frame={frame} assets={assets} />;
      break;
  }
  return <div style={css(frame.style)}>{content}</div>;
};
