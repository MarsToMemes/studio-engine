/** MAPS skills: drive the map graphic (Natural Earth + d3-geo in the reference renderer). */
import type { JsonObject } from '../model/primitives.js';
import type { ComposedShot } from '../shotplan/compile.js';
import { defineSkill } from './define.js';
import { byIntensity, graphicOf, sec } from './helpers.js';
import type { SkillDefinition } from './types.js';

const mapData = (t: ComposedShot) => graphicOf(t, 'map')?.data as (JsonObject & { markers?: unknown[]; route?: unknown[]; highlightCountries?: unknown[]; zoom?: number }) | undefined;

function animate(target: ComposedShot, animation: JsonObject): void {
  const map = graphicOf(target, 'map')!;
  const previous = (map.data.animation as JsonObject | undefined) ?? {};
  map.data = { ...map.data, animation: { ...previous, ...animation } };
}

const mapSkill = (init: Omit<SkillDefinition, 'category' | 'compatibleShotTypes' | 'requires' | 'version' | 'parameters' | 'events' | 'fallback'> & Partial<SkillDefinition>) =>
  defineSkill({ category: 'maps', compatibleShotTypes: ['map'], requires: { graphicKinds: ['map'] }, ...init });

export const MAP_SKILLS: SkillDefinition[] = [
  mapSkill({
    id: 'map_zoom',
    name: 'Map zoom',
    description: 'From a wide view, the map zooms to the location.',
    intensity: 'medium',
    duration: { min: 1, max: 4 },
    events: ['whoosh'],
    canApply: (t) => mapData(t) !== undefined,
    apply: (target, ctx) => {
      const zoom = mapData(target)!.zoom ?? 3;
      animate(target, { zoomFrom: Math.max(0, zoom - byIntensity(ctx.intensity, 1.5, 2.5, 3.5)), zoomInFrames: Math.round(ctx.durationInFrames * byIntensity(ctx.intensity, 0.8, 0.6, 0.45)) });
      return { events: [{ kind: 'whoosh', at: 0 }] };
    },
  }),
  mapSkill({
    id: 'map_route',
    name: 'Map route',
    description: 'A route draws itself between places.',
    intensity: 'medium',
    duration: { min: 1, max: 5 },
    fallback: ['map_zoom'],
    canApply: (t) => (mapData(t)?.route?.length ?? 0) >= 2,
    apply: (target, ctx) => animate(target, { routeStart: Math.round(ctx.durationInFrames * 0.15), routeFrames: Math.round(ctx.durationInFrames * byIntensity(ctx.intensity, 0.7, 0.55, 0.4)) }),
  }),
  mapSkill({
    id: 'location_pin',
    name: 'Location pin',
    description: 'Pins drop on the marked places with a spring.',
    intensity: 'medium',
    duration: { min: 0.5, max: 2 },
    fallback: ['map_zoom'],
    events: ['impact'],
    canApply: (t) => (mapData(t)?.markers?.length ?? 0) >= 1,
    apply: (target, ctx) => {
      const at = Math.round(ctx.durationInFrames * 0.3);
      animate(target, { pinStart: at, pinEach: sec(ctx, 0.2) });
      return { events: [{ kind: 'impact', at }] };
    },
  }),
  mapSkill({
    id: 'country_highlight',
    name: 'Country highlight',
    description: 'Countries fill with the accent color.',
    intensity: 'medium',
    duration: { min: 0.5, max: 2 },
    fallback: ['map_zoom'],
    events: ['highlight'],
    canApply: (t) => (mapData(t)?.highlightCountries?.length ?? 0) >= 1,
    apply: (target, ctx) => {
      const at = Math.round(ctx.durationInFrames * 0.2);
      animate(target, { countryStart: at, countryFrames: sec(ctx, byIntensity(ctx.intensity, 0.6, 0.4, 0.25)) });
      return { events: [{ kind: 'highlight', at }] };
    },
  }),
  mapSkill({
    id: 'business_expansion',
    name: 'Business expansion',
    description: 'Locations light up one after another across the map: growth of a network.',
    intensity: 'strong',
    duration: { min: 1.5, max: 6 },
    fallback: ['location_pin', 'map_zoom'],
    events: ['impact'],
    canApply: (t) => (mapData(t)?.markers?.length ?? 0) >= 2,
    apply: (target, ctx) => {
      const markers = mapData(target)!.markers!.length;
      const start = Math.round(ctx.durationInFrames * 0.15);
      const each = Math.max(1, Math.floor((ctx.durationInFrames * 0.65) / markers));
      animate(target, { pinStart: start, pinEach: each, zoomFrom: Math.max(0, (mapData(target)!.zoom ?? 3) - 1), zoomInFrames: ctx.durationInFrames });
      return { events: [{ kind: 'impact', at: start }] };
    },
  }),
];
