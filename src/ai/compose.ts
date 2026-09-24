/**
 * Scene composers: blueprint intent → concrete layers, per scene type.
 * Register a composer to support a new scene type in AI generation; unknown
 * types fall back to the generic composer.
 */
import { createLayer } from '../core/factories.js';
import type { IdGenerator } from '../core/ids.js';
import type { AssetRegistry } from '../model/assets.js';
import type { Layer, LayerBox } from '../model/layer.js';
import type { Dimensions, JsonObject } from '../model/primitives.js';
import type { CaptionStyle, TextStyle } from '../model/text.js';
import type { PresetRegistry } from '../presets/registry.js';
import type { PresetCategory, PresetOutputs, Treatment } from '../presets/types.js';
import type { BlueprintDocument, BlueprintMedia, PresetChoice, SceneBlueprint } from './blueprint.js';

/** Layer stacking convention used by generated scenes. */
export const Z = { background: 0, media: 10, overlay: 20, graphic: 30, text: 40, inset: 50, captions: 60 } as const;

export interface ComposeContext {
  blueprint: SceneBlueprint;
  doc: BlueprintDocument;
  fps: number;
  canvas: Dimensions;
  /** Scene duration in frames (including the outgoing transition overlap). */
  durationInFrames: number;
  ids: IdGenerator;
  assets: AssetRegistry;
  presets: PresetRegistry;
  /** Caption style when captions are enabled for this scene and cues exist. */
  captionStyle?: CaptionStyle;
  captionTrackId?: string;
}

export type SceneComposer = (ctx: ComposeContext) => Layer[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Any layer-level preset (animation, text effect, treatment…), normalized to a Treatment. */
export function layerTreatment(ctx: ComposeContext, choice: PresetChoice, durationInFrames?: number): Treatment {
  const ref = typeof choice === 'string' ? { presetId: choice } : choice;
  return ctx.presets.applyToLayer({ ...ref, ...(ref.durationInFrames === undefined && durationInFrames !== undefined ? { durationInFrames } : {}) }, { fps: ctx.fps, canvas: ctx.canvas });
}

export function applyChoice<C extends PresetCategory>(ctx: ComposeContext, category: C, choice: PresetChoice, durationInFrames?: number): PresetOutputs[C] {
  const ref = typeof choice === 'string' ? { presetId: choice } : choice;
  return ctx.presets.apply(category, { ...ref, ...(ref.durationInFrames === undefined && durationInFrames !== undefined ? { durationInFrames } : {}) }, { fps: ctx.fps, canvas: ctx.canvas });
}

const box = (anchor: LayerBox['anchor'], x: number, y: number, width?: number, height?: number): LayerBox => ({
  anchor,
  x,
  y,
  units: 'percent',
  ...(width !== undefined ? { width } : {}),
  ...(height !== undefined ? { height } : {}),
});

export function textLayer(
  ctx: ComposeContext,
  text: string,
  options: { position: LayerBox; typography: PresetChoice; effect?: PresetChoice; zIndex?: number; name?: string; fontScale?: number; startFrame?: number },
): Layer {
  const style: TextStyle = applyChoice(ctx, 'typography', options.typography);
  if (options.fontScale && style.fontSize) style.fontSize = Math.round(style.fontSize * options.fontScale);
  const effect: Treatment = options.effect ? layerTreatment(ctx, options.effect) : { animations: [], effects: [] };
  return createLayer(
    'text',
    {
      name: options.name ?? 'Text',
      text,
      style: { ...style, ...(effect.style ?? {}) },
      zIndex: options.zIndex ?? Z.text,
      position: options.position,
      animations: effect.animations,
      effects: effect.effects,
      autoFit: true,
      ...(options.startFrame ? { startFrame: options.startFrame } : {}),
    },
    { ids: ctx.ids },
  );
}

function mediaLayer(ctx: ComposeContext, media: BlueprintMedia, zIndex: number, position: LayerBox, window?: { startFrame: number; durationInFrames: number }): Layer {
  const asset = ctx.assets[media.assetId];
  if (!asset) throw new Error(`Unknown asset "${media.assetId}"`);
  const isVideo = asset.kind === 'video';
  const treatmentChoice = media.treatment ?? (isVideo ? ctx.doc.style?.brollTreatment : ctx.doc.style?.imageTreatment);
  const { animations, effects }: Treatment = treatmentChoice
    ? layerTreatment(ctx, treatmentChoice, window?.durationInFrames ?? ctx.durationInFrames)
    : { animations: [], effects: [] };
  const common = { name: `${isVideo ? 'Video' : 'Image'} ${media.assetId}`, assetId: media.assetId, fit: 'cover' as const, zIndex, position, animations, effects, ...(window ?? {}) };
  return isVideo ? createLayer('video', { ...common, muted: true }, { ids: ctx.ids }) : createLayer('image', common, { ids: ctx.ids });
}

/** Background / main / inset media of a blueprint. */
export function mediaLayers(ctx: ComposeContext, options: { mainBox?: LayerBox } = {}): Layer[] {
  return (ctx.blueprint.media ?? []).map((m, i) => {
    const role = m.role ?? (i === 0 ? 'main' : 'inset');
    if (role === 'background') return mediaLayer(ctx, m, Z.background + i, box('center', 0, 0));
    if (role === 'inset') return mediaLayer(ctx, m, Z.inset + i, box('bottom-right', -4, -6, 30, 30));
    return mediaLayer(ctx, m, Z.media + i, options.mainBox ?? box('center', 0, 0));
  });
}

function dimOverlay(ctx: ComposeContext, amount = 0.45): Layer {
  return createLayer(
    'overlay',
    {
      name: 'Dim',
      kind: 'gradient',
      gradient: { kind: 'linear', angle: 180, stops: [{ color: `rgba(0,0,0,${amount * 0.6})`, offset: 0 }, { color: `rgba(0,0,0,${amount})`, offset: 1 }] },
      zIndex: Z.overlay,
    },
    { ids: ctx.ids },
  );
}

function captionLayer(ctx: ComposeContext): Layer[] {
  if (!ctx.captionStyle || !ctx.captionTrackId) return [];
  return [createLayer('caption', { name: 'Captions', trackId: ctx.captionTrackId, style: ctx.captionStyle, zIndex: Z.captions, position: box('bottom-center', 0, -7, 90, 18) }, { ids: ctx.ids })];
}

const typographyOf = (ctx: ComposeContext, fallback: string): PresetChoice => ctx.blueprint.typography ?? ctx.doc.style?.typography ?? fallback;
const effectOf = (ctx: ComposeContext, fallback: string): PresetChoice => ctx.blueprint.textEffect ?? ctx.doc.style?.textEffect ?? fallback;

function headlineAndSubtext(ctx: ComposeContext, fallbackTypography: string, fallbackEffect: string): Layer[] {
  const { headline, subtext } = ctx.blueprint;
  const out: Layer[] = [];
  if (headline) {
    out.push(textLayer(ctx, headline, { position: box('center', 0, subtext ? -8 : 0, 86, 34), typography: typographyOf(ctx, fallbackTypography), effect: effectOf(ctx, fallbackEffect), name: 'Headline' }));
  }
  if (subtext) {
    out.push(textLayer(ctx, subtext, { position: box('center', 0, 14, 76, 12), typography: 'documentary-serif', effect: 'fade-in', fontScale: 0.6, name: 'Subtext', startFrame: Math.round(ctx.fps * 0.3) }));
  }
  return out;
}

function lowerThird(ctx: ComposeContext): Layer[] {
  const { headline } = ctx.blueprint;
  return headline ? [textLayer(ctx, headline, { position: box('bottom-left', 5, -14, 60, 10), typography: 'lower-third', effect: 'slide-in', name: 'Lower third' })] : [];
}

function toJson(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

// ---------------------------------------------------------------------------
// Composers
// ---------------------------------------------------------------------------

export const genericComposer: SceneComposer = (ctx) => [...mediaLayers(ctx), ...headlineAndSubtext(ctx, 'headline-impact', 'fade-in'), ...captionLayer(ctx)];

const mediaWithLowerThird: SceneComposer = (ctx) => [...mediaLayers(ctx), ...lowerThird(ctx), ...captionLayer(ctx)];

export const BUILT_IN_COMPOSERS: Readonly<Record<string, SceneComposer>> = {
  title: (ctx) => {
    const media = mediaLayers(ctx, {});
    return [...media, ...(media.length ? [dimOverlay(ctx)] : []), ...headlineAndSubtext(ctx, 'headline-impact', 'kinetic-slam-words'), ...captionLayer(ctx)];
  },
  text: (ctx) => [...mediaLayers(ctx), ...headlineAndSubtext(ctx, 'headline-impact', 'kinetic-rise-words'), ...captionLayer(ctx)],
  video: mediaWithLowerThird,
  image: mediaWithLowerThird,
  broll: mediaWithLowerThird,
  talking_head: mediaWithLowerThird,
  screenshot: (ctx) => [
    ...(ctx.blueprint.media ?? []).map((m) => mediaLayer(ctx, { ...m, treatment: m.treatment ?? 'screenshot-focus' }, Z.media, box('center', 0, 0, 80, 80))),
    ...lowerThird(ctx),
    ...captionLayer(ctx),
  ],
  montage: (ctx) => {
    const media = ctx.blueprint.media ?? [];
    const slice = Math.max(1, Math.floor(ctx.durationInFrames / Math.max(1, media.length)));
    const layers = media.map((m, i) =>
      mediaLayer(ctx, m, Z.media + i, box('center', 0, 0), {
        startFrame: i * slice,
        durationInFrames: i === media.length - 1 ? ctx.durationInFrames - i * slice : slice,
      }),
    );
    return [...layers, ...lowerThird(ctx), ...captionLayer(ctx)];
  },
  quote: (ctx) => {
    const q = ctx.blueprint.quote;
    const media = mediaLayers(ctx);
    const out: Layer[] = [...media, ...(media.length ? [dimOverlay(ctx, 0.6)] : [])];
    if (q) {
      out.push(textLayer(ctx, `“${q.text}”`, { position: box('center', 0, -6, 80, 40), typography: typographyOf(ctx, 'documentary-serif'), effect: effectOf(ctx, 'kinetic-rise-words'), name: 'Quote' }));
      if (q.author) out.push(textLayer(ctx, `— ${q.author}`, { position: box('center', 0, 20, 60, 8), typography: 'documentary-serif', effect: 'fade-in', fontScale: 0.5, name: 'Author', startFrame: Math.round(ctx.fps * 0.8) }));
    }
    return [...out, ...captionLayer(ctx)];
  },
  statistic: (ctx) => {
    const s = ctx.blueprint.statistic;
    const out: Layer[] = [...mediaLayers(ctx)];
    if (s) {
      const style = applyChoice(ctx, 'typography', ctx.blueprint.typography ?? 'statistic-number');
      out.push(
        createLayer(
          'graphic',
          {
            name: 'Counter',
            kind: 'counter',
            data: toJson({ from: s.from ?? 0, to: s.value, decimals: s.decimals ?? 0, prefix: s.prefix ?? '', suffix: s.suffix ?? '', countDurationInFrames: Math.round(ctx.fps * 1.2), easing: 'easeOutCubic' }),
            style: toJson(style),
            zIndex: Z.graphic,
            position: box('center', 0, -6, 90, 30),
            animations: applyChoice(ctx, 'animation', 'pop-in'),
          },
          { ids: ctx.ids },
        ),
      );
      if (s.label) out.push(textLayer(ctx, s.label, { position: box('center', 0, 16, 80, 10), typography: 'documentary-serif', effect: 'fade-in', fontScale: 0.6, name: 'Label', startFrame: Math.round(ctx.fps * 0.5) }));
    }
    return [...out, ...(s ? [] : headlineAndSubtext(ctx, 'statistic-number', 'pop-in')), ...captionLayer(ctx)];
  },
  chart: (ctx) => {
    const c = ctx.blueprint.chart;
    const out: Layer[] = [...mediaLayers(ctx)];
    if (c) {
      out.push(createLayer('graphic', { name: 'Chart', kind: c.kind, data: c.data, zIndex: Z.graphic, position: box('center', 0, 0, 80, 54), animations: applyChoice(ctx, 'animation', 'fade-in') }, { ids: ctx.ids }));
      const title = c.title ?? ctx.blueprint.headline;
      if (title) out.push(textLayer(ctx, title, { position: box('top-center', 0, 8, 86, 12), typography: typographyOf(ctx, 'headline-impact'), effect: 'fade-in', fontScale: 0.5, name: 'Chart title' }));
    }
    return [...out, ...captionLayer(ctx)];
  },
  endcard: (ctx) => {
    const media = mediaLayers(ctx);
    return [...media, ...(media.length ? [dimOverlay(ctx, 0.6)] : []), ...headlineAndSubtext(ctx, 'headline-impact', 'pop-in')];
  },
};

export class SceneComposerRegistry {
  private readonly composers = new Map<string, SceneComposer>(Object.entries(BUILT_IN_COMPOSERS));

  register(type: string, composer: SceneComposer): this {
    this.composers.set(type, composer);
    return this;
  }

  get(type: string): SceneComposer {
    return this.composers.get(type) ?? genericComposer;
  }
}
