import type { Color } from './primitives.js';

export interface TextStyle {
  fontFamily?: string;
  /** Pixels at the project resolution. */
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  color?: Color;
  /** Gradient text; wins over `color` when set. */
  gradient?: { angle?: number; colors: Color[] };
  stroke?: { color: Color; width: number };
  shadow?: { x: number; y: number; blur: number; color: Color };
  background?: { color: Color; paddingX?: number; paddingY?: number; radius?: number };
  /** Highlight used for emphasized words / active caption words. */
  highlight?: { color?: Color; background?: Color; scale?: number };
}

export interface CaptionStyle {
  text: TextStyle;
  /** Style of the currently spoken word. */
  activeWord?: TextStyle;
  /** `word`: one word at a time, `line`: current line, `block`: full cue. */
  mode: 'word' | 'line' | 'block';
  maxWordsPerLine?: number;
  maxLines?: number;
}
