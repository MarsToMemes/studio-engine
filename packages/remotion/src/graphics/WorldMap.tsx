/**
 * Map from Natural Earth (world-atlas, public domain data) projected with
 * d3-geo. Fully deterministic: every value derives from the frame.
 */
import React, { useMemo } from 'react';
import { spring } from 'remotion';
import { geoInterpolate, geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { getEasingFunction } from '@studio-engine/scene-engine';
import world from 'world-atlas/countries-110m.json';
import { FONT, num, str, type GraphicProps } from './common';

type Coord = [number, number];
const topology = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const countries = feature(topology, topology.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
const ease = getEasingFunction('easeInOutCubic');
const coords = (v: unknown): Coord[] => (Array.isArray(v) ? v.filter((c): c is Coord => Array.isArray(c) && c.length === 2 && c.every((n) => typeof n === 'number')) : []);

export const WorldMap: React.FC<GraphicProps> = ({ layer, frame, fps, width, height }) => {
  const { data } = layer;
  const anim = (data.animation ?? {}) as Record<string, unknown>;
  const accent = str(data.accent, '#FFC72C');
  const center = (coords([data.center])[0] ?? [0, 20]) as Coord;
  const targetZoom = num(data.zoom, 2);
  const zoomFrom = num(anim.zoomFrom, targetZoom);
  const zoomIn = Math.max(1, num(anim.zoomInFrames, 1));
  const zoom = zoomFrom + (targetZoom - zoomFrom) * ease(Math.min(1, frame / zoomIn));
  const highlighted = useMemo(() => new Set(((data.highlightCountries as unknown[]) ?? []).map((n) => String(n).toLowerCase())), [data.highlightCountries]);

  const projection = geoMercator().center(center).scale((width / (2 * Math.PI)) * Math.pow(2, zoom)).translate([width / 2, height / 2]);
  const path = geoPath(projection);

  const countryP = Math.min(1, Math.max(0, (frame - num(anim.countryStart, 0)) / Math.max(1, num(anim.countryFrames, 1))));
  const route = coords(data.route);
  const routePoints = route.flatMap((c, i) => (i === 0 ? [c] : Array.from({ length: 24 }, (_, k) => geoInterpolate(route[i - 1]!, c)((k + 1) / 24) as Coord)));
  const routeP = anim.routeFrames ? ease(Math.min(1, Math.max(0, (frame - num(anim.routeStart, 0)) / num(anim.routeFrames, 1)))) : 1;
  const shownRoute = routePoints.slice(0, Math.max(0, Math.round(routePoints.length * routeP)));
  const markers = Array.isArray(data.markers) ? (data.markers as Array<{ label?: string; coordinates?: unknown }>) : [];

  return (
    <svg width={width} height={height} style={{ background: '#121212' }}>
      {countries.features.map((f, i) => {
        const on = highlighted.has(f.properties.name.toLowerCase());
        return <path key={i} d={path(f) ?? ''} fill={on ? accent : '#242424'} fillOpacity={on ? 0.25 + 0.75 * countryP : 1} stroke="#3a3a3a" strokeWidth={0.8} />;
      })}
      {shownRoute.length > 1 ? <path d={`M${shownRoute.map((c) => projection(c)!.join(',')).join(' L')}`} fill="none" stroke={accent} strokeWidth={6} strokeLinecap="round" strokeDasharray="1 14" /> : null}
      {markers.map((m, i) => {
        const c = coords([m.coordinates])[0];
        const xy = c ? projection(c) : null;
        if (!xy) return null;
        const s = anim.pinStart === undefined ? 1 : spring({ frame: frame - num(anim.pinStart, 0) - i * num(anim.pinEach, 0), fps, config: { damping: 11 } });
        if (s <= 0.001) return null;
        return (
          <g key={i} transform={`translate(${xy[0]},${xy[1]}) scale(${s})`}>
            <circle r={26} fill={accent} opacity={0.25} />
            <circle r={11} fill={accent} stroke="#121212" strokeWidth={3} />
            {m.label ? <text y={-38} fill="#fff" fontSize={30} fontWeight={800} textAnchor="middle" fontFamily={FONT} style={{ paintOrder: 'stroke', stroke: '#121212', strokeWidth: 6 }}>{m.label}</text> : null}
          </g>
        );
      })}
    </svg>
  );
};
