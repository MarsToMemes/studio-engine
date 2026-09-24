import { useEffect, useRef, useState } from 'react';
import { loadPeaks, peakBetween, type Peaks } from '../../audio/peaks';

type Props = {
  url: string;
  fps: number;
  pxPerFrame: number;
  scrollLeft: number;
  width: number;
  height: number;
  /** Audio frame 0 is at this timeline frame. */
  fromFrame?: number;
  /** Timeline frame where the audio stops (trimmed to the episode). */
  toFrame?: number;
  loop?: boolean;
  color: string;
  /** Linear gain at an absolute frame (undefined outside the clip): drawn as a dB envelope. */
  gainAt?: (frame: number) => number | undefined;
  testId?: string;
  /** Small caption pinned to the visible area. */
  label?: string;
};

const DB_FLOOR = -48;
const toDb = (g: number) => (g <= 0 ? DB_FLOOR : Math.max(DB_FLOOR, 20 * Math.log10(g)));

/**
 * Waveform drawn only for the visible window (the canvas is viewport-sized and
 * sticky), so a long episode costs the same as a short one.
 */
export function WaveTrack({ url, fps, pxPerFrame, scrollLeft, width, height, fromFrame = 0, toFrame = Infinity, loop = false, color, gainAt, testId, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Peaks>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    setError(undefined);
    loadPeaks(url).then(
      (p) => alive && setPeaks(p),
      (e: unknown) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!peaks) return;
    const mid = height / 2;
    // Display-normalised: the shape matters here, the level is the envelope line.
    let max = 0;
    for (const v of peaks.data) if (v > max) max = v;
    const norm = max > 0 ? 1 / max : 1;
    ctx.fillStyle = color;
    for (let x = 0; x < width; x++) {
      const abs = (scrollLeft + x) / pxPerFrame;
      if (abs >= toFrame) break;
      const f0 = abs - fromFrame;
      const f1 = f0 + 1 / pxPerFrame;
      if (f1 <= 0) continue;
      const peak = Math.min(1, norm * peakBetween(peaks, Math.max(0, f0) / fps, f1 / fps, loop));
      const h = Math.max(peak > 0 ? 1 : 0, peak * (height - 6));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
    if (gainAt) {
      ctx.strokeStyle = '#ffc72c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let drawing = false;
      for (let x = 0; x < width; x += 2) {
        const g = gainAt((scrollLeft + x) / pxPerFrame);
        if (g === undefined) {
          drawing = false;
          continue;
        }
        const y = 3 + (1 - (toDb(g) - DB_FLOOR) / -DB_FLOOR) * (height - 6);
        if (drawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        drawing = true;
      }
      ctx.stroke();
    }
  }, [peaks, width, height, scrollLeft, pxPerFrame, fps, fromFrame, toFrame, loop, color, gainAt]);

  return (
    <div className="wave" style={{ width, height }} data-testid={testId} data-loaded={peaks ? 'true' : 'false'}>
      <canvas ref={canvasRef} style={{ width, height }} />
      {error ? <span className="wave-error" title={error}>audio unavailable</span> : null}
      {label ? <span className="wave-label">{label}</span> : null}
    </div>
  );
}
