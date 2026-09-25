/**
 * Street-level map with MapLibre GL (skill `city_zoom`). Deterministic in
 * Remotion: non-interactive, no fade, drawing buffer preserved, and every
 * frame waits (delayRender) until the tiles of that camera are rendered.
 *
 * `data.style`: a MapLibre style URL (your tile provider or self-hosted
 * PMTiles), or `offline:natural-earth` (country shapes from local data, no
 * network: used to test the pipeline, not a street map).
 * `data.attribution` is drawn on screen (bible MAP-05).
 * The MapLibre worker must be served from `public/maplibre/` (copied by the
 * render / assets scripts) or given in `data.workerUrl`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getEasingFunction } from '@studio-engine/scene-engine';
import world from 'world-atlas/countries-110m.json';
import { FONT, num, str, type GraphicProps } from './common';

const easeInOut = getEasingFunction('easeInOut');
/** A frame never waits longer than this for tiles (a missing tile must not hang a render). */
const FRAME_TIMEOUT_MS = 8000;

type Marker = { label?: string; coordinates: [number, number] };

function offlineStyle(markers: Marker[], accent: string): StyleSpecification {
  const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
  return {
    version: 8,
    sources: {
      countries: { type: 'geojson', data: feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection },
      markers: { type: 'geojson', data: { type: 'FeatureCollection', features: markers.map((m) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: m.coordinates } })) } },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#121212' } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': '#262626' } },
      { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': '#5a5a5a', 'line-width': 2 } },
      { id: 'markers-halo', type: 'circle', source: 'markers', paint: { 'circle-radius': 26, 'circle-color': accent, 'circle-opacity': 0.25 } },
      { id: 'markers', type: 'circle', source: 'markers', paint: { 'circle-radius': 11, 'circle-color': accent, 'circle-stroke-color': '#121212', 'circle-stroke-width': 3 } },
    ],
  };
}

export const MapTiles: React.FC<GraphicProps> = ({ layer, frame, width, height }) => {
  const { data } = layer;
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [initHandle] = useState(() => delayRender('MapLibre: loading the style and first tiles'));
  const [labels, setLabels] = useState<Array<{ x: number; y: number; text: string }>>([]);
  const accent = str(data.accent, '#FFC72C');
  const markers = useMemo(() => (Array.isArray(data.markers) ? (data.markers as unknown as Marker[]) : []).filter((m) => Array.isArray(m.coordinates)), [data.markers]);
  const center = (Array.isArray(data.center) ? data.center : [0, 0]) as [number, number];
  const from = num(data.zoomFrom, 3);
  const to = num(data.zoomTo, 13);
  const zoom = from + (to - from) * easeInOut(Math.min(1, frame / Math.max(1, num(data.zoomInFrames, 60))));

  useEffect(() => {
    let alive = true;
    let created: MapLibreMap | undefined;
    import('maplibre-gl').then(({ Map, setWorkerUrl }) => {
      if (!alive || !container.current) return;
      // Bundled, MapLibre cannot find its worker next to itself: it is served
      // from public/maplibre/ (scripts/maplibre-worker.mjs), or from data.workerUrl.
      setWorkerUrl(str(data.workerUrl) || staticFile('maplibre/maplibre-gl-worker.mjs'));
      const style = str(data.style);
      created = new Map({
        container: container.current,
        style: style === 'offline:natural-earth' ? offlineStyle(markers, accent) : style,
        center,
        zoom: from,
        interactive: false,
        fadeDuration: 0,
        attributionControl: false,
        canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      });
      const done = () => continueRender(initHandle);
      const timer = setTimeout(done, FRAME_TIMEOUT_MS * 2);
      created.once('idle', () => {
        clearTimeout(timer);
        if (alive) setMap(created!);
        done();
      });
      created.on('error', (e) => console.error('[MapTiles]', e.error?.message ?? e));
    });
    return () => {
      alive = false;
    };
    // The map is created once; camera changes happen per frame below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per frame: move the camera, then wait until that view is fully drawn.
  useEffect(() => {
    if (!map) return;
    const handle = delayRender(`MapLibre frame ${frame}`);
    const timer = setTimeout(() => continueRender(handle), FRAME_TIMEOUT_MS);
    map.jumpTo({ center, zoom });
    map.once('idle', () => {
      clearTimeout(timer);
      setLabels(markers.filter((m) => m.label).map((m) => ({ ...map.project(m.coordinates), text: m.label! })));
      continueRender(handle);
    });
    map.triggerRepaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, frame]);

  const attribution = str(data.attribution);
  return (
    <div style={{ position: 'relative', width, height, background: '#121212' }}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {labels.map((l, i) => (
        <div key={i} style={{ position: 'absolute', left: l.x, top: l.y - 64, transform: 'translateX(-50%)', color: '#fff', font: `800 30px ${FONT}`, textShadow: '0 0 6px #121212, 0 0 3px #121212', whiteSpace: 'nowrap' }}>
          {l.text}
        </div>
      ))}
      {attribution ? <div style={{ position: 'absolute', right: 12, bottom: 8, color: 'rgba(255,255,255,0.75)', font: `500 16px ${FONT}`, textShadow: '0 0 4px #000' }}>{attribution}</div> : null}
    </div>
  );
};
