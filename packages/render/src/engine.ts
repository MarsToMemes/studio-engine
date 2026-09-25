/**
 * Choosing the renderer. Remotion renders the episode; if it cannot run or
 * fails, and fallback is allowed, the FFmpeg draft renders a rough version
 * and the result says it is a draft (never silently).
 */
import { FfmpegRenderer, type FfmpegRendererOptions } from './ffmpeg-renderer.js';
import { RemotionRenderer, type RemotionRendererOptions } from './remotion-renderer.js';
import type { RenderEngineId, RenderRequest, RenderResult } from './types.js';

export interface RenderEpisodeOptions extends RemotionRendererOptions, FfmpegRendererOptions {
  engine?: RenderEngineId;
  /** When Remotion fails, render the FFmpeg draft instead of failing. Default false. */
  fallback?: boolean;
}

export async function renderEpisode(request: RenderRequest, options: RenderEpisodeOptions = {}): Promise<RenderResult> {
  if (options.engine === 'ffmpeg') return new FfmpegRenderer(options).render(request);
  const remotion = new RemotionRenderer(options);
  const check = remotion.check();
  try {
    if (!check.ok) throw new Error(check.reason);
    return await remotion.render(request);
  } catch (e) {
    if (!options.fallback) throw e;
    const reason = (e as Error).message.split('\n')[0];
    const draft = await new FfmpegRenderer(options).render(request);
    return { ...draft, notes: [`Remotion failed (${reason}): FFmpeg draft rendered instead.`, ...draft.notes] };
  }
}
