import type { LoudnessMeasure, LoudnessVerdict, ShotPlan, VideoProject } from '@studio-engine/scene-engine';

export type RenderEngineId = 'remotion' | 'ffmpeg';

export interface RenderRequest {
  plan: ShotPlan;
  /** Compiled project, if the caller already has it (else the plan is compiled). */
  project?: VideoProject;
  output: string;
  /** Folder of relative asset sources (Remotion's public folder). */
  publicDir: string;
  /** Cache folder (chunks, decoded audio, mixes). Default `.studio-cache`. */
  cacheDir?: string;
  /** 1 = full resolution (default); 0.5 = 540p preview. */
  scale?: number;
  /** Normalise the mix to -14 LUFS (default true). */
  master?: boolean;
  onProgress?: (event: RenderEvent) => void;
}

export type RenderEvent =
  | { phase: 'prepare' | 'mix' | 'concat' | 'master'; message: string }
  | { phase: 'chunk'; index: number; total: number; cached: boolean; frames: number; ms: number };

export interface RenderResult {
  engine: RenderEngineId;
  output: string;
  /** A draft (FFmpeg): not for publishing. */
  draft: boolean;
  durationInFrames: number;
  chunks?: { total: number; rendered: number; cached: number };
  audio: { strategy: 'mixer' | 'remotion'; cached: boolean };
  loudness?: { before: LoudnessMeasure; after: LoudnessMeasure; verdict: LoudnessVerdict };
  timingsMs: Record<string, number>;
  notes: string[];
}

export interface RenderEngine {
  readonly id: RenderEngineId;
  /** Whether this engine can run here, and why not. */
  check(): { ok: boolean; reason?: string };
  render(request: RenderRequest): Promise<RenderResult>;
}
