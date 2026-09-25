/**
 * The fonts of the render, bundled (no network, no system font): Inter
 * (sans) and Source Serif 4 (quotes), both SIL Open Font License 1.1.
 * A final render never falls back silently (bible TECH-04): if a font the
 * project asks for is not available, the render stops with the font's name.
 */
import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, getRemotionEnvironment } from 'remotion';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/source-serif-4/500-italic.css';
import { usedFontFamilies, type VideoProject } from '@studio-engine/scene-engine';

/** Faces loaded before the first frame (latin and latin-ext glyphs of each weight used by the presets). */
const FACES = [
  ...[400, 500, 600, 700, 800, 900].map((w) => `${w} 40px Inter`),
  '400 40px "Source Serif 4"',
  '500 40px "Source Serif 4"',
  'italic 500 40px "Source Serif 4"',
];
const SAMPLE = 'AaÉéàçœ€0123456789«»“”';

/** True when the browser really draws `family` (not a fallback): its width differs from every generic font. */
function isFontAvailable(family: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return true;
  const probe = 'mmmmmmmmmmlli WWW 0123 Éé';
  return ['monospace', 'serif', 'sans-serif'].some((generic) => {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(probe).width;
    ctx.font = `72px "${family}", ${generic}`;
    return ctx.measureText(probe).width !== base;
  });
}

/** Loads the bundled faces, then checks every family the project uses. */
export function useFonts(project: Pick<VideoProject, 'scenes'>): void {
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    let done = false;
    Promise.all(FACES.map((f) => document.fonts.load(f, SAMPLE)))
      .then(() => {
        const missing = usedFontFamilies(project).filter((f) => !isFontAvailable(f));
        if (missing.length) {
          const message = `[TECH-04] font${missing.length > 1 ? 's' : ''} not available: ${missing.join(', ')}. Bundle ${missing.length > 1 ? 'them' : 'it'} (packages/remotion/src/fonts.ts) or change the style.`;
          if (getRemotionEnvironment().isRendering) cancelRender(new Error(message));
          else console.warn(message);
        }
      })
      .catch((e) => cancelRender(e))
      .finally(() => {
        if (!done) continueRender(handle);
        done = true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
