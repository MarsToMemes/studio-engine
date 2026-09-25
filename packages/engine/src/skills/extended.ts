/**
 * Motion Skill Registry v2: the skills of the bible's catalogue (§10) that the
 * first registry did not have. Same contract as every skill: deterministic,
 * frame-based, with a fallback chain and the editorial events they emit.
 */
import { createLayer } from '../core/factories.js';
import { resolveLayerBox } from '../core/layout.js';
import type { LayerBox, TextLayer } from '../model/layer.js';
import type { Gradient, Vec2 } from '../model/primitives.js';
import type { ComposedShot } from '../shotplan/compile.js';
import { normalizeWord } from '../shotplan/validate.js';
import { defineSkill } from './define.js';
import { addAnimations, byIntensity, graphicOf, keywordFrames, sec, seedOf, textLayerOf } from './helpers.js';
import type { SkillApplyContext, SkillDefinition } from './types.js';

const box = (anchor: LayerBox['anchor'], x: number, y: number, width: number, height: number): LayerBox => ({ anchor, x, y, width, height, units: 'percent' });
const px = (x: number, y: number, width: number, height: number): LayerBox => ({ anchor: 'top-left', x, y, width, height, units: 'px' });
const hasCounter = (t: ComposedShot) => graphicOf(t, 'number') !== undefined;
const highlightLayers = (t: ComposedShot) => t.scene.layers.filter((l) => l.id.startsWith(`${t.shot.id}:highlight-`));

/** Words of little weight in a statement (they stay small). */
const LIGHT = new Set('a an the of to in on at by for and or is are was its it this that de la le les un une des du et ou est en au aux'.split(' '));

/** Pixel rectangle of a layer placed in px (document highlights). */
function rectOf(layer: { position: LayerBox }): { x: number; y: number; w: number; h: number } | undefined {
  const p = layer.position;
  return p.units === 'px' && p.width !== undefined && p.height !== undefined ? { x: p.x, y: p.y, w: p.width, h: p.height } : undefined;
}

function focusOfHighlight(t: ComposedShot, canvas: { width: number; height: number }): Vec2 {
  const r = highlightLayers(t)[0] ? rectOf(highlightLayers(t)[0]!) : undefined;
  return r ? { x: (r.x + r.w / 2) / canvas.width, y: (r.y + r.h / 2) / canvas.height } : { x: 0.5, y: 0.45 };
}

function spokenEmphasis(ctx: SkillApplyContext, text: TextLayer): number {
  const frames = text.emphasis?.length ? keywordFrames(ctx, text, text.emphasis.slice(0, 1)) : [];
  return frames[0] ?? 0;
}

// ---------------------------------------------------------------------------
// TEXT
// ---------------------------------------------------------------------------

const kineticStatement = defineSkill({
  id: 'kinetic_statement',
  name: 'Kinetic statement',
  category: 'text',
  description: 'Typographic hierarchy: small linking words, large key words, the most important one the biggest ("THE real BUSINESS"). Words slam in one by one.',
  intensity: 'medium',
  duration: { min: 1.5, max: 4 },
  compatibleShotTypes: ['text', 'revelation'],
  fallback: ['scale_text', 'word_reveal'],
  events: ['keyword'],
  canApply: (t) => textLayerOf(t) !== undefined,
  apply: (target, ctx) => {
    const text = textLayerOf(target)!;
    const words = text.text.split(/\s+/);
    const emphasis = text.emphasis ?? [];
    text.wordScales = words.map((w, i) => {
      const rank = emphasis.indexOf(i);
      if (rank >= 0) return byIntensity(ctx.intensity, 1.3, 1.45, 1.6) + 0.15 * rank;
      return LIGHT.has(normalizeWord(w)) ? 0.62 : 0.9;
    });
    text.style = { ...text.style, fontSize: Math.round((text.style.fontSize ?? 120) * 0.95) };
    addAnimations(text, { type: 'kineticTypography', phase: 'in', style: 'slam', split: 'words', each: byIntensity(ctx.intensity, 5, 4, 3), intensity: byIntensity(ctx.intensity, 0.3, 0.45, 0.7), durationInFrames: sec(ctx, 0.35) });
    return { events: [{ kind: 'keyword', at: spokenEmphasis(ctx, text) }] };
  },
});

// ---------------------------------------------------------------------------
// NUMBERS
// ---------------------------------------------------------------------------

const digitRoll = (id: string, name: string, description: string, style: 'roll' | 'odometer', fallback: string[]) =>
  defineSkill({
    id,
    name,
    category: 'numbers',
    description,
    intensity: 'medium',
    duration: { min: 0.8, max: 2.5 },
    compatibleShotTypes: ['number'],
    fallback,
    family: 'digit_roll',
    events: ['number'],
    requires: { graphicKinds: ['counter'] },
    canApply: hasCounter,
    apply: (target, ctx) => {
      const counter = graphicOf(target, 'number')!;
      const count = byIntensity(ctx.intensity, sec(ctx, 1.6), sec(ctx, 1.2), sec(ctx, 0.9));
      counter.data = { ...counter.data, style, countDurationInFrames: count, digitStaggerFrames: style === 'roll' ? sec(ctx, 0.08) : 0 };
      addAnimations(counter, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.2) });
      const label = textLayerOf(target);
      if (label) addAnimations(label, { type: 'fade', phase: 'in', startFrame: sec(ctx, 0.5), durationInFrames: sec(ctx, 0.4) });
      return { events: [{ kind: 'number', at: Math.min(ctx.durationInFrames - 1, count) }] };
    },
  });

// ---------------------------------------------------------------------------
// IMAGES (camera-style: they control the camera)
// ---------------------------------------------------------------------------

const depthZoom = defineSkill({
  id: 'depth_zoom',
  name: 'Depth zoom',
  category: 'images',
  description: 'An accelerating dive into the point of interest: the image seems to open up in depth. For a detail that matters.',
  intensity: 'medium',
  duration: { min: 2, max: 6 },
  compatibleShotTypes: ['image', 'video', 'document', 'map'],
  fallback: ['slow_zoom'],
  family: 'push',
  apply: (target, ctx) => {
    const media = target.roles.media ?? target.roles.document ?? target.roles.map;
    const origin = target.shot.focus ? { x: target.shot.focus.x / 100, y: target.shot.focus.y / 100 } : { x: 0.5, y: 0.5 };
    const zoom = { type: 'zoom' as const, from: 1, to: byIntensity(ctx.intensity, 1.1, 1.15, 1.22), origin, durationInFrames: ctx.durationInFrames, easing: 'easeInCubic' as const };
    if (media) addAnimations(media, zoom);
    else target.scene.animations = [...target.scene.animations, zoom];
  },
});

const cinematicPush = defineSkill({
  id: 'cinematic_push',
  name: 'Cinematic push',
  category: 'images',
  description: 'A dolly-like push with a slight rise, smoother and wider than a slow zoom: the establishing move of a sequence.',
  intensity: 'subtle',
  duration: { min: 3, max: 10 },
  compatibleShotTypes: ['image', 'video', 'text', 'number', 'document', 'chart', 'map', 'revelation', 'chapter'],
  fallback: ['slow_push', 'slow_zoom'],
  family: 'push',
  apply: (target, ctx) => {
    const media = target.roles.media ?? target.roles.map;
    const move = { type: 'camera' as const, move: 'dolly' as const, intensity: byIntensity(ctx.intensity, 0.45, 0.6, 0.75), durationInFrames: ctx.durationInFrames, easing: 'easeInOut' as const };
    if (media) addAnimations(media, move);
    else target.scene.animations = [...target.scene.animations, move];
  },
});

// ---------------------------------------------------------------------------
// DOCUMENTS
// ---------------------------------------------------------------------------

const documentFocus = defineSkill({
  id: 'document_focus',
  name: 'Document focus',
  category: 'documents',
  description: 'The camera moves to the highlighted passage while the rest of the page darkens: nothing competes with the proof.',
  intensity: 'medium',
  duration: { min: 2.5, max: 8 },
  compatibleShotTypes: ['document'],
  fallback: ['document_highlight', 'document_zoom'],
  events: ['highlight'],
  canApply: (t) => t.roles.document !== undefined && highlightLayers(t).some((l) => rectOf(l)),
  apply: (target, ctx) => {
    const layers = highlightLayers(target);
    const r = rectOf(layers[0]!)!;
    const at = target.shot.document?.highlights?.[0]?.at ?? Math.round(ctx.durationInFrames * 0.25);
    layers.forEach((layer, i) => (layer.animations = [{ type: 'reveal', direction: 'right', startFrame: target.shot.document?.highlights?.[i]?.at ?? at, durationInFrames: sec(ctx, 0.4), easing: 'easeOutCubic' }]));
    // Dim everything around the first passage (four rectangles leave it lit).
    const { width: W, height: H } = ctx.canvas;
    const pad = 12;
    const x0 = Math.max(0, r.x - pad);
    const y0 = Math.max(0, r.y - pad);
    const x1 = Math.min(W, r.x + r.w + pad);
    const y1 = Math.min(H, r.y + r.h + pad);
    const dims: Array<[string, LayerBox]> = [
      ['top', px(0, 0, W, y0)],
      ['bottom', px(0, y1, W, H - y1)],
      ['left', px(0, y0, x0, y1 - y0)],
      ['right', px(x1, y0, W - x1, y1 - y0)],
    ];
    for (const [side, position] of dims) {
      if (position.width! <= 0 || position.height! <= 0) continue;
      target.scene.layers.push(createLayer('shape', { id: `${target.shot.id}:focus-${side}`, shape: 'rect', fill: 'rgba(0,0,0,0.62)', position, zIndex: 34, animations: [{ type: 'fade', phase: 'in', startFrame: at, durationInFrames: sec(ctx, 0.5), easing: 'easeOutCubic' }] }));
    }
    target.scene.animations = [...target.scene.animations, { type: 'zoom', from: 1, to: byIntensity(ctx.intensity, 1.15, 1.3, 1.45), origin: focusOfHighlight(target, ctx.canvas), durationInFrames: ctx.durationInFrames, easing: 'easeInOut' }];
    return { events: [{ kind: 'highlight', at }] };
  },
});

const redactionReveal = defineSkill({
  id: 'redaction_reveal',
  name: 'Redaction reveal',
  category: 'documents',
  description: 'The key passages start blacked out, then the bars pull away to reveal them, as the voice reads them.',
  intensity: 'strong',
  duration: { min: 2, max: 8 },
  compatibleShotTypes: ['document'],
  fallback: ['document_highlight', 'document_zoom'],
  events: ['reveal'],
  canApply: (t) => t.roles.document !== undefined && highlightLayers(t).some((l) => rectOf(l)),
  apply: (target, ctx) => {
    const layers = highlightLayers(target);
    const events: Array<{ kind: 'reveal'; at: number }> = [];
    layers.forEach((layer, i) => {
      const r = rectOf(layer);
      if (!r) return;
      const at = target.shot.document?.highlights?.[i]?.at ?? Math.round(ctx.durationInFrames * (0.3 + (0.4 * i) / Math.max(1, layers.length)));
      const open = byIntensity(ctx.intensity, sec(ctx, 0.5), sec(ctx, 0.35), sec(ctx, 0.25));
      target.scene.layers.push(
        createLayer('shape', {
          id: `${target.shot.id}:redaction-${i + 1}`,
          shape: 'rect',
          fill: '#0B0B0B',
          position: px(r.x - 4, r.y - 2, r.w + 8, r.h + 4),
          zIndex: 36,
          animations: [{ type: 'keyframes', startFrame: at, durationInFrames: open, tracks: [{ property: 'scaleX', keyframes: [{ frame: 0, value: 1, easing: 'easeInCubic' }, { frame: open, value: 0 }] }] }],
          transform: { origin: { x: 1, y: 0.5 } },
        }),
      );
      layer.animations = [{ type: 'reveal', direction: 'right', startFrame: at + open, durationInFrames: sec(ctx, 0.3), easing: 'easeOutCubic' }];
      events.push({ kind: 'reveal', at });
    });
    target.scene.animations = [...target.scene.animations, { type: 'zoom', from: 1, to: byIntensity(ctx.intensity, 1.05, 1.1, 1.15), origin: focusOfHighlight(target, ctx.canvas), durationInFrames: ctx.durationInFrames, easing: 'easeInOut' }];
    return { events };
  },
});

// ---------------------------------------------------------------------------
// DATA
// ---------------------------------------------------------------------------

const rankingAnimation = defineSkill({
  id: 'ranking_animation',
  name: 'Ranking',
  category: 'data',
  description: 'Horizontal bars sorted from first to last, growing one after another with their rank: who leads, by how much.',
  intensity: 'medium',
  duration: { min: 1.2, max: 4 },
  compatibleShotTypes: ['chart'],
  fallback: ['bar_animation', 'chart_reveal'],
  events: ['number'],
  requires: { graphicKinds: ['barChart'] },
  canApply: (t) => ((graphicOf(t, 'chart')?.data.values as number[] | undefined)?.length ?? 0) >= 2,
  apply: (target, ctx) => {
    const chart = graphicOf(target, 'chart')!;
    chart.kind = 'barChart';
    chart.data = { ...chart.data, horizontal: true, sorted: true, ranks: true, startFrame: sec(ctx, 0.15), growInFrames: byIntensity(ctx.intensity, sec(ctx, 1.2), sec(ctx, 0.9), sec(ctx, 0.6)), staggerFrames: sec(ctx, 0.18) };
    return { events: [{ kind: 'number', at: sec(ctx, 0.15) }] };
  },
});

const percentageBar = defineSkill({
  id: 'percentage_bar',
  name: 'Percentage bar',
  category: 'data',
  description: 'The percentage counts up while a bar fills to the same share: the proportion becomes visible.',
  intensity: 'medium',
  duration: { min: 0.8, max: 2.5 },
  compatibleShotTypes: ['number'],
  fallback: ['percentage_reveal', 'number_count'],
  events: ['number'],
  requires: { graphicKinds: ['counter', 'progress'] },
  canApply: (t) => hasCounter(t) && t.shot.number?.suffix === '%',
  apply: (target, ctx) => {
    const counter = graphicOf(target, 'number')!;
    const fill = byIntensity(ctx.intensity, sec(ctx, 1.6), sec(ctx, 1.2), sec(ctx, 0.9));
    counter.data = { ...counter.data, countDurationInFrames: fill };
    // Figure and label move up together; the bar goes under the label.
    const label = textLayerOf(target);
    for (const l of [counter, label]) if (l && l.position.units !== 'px') l.position = { ...l.position, y: (l.position.y ?? 0) - 8 };
    target.scene.layers.push(
      createLayer('graphic', { id: `${target.shot.id}:progress`, kind: 'progress', data: { value: target.shot.number!.value, max: 100, growInFrames: fill, color: ctx.theme.accent }, position: box('center', 0, 22, 70, 5), zIndex: 22 }),
    );
    addAnimations(counter, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.2) });
    if (label) addAnimations(label, { type: 'fade', phase: 'in', startFrame: sec(ctx, 0.5), durationInFrames: sec(ctx, 0.4) });
    return { events: [{ kind: 'number', at: Math.min(ctx.durationInFrames - 1, fill) }] };
  },
});

// ---------------------------------------------------------------------------
// MAPS
// ---------------------------------------------------------------------------

const flightRoute = defineSkill({
  id: 'flight_route',
  name: 'Flight route',
  category: 'maps',
  description: 'A great-circle route draws itself with a moving point at its head, from the first place to the last.',
  intensity: 'medium',
  duration: { min: 2, max: 6 },
  compatibleShotTypes: ['map'],
  fallback: ['map_route', 'location_pin', 'map_zoom'],
  family: 'route',
  events: ['whoosh'],
  requires: { graphicKinds: ['map'] },
  canApply: (t) => ((graphicOf(t, 'map')?.data.route as unknown[] | undefined)?.length ?? 0) >= 2,
  apply: (target, ctx) => {
    const map = graphicOf(target, 'map')!;
    const start = sec(ctx, 0.4);
    map.data = { ...map.data, animation: { ...((map.data.animation as object) ?? {}), routeStart: start, routeFrames: Math.max(sec(ctx, 1), Math.round(ctx.durationInFrames * 0.6)), plane: true } };
    return { events: [{ kind: 'whoosh', at: start }] };
  },
});

const cityZoom = defineSkill({
  id: 'city_zoom',
  name: 'City zoom',
  category: 'maps',
  description: 'From the region down to street level on a real map (MapLibre tiles), landing on the place as it is named.',
  intensity: 'medium',
  duration: { min: 2.5, max: 7 },
  compatibleShotTypes: ['map'],
  fallback: ['map_zoom', 'location_pin'],
  events: ['whoosh'],
  requires: { graphicKinds: ['mapTiles'] },
  canApply: (t) => typeof graphicOf(t, 'map')?.data.style === 'string',
  apply: (target, ctx) => {
    const map = graphicOf(target, 'map')!;
    const to = typeof map.data.zoom === 'number' && map.data.zoom >= 8 ? map.data.zoom : 13;
    map.kind = 'mapTiles';
    map.data = { ...map.data, zoomFrom: byIntensity(ctx.intensity, to - 3, to - 5, to - 7), zoomTo: to, zoomInFrames: Math.round(ctx.durationInFrames * byIntensity(ctx.intensity, 0.9, 0.75, 0.6)) };
    return { events: [{ kind: 'whoosh', at: 0 }] };
  },
});

// ---------------------------------------------------------------------------
// REVEALS
// ---------------------------------------------------------------------------

const lightReveal = defineSkill({
  id: 'light_reveal',
  name: 'Light reveal',
  category: 'reveals',
  description: 'A band of light sweeps across and the statement appears behind it: a clean, warm reveal.',
  intensity: 'medium',
  duration: { min: 1, max: 3 },
  compatibleShotTypes: ['revelation', 'text', 'chapter'],
  fallback: ['text_reveal', 'word_reveal'],
  family: 'word_reveal',
  events: ['reveal'],
  canApply: (t) => textLayerOf(t) !== undefined,
  apply: (target, ctx) => {
    const text = textLayerOf(target)!;
    const sweep = byIntensity(ctx.intensity, sec(ctx, 0.9), sec(ctx, 0.7), sec(ctx, 0.5));
    addAnimations(text, { type: 'reveal', direction: 'right', durationInFrames: sweep, easing: 'easeInOutCubic' });
    // The band rides the reveal edge: same duration and easing, centred on the clip edge of the text box.
    const band = 0.22 * ctx.canvas.width;
    const edge = resolveLayerBox(text.position, ctx.canvas);
    const light: Gradient = { kind: 'linear', angle: 90, stops: [{ offset: 0, color: 'rgba(255,255,255,0)' }, { offset: 0.5, color: 'rgba(255,240,200,0.55)' }, { offset: 1, color: 'rgba(255,255,255,0)' }] };
    target.scene.layers.push(
      createLayer('shape', {
        id: `${target.shot.id}:light`,
        shape: 'rect',
        fill: light,
        position: box('center-left', 0, 0, 22, 100),
        zIndex: 45,
        animations: [
          { type: 'keyframes', durationInFrames: sweep, tracks: [{ property: 'x', keyframes: [{ frame: 0, value: edge.x - band / 2, easing: 'easeInOutCubic' }, { frame: sweep, value: edge.x + edge.width - band / 2 }] }] },
          { type: 'fade', phase: 'out', durationInFrames: sec(ctx, 0.1) },
        ],
        durationInFrames: sweep + sec(ctx, 0.1),
      }),
    );
    return { events: [{ kind: 'reveal', at: Math.round(sweep * 0.5) }] };
  },
});

const impactReveal = defineSkill({
  id: 'impact_reveal',
  name: 'Impact reveal',
  category: 'reveals',
  description: 'The statement slams in with a white flash and a short shake: the hardest hit of the video, for a major revelation.',
  intensity: 'strong',
  duration: { min: 1, max: 3 },
  compatibleShotTypes: ['revelation', 'text', 'number'],
  fallback: ['flash_reveal', 'zoom_reveal'],
  controlsCamera: true, // the shake moves the frame
  events: ['impact'],
  canApply: (t) => textLayerOf(t) !== undefined || hasCounter(t),
  apply: (target, ctx) => {
    const main = textLayerOf(target) ?? graphicOf(target, 'number')!;
    addAnimations(main, { type: 'keyframes', durationInFrames: sec(ctx, 0.25), tracks: [{ property: 'scale', keyframes: [{ frame: 0, value: byIntensity(ctx.intensity, 1.3, 1.5, 1.7), easing: 'easeOutCubic' }, { frame: sec(ctx, 0.25), value: 1 }] }] }, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.08) });
    target.scene.layers.push(
      createLayer('shape', { id: `${target.shot.id}:flash`, shape: 'rect', fill: '#FFFFFF', position: box('center', 0, 0, 100, 100), zIndex: 70, durationInFrames: sec(ctx, 0.2), animations: [{ type: 'keyframes', durationInFrames: sec(ctx, 0.2), tracks: [{ property: 'opacity', keyframes: [{ frame: 0, value: byIntensity(ctx.intensity, 0.5, 0.7, 0.85) }, { frame: sec(ctx, 0.2), value: 0 }] }] }] }),
    );
    target.scene.animations = [...target.scene.animations, { type: 'shake', phase: 'in', amplitude: byIntensity(ctx.intensity, 6, 10, 16), frequency: 18, rotation: 0.4, seed: seedOf(target.shot.id), durationInFrames: sec(ctx, 0.3) }];
    return { events: [{ kind: 'impact', at: 0 }] };
  },
});

// ---------------------------------------------------------------------------
// EDITORIAL
// ---------------------------------------------------------------------------

const warningCard = defineSkill({
  id: 'warning_card',
  name: 'Warning card',
  category: 'editorial',
  description: 'A warning: red side bar and warning sign, the statement slides in. Red is reserved for danger and negative events (bible COL-02).',
  intensity: 'medium',
  duration: { min: 1.5, max: 5 },
  compatibleShotTypes: ['text', 'revelation'],
  fallback: ['full_screen_statement', 'word_reveal'],
  events: ['text'],
  canApply: (t) => textLayerOf(t) !== undefined,
  apply: (target, ctx) => {
    const text = textLayerOf(target)!;
    text.position = { ...text.position, x: 6, width: 80 };
    text.style = { ...text.style, textAlign: 'left' };
    target.scene.layers.push(
      createLayer('shape', { id: `${target.shot.id}:warning-bar`, shape: 'rect', fill: ctx.theme.alert, position: box('center-left', 7, 0, 0.8, 34), zIndex: 41, animations: [{ type: 'keyframes', durationInFrames: sec(ctx, 0.3), tracks: [{ property: 'scaleY', keyframes: [{ frame: 0, value: 0, easing: 'easeOutCubic' }, { frame: sec(ctx, 0.3), value: 1 }] }] }] }),
      createLayer('text', { id: `${target.shot.id}:warning-sign`, text: '⚠', style: { fontSize: 110, color: ctx.theme.alert, textAlign: 'center' }, position: box('top-center', 0, 14, 12, 16), zIndex: 42, animations: [{ type: 'spring', phase: 'in', property: 'scale', from: 0.4, to: 1, damping: 12, durationInFrames: sec(ctx, 0.5) }] }),
    );
    addAnimations(text, { type: 'slide', phase: 'in', direction: 'right', distance: 12, units: 'percent', fade: true, startFrame: sec(ctx, 0.2), durationInFrames: sec(ctx, 0.45), easing: 'easeOutCubic' });
    return { events: [{ kind: 'text', at: sec(ctx, 0.2) }] };
  },
});

const keyFact = defineSkill({
  id: 'key_fact',
  name: 'Key fact',
  category: 'editorial',
  description: 'The statement inside an accent frame, like a fact card to remember: calm, clear, no effect.',
  intensity: 'subtle',
  duration: { min: 2, max: 6 },
  compatibleShotTypes: ['text'],
  fallback: ['highlight_word', 'word_reveal'],
  events: ['text'],
  canApply: (t) => textLayerOf(t) !== undefined,
  apply: (target, ctx) => {
    const text = textLayerOf(target)!;
    text.style = { ...text.style, fontSize: Math.round((text.style.fontSize ?? 110) * 0.8) };
    target.scene.layers.push(
      createLayer('shape', { id: `${target.shot.id}:fact-frame`, shape: 'rect', stroke: { color: ctx.theme.accent, width: 6 }, cornerRadius: 10, position: box('center', 0, 0, 78, 46), zIndex: 30, animations: [{ type: 'scale', phase: 'in', from: 0.96, to: 1, durationInFrames: sec(ctx, 0.4), easing: 'easeOutCubic' }, { type: 'fade', phase: 'in', durationInFrames: sec(ctx, 0.3) }] }),
      createLayer('shape', { id: `${target.shot.id}:fact-tab`, shape: 'rect', fill: ctx.theme.accent, position: box('center', -35, -23, 8, 1.4), zIndex: 31, animations: [{ type: 'fade', phase: 'in', startFrame: sec(ctx, 0.2), durationInFrames: sec(ctx, 0.3) }] }),
    );
    addAnimations(text, { type: 'fade', phase: 'in', startFrame: sec(ctx, 0.15), durationInFrames: sec(ctx, 0.4) });
    return { events: [{ kind: 'text', at: sec(ctx, 0.15) }] };
  },
});

const timelineEvent = defineSkill({
  id: 'timeline_event',
  name: 'Timeline',
  category: 'editorial',
  description: 'A horizontal timeline draws itself; each date (the chart labels) appears as its dot is reached. For a sequence of events or steps.',
  intensity: 'subtle',
  duration: { min: 2, max: 7 },
  compatibleShotTypes: ['chart'],
  fallback: ['bar_animation', 'chart_reveal'],
  events: ['text'],
  requires: { graphicKinds: ['timeline'] },
  canApply: (t) => ((graphicOf(t, 'chart')?.data.labels as unknown[] | undefined)?.length ?? 0) >= 2,
  apply: (target, ctx) => {
    const chart = graphicOf(target, 'chart')!;
    chart.kind = 'timeline';
    chart.data = { ...chart.data, startFrame: sec(ctx, 0.2), drawInFrames: Math.max(sec(ctx, 1), Math.round(ctx.durationInFrames * 0.6)) };
    return { events: [{ kind: 'text', at: sec(ctx, 0.2) }] };
  },
});

export const EXTENDED_SKILLS: SkillDefinition[] = [
  kineticStatement,
  digitRoll('counter_roll', 'Counter roll', 'Each digit rolls like a slot machine and locks in place, left to right.', 'roll', ['number_count', 'number_pop']),
  digitRoll('odometer', 'Odometer', 'The number turns like a mechanical counter: digits scroll continuously to the value.', 'odometer', ['counter_roll', 'number_count']),
  depthZoom,
  cinematicPush,
  documentFocus,
  redactionReveal,
  rankingAnimation,
  percentageBar,
  flightRoute,
  cityZoom,
  lightReveal,
  impactReveal,
  warningCard,
  keyFact,
  timelineEvent,
];
