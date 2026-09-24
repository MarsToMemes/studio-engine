import type { AssetId } from './assets.js';
import type { Color, Fit, Gradient } from './primitives.js';
import type { MediaTrim } from './layer.js';

export type Background =
  | { type: 'none' }
  | { type: 'color'; color: Color }
  | { type: 'gradient'; gradient: Gradient }
  | { type: 'image'; assetId: AssetId; fit?: Fit; blur?: number; dim?: number }
  | { type: 'video'; assetId: AssetId; fit?: Fit; blur?: number; dim?: number; trim?: MediaTrim; playbackRate?: number; loop?: boolean };
