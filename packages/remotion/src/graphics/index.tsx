/**
 * Graphic components of the reference renderer. The record is typed on the
 * engine's REFERENCE_RENDERER_GRAPHIC_KINDS: if the engine advertises a kind
 * (and therefore skills using it) that is not implemented here, the Remotion
 * package does not compile — the skill catalog can never announce a phantom.
 */
import type React from 'react';
import type { ReferenceRendererGraphicKind } from '@studio-engine/scene-engine';
import { BarChart, Comparison, LineChart, PieChart } from './Charts';
import { Counter } from './Counter';
import { Progress, Timeline } from './Extra';
import { MapTiles } from './MapTiles';
import { StatCard } from './StatCard';
import { WorldMap } from './WorldMap';
import type { GraphicProps } from './common';

export const GRAPHIC_COMPONENTS: { readonly [K in ReferenceRendererGraphicKind]: React.FC<GraphicProps> } = {
  counter: Counter,
  statCard: StatCard,
  barChart: BarChart,
  lineChart: LineChart,
  pieChart: PieChart,
  comparison: Comparison,
  map: WorldMap,
  mapTiles: MapTiles,
  progress: Progress,
  timeline: Timeline,
};

export type { GraphicProps };
