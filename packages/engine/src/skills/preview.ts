/**
 * Canonical demonstration shots: a one-shot plan that shows what a skill
 * does. Used to render the Motion Library previews, and by any UI that wants
 * to play a live preview of a skill (e.g. in @remotion/player).
 */
import type { AssetRegistry } from '../model/assets.js';
import type { Shot, ShotPlan, ShotType } from '../shotplan/types.js';
import type { MotionSkillRegistry } from './registry.js';
import type { MotionSkill } from './types.js';

/** Preview media, served from the renderer's public folder (packages/remotion/public). */
export const PREVIEW_ASSETS: AssetRegistry = {
  landscape: { id: 'landscape', kind: 'image', src: 'landscape.png', width: 1920, height: 1080 },
  clip: { id: 'clip', kind: 'video', src: 'clip.webm', durationInSeconds: 6, width: 1920, height: 1080, fps: 30 },
  report: { id: 'report', kind: 'image', src: 'report.png', width: 1000, height: 1400 },
};

export const PREVIEW_SECONDS = 3;

/** Shot types a preview prefers, by category (and a few skills that need a specific shot). */
const PREFERRED: Record<string, ShotType[]> = {
  text: ['text', 'revelation'],
  reveals: ['revelation', 'text'],
  numbers: ['number'],
  data: ['chart', 'number'],
  documents: ['document'],
  maps: ['map'],
  images: ['image', 'video'],
  editorial: ['text', 'chapter', 'document', 'image'],
};
const BY_SKILL: Record<string, ShotType> = { chapter_card: 'chapter', source_card: 'document', lower_third: 'image', percentage_bar: 'number' };

function previewShot(skill: MotionSkill, fps: number): Shot {
  const preferred = [...(BY_SKILL[skill.id] ? [BY_SKILL[skill.id]!] : []), ...(PREFERRED[skill.category] ?? [])];
  const type = preferred.find((t) => skill.compatibleShotTypes.includes(t)) ?? skill.compatibleShotTypes[0]!;
  const base = { id: skill.id, type, durationInFrames: PREVIEW_SECONDS * fps, motionSkill: skill.id };
  switch (type) {
    case 'text':
    case 'revelation':
      return { ...base, text: skill.category === 'editorial' && skill.id === 'quote_card' ? 'The real business is real estate' : 'They own the LAND', highlightedWords: ['LAND'], ...(skill.id === 'quote_card' ? { subtext: 'Harry Sonneborn, 1956' } : {}) };
    case 'chapter':
      return { ...base, text: 'The real estate empire', subtext: 'CHAPTER 2' };
    case 'number':
      return { ...base, number: skill.id === 'currency_reveal' ? { value: 9.9, prefix: '$', suffix: 'B', decimals: 1, label: 'rent income in 2023' } : { value: 61, suffix: '%', label: 'of revenue from franchisees' } };
    case 'chart': {
      const labels = skill.id === 'timeline_event' ? ['1955', '1961', '1965', '2023'] : skill.id === 'ranking_animation' ? ['Tokyo', 'Paris', 'Chicago', 'London'] : ['2019', '2021', '2023'];
      const values = skill.id === 'timeline_event' ? [1, 2, 3, 4] : skill.id === 'ranking_animation' ? [3.1, 1.2, 4.4, 2.5] : skill.id === 'comparison_graph' ? [4.4, 9.9] : [7.6, 8.9, 9.9];
      return { ...base, chart: { kind: skill.id === 'pie_reveal' ? 'pieChart' : skill.id.startsWith('line') || skill.id === 'chart_growth' ? 'lineChart' : 'barChart', labels: skill.id === 'comparison_graph' ? ['Food', 'Rent'] : labels, values, ...(skill.id === 'timeline_event' ? {} : { unit: 'B$' }), title: skill.id === 'timeline_event' ? 'Key dates' : 'Rent income' } };
    }
    case 'document':
      return { ...base, media: 'report', document: { source: 'Annual report 2023', highlights: [{ x: 9, y: 26, width: 72, height: 4, at: Math.round(fps * 0.8) }] } };
    case 'map': {
      const markers: Array<{ label: string; coordinates: [number, number] }> = [
        { label: 'Chicago', coordinates: [-87.63, 41.88] },
        { label: 'London', coordinates: [-0.13, 51.51] },
        { label: 'Tokyo', coordinates: [139.69, 35.69] },
      ];
      // Zoom 8: the offline style only has countries; a real tile style is needed for street level (13).
      if (skill.id === 'city_zoom') return { ...base, map: { center: [2.35, 48.86], zoom: 8, style: 'offline:natural-earth', attribution: 'Natural Earth (offline preview style)', markers: [{ label: 'Paris', coordinates: [2.35, 48.86] }] } };
      // Each map skill gets only the data it animates, so the previews tell them apart.
      const route: Array<[number, number]> = [[-87.63, 41.88], [-0.13, 51.51], [139.69, 35.69]];
      const world = { center: [20, 30] as [number, number], zoom: 0.3 };
      switch (skill.id) {
        case 'map_route':
        case 'flight_route':
          return { ...base, map: { ...world, markers, route } };
        case 'country_highlight':
          return { ...base, map: { center: [2.35, 46.5], zoom: 2.2, highlightCountries: ['France'] } };
        case 'location_pin':
          return { ...base, map: { center: [-87.63, 41.88], zoom: 2.2, markers: [markers[0]!] } };
        case 'map_zoom':
          return { ...base, map: { center: [-0.13, 51.51], zoom: 1.8, markers: [markers[1]!] } };
        default:
          return { ...base, map: { ...world, markers } };
      }
    }
    case 'video':
      return { ...base, media: 'clip', text: 'Behind every counter' };
    default:
      return { ...base, media: 'landscape', text: 'Behind every counter', focus: { x: 70, y: 40 } };
  }
}

/** One-shot plan demonstrating a skill. */
export function skillPreviewPlan(skill: MotionSkill, options: { fps?: number; assets?: AssetRegistry } = {}): ShotPlan {
  const fps = options.fps ?? 30;
  return { version: 1, fps, width: 1920, height: 1080, assets: options.assets ?? PREVIEW_ASSETS, shots: [previewShot(skill, fps)] };
}

/** Every available skill, one after the other (the Motion Library reel). */
export function skillGalleryPlan(registry: MotionSkillRegistry, options: { fps?: number; assets?: AssetRegistry } = {}): ShotPlan {
  const fps = options.fps ?? 30;
  return { version: 1, fps, width: 1920, height: 1080, assets: options.assets ?? PREVIEW_ASSETS, shots: registry.getAvailableMotionSkills().map((s) => previewShot(s, fps)), metadata: { id: 'motion-library' } };
}
