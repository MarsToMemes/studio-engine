import React, { useEffect, useMemo, useRef, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import { hyperframesPageUrl, hyperframesTimeAt } from '@studio-engine/scene-engine';
import type { GraphicProps } from './common';

/**
 * HyperFrames catalog item (graphic kind `hyperframes`), rendered from
 * public/hyperframes (scripts/hyperframes-sync.mjs).
 *
 * The page runs in a same-origin iframe with the HyperFrames runtime and our
 * bridge injected at the head, which expose window.__hf = { duration, seek }
 * — the protocol of the HyperFrames renderer. Each Remotion frame seeks the
 * item's paused timeline to its time and holds the frame (delayRender) until
 * the seek has painted, so frames are deterministic in any order.
 */
type HfWindow = Window & {
  __hf?: { duration?: number; seek?: (t: number) => void };
  __hfWaitForSeekCompletion?: () => Promise<void>;
};

const W = 1920;
const H = 1080;
const READY_TIMEOUT_MS = 60_000;

function hfWindow(iframe: HTMLIFrameElement | null): HfWindow | null {
  try {
    return (iframe?.contentWindow as HfWindow | null) ?? null;
  } catch {
    return null; // cross-origin: never the case for staticFile pages
  }
}

const nextPaint = (win: Window) => new Promise<void>((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));

export const HyperFrames: React.FC<GraphicProps> = ({ layer, frame, fps, width, height }) => {
  const data = layer.data;
  const src = useMemo(() => {
    const url = hyperframesPageUrl(data);
    const q = url.indexOf('?');
    return q < 0 ? staticFile(url) : `${staticFile(url.slice(0, q))}${url.slice(q)}`;
  }, [data]);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [readyHandle] = useState(() => delayRender(`HyperFrames ${String(data.item)}`, { timeoutInMilliseconds: READY_TIMEOUT_MS }));

  // Wait for the runtime (timelines built, fonts loaded).
  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    const poll = async () => {
      if (cancelled) return;
      const win = hfWindow(iframe.current);
      if (win?.__hf && typeof win.__hf.seek === 'function' && (win.__hf.duration ?? 0) > 0) {
        await win.document.fonts.ready;
        if (!cancelled) {
          setReady(true);
          continueRender(readyHandle);
        }
        return;
      }
      if (Date.now() - started > READY_TIMEOUT_MS - 1000) {
        console.error(`[hyperframes] ${String(data.item)} never became ready (${src})`);
        continueRender(readyHandle);
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [readyHandle, src, data.item]);

  const time = hyperframesTimeAt(data, frame, fps);
  useEffect(() => {
    if (!ready) return;
    const win = hfWindow(iframe.current);
    if (!win?.__hf?.seek) return;
    const handle = delayRender(`HyperFrames seek ${String(data.item)} @${time.toFixed(3)}s`);
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    (async () => {
      try {
        win.__hf!.seek!(time);
        await win.__hfWaitForSeekCompletion?.();
        await nextPaint(win);
      } catch (e) {
        console.error(e);
      }
      finish();
    })();
    return finish;
  }, [ready, time, data.item]);

  // The page is authored at 1920×1080; fit it into the layer box (contain, centred).
  const scale = Math.min(width / W, height / H);
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
      <iframe
        ref={iframe}
        src={src}
        title={String(data.item)}
        style={{
          position: 'absolute',
          left: (width - W * scale) / 2,
          top: (height - H * scale) / 2,
          width: W,
          height: H,
          border: 0,
          background: 'transparent',
          colorScheme: 'normal',
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
