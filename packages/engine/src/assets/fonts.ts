/**
 * Fonts a project asks for (bible TECH-04: no fallback font in a final
 * render). A `fontFamily` stack names its font first; the rest is a fallback
 * that must never be what the viewer sees.
 */
import type { VideoProject } from '../model/scene.js';

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'emoji', 'math', 'fangsong']);

/** First family of a CSS `font-family` stack, unquoted; undefined for a generic family. */
export function primaryFontFamily(stack: string): string | undefined {
  const first = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return first && !GENERIC.has(first.toLowerCase()) ? first : undefined;
}

/** Primary families of every `fontFamily` in the project (text, captions, graphics data), sorted. */
export function usedFontFamilies(project: Pick<VideoProject, 'scenes'>): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (k === 'fontFamily' && typeof x === 'string') {
          const f = primaryFontFamily(x);
          if (f) found.add(f);
        } else walk(x);
      }
  };
  walk(project.scenes);
  return [...found].sort();
}
