import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkHyperFramesUse,
  compileShotPlan,
  hyperframesLayerData,
  hyperframesPageUrl,
  hyperframesTimeAt,
  validateShotPlan,
  type HyperFramesCatalog,
  type ShotPlan,
} from '../src/index.js';
import { buildEpisodePlan } from './fixtures/shotplan-episode.js';
import { codes } from './helpers.js';

const catalog = JSON.parse(readFileSync(new URL('../hyperframes-catalog.json', import.meta.url), 'utf8')) as HyperFramesCatalog;

const plan = (fn: (p: ShotPlan) => void): ShotPlan => {
  const p = buildEpisodePlan();
  fn(p);
  return p;
};

describe('HyperFrames catalog', () => {
  it('holds the whole registry at the pinned commit', () => {
    expect(catalog.commit).toBe('8798e40');
    expect(catalog.items.filter((i) => i.type === 'block' && !i.source)).toHaveLength(165);
    expect(catalog.items.filter((i) => i.source === 'studio').map((i) => i.name)).toEqual(['studio-bars', 'studio-document', 'studio-image', 'studio-map', 'studio-stat', 'studio-title', 'studio-units']);
    expect(catalog.items.filter((i) => i.type === 'component')).toHaveLength(223);
    expect(new Set(catalog.items.map((i) => `${i.type}:${i.name}`)).size).toBe(catalog.items.length);
  });

  it('describes every item: page, duration, typed variables', () => {
    for (const i of catalog.items) {
      expect(i.path, i.name).toMatch(/^hyperframes\/(blocks|components)\/[^/]+\/[^/]+\.html$/);
      expect(i.duration, i.name).toBeGreaterThan(0);
      for (const v of i.variables) expect(typeof v.id, `${i.name}.${v.id}`).toBe('string');
    }
  });

  it('gives elastic components the host duration', () => {
    const elastic = catalog.items.find((i) => i.name === 'blur-in')!;
    expect(elastic.elasticDuration).toBe(true);
    expect(hyperframesLayerData({ item: 'blur-in' }, catalog, 2.5).duration).toBe(2.5);
    expect(hyperframesLayerData({ item: 'count-up' }, catalog, 2.5).duration).toBe(3);
  });

  it('gives elastic studio blocks the duration they play, from startAt', () => {
    const data = hyperframesLayerData({ item: 'studio-bars', startAt: 1, variables: { text: 'Rent' } }, catalog, 3.2);
    expect(data).toMatchObject({ itemType: 'block', duration: 4.2, variables: { text: 'Rent', duration: 4.2 } });
    expect(hyperframesPageUrl(data)).toMatch(/^hyperframes\/blocks\/studio-bars\/studio-bars\.html\?hfv=/);
  });

  it('lists embedded media so the rights can be checked (SRC-01)', () => {
    const withMedia = catalog.items.filter((i) => i.embeddedMedia.length).map((i) => i.name);
    expect(withMedia).toContain('nyc-paris-flight');
    expect(withMedia).not.toContain('data-chart');
  });
});

describe('checkHyperFramesUse', () => {
  const check = (use: unknown) => checkHyperFramesUse(use, 'u', catalog);

  it('accepts a valid use', () => {
    expect(check({ item: 'bar-chart-race', variables: { title: 'Rent income', barCount: 5 } })).toEqual([]);
  });

  it('rejects unknown items, bad variable types and bad boxes', () => {
    expect(check({ item: 'nope' }).map((i) => i.code)).toEqual(['hyperframes.unknown']);
    expect(check({ item: 'bar-chart-race', variables: { barCount: 'five' } }).map((i) => i.code)).toEqual(['hyperframes.variable.type']);
    expect(check({ item: 'count-up', variables: { accent: 'pink' } }).map((i) => i.code)).toEqual(['hyperframes.variable.type']);
    expect(check({ item: 'count-up', box: [0, 0, 120, 50] }).map((i) => i.code)).toEqual(['hyperframes.box']);
    expect(check({ item: 'count-up', type: 'block' }).map((i) => i.code)).toEqual(['hyperframes.type']);
  });

  it('rejects items that do not render headless, warns on files the registry does not ship', () => {
    expect(check({ item: 'frost-sequence-camera-orbit' }).map((i) => i.code)).toContain('hyperframes.unsupported');
    expect(check({ item: 'carousel-circle-1' }).map((i) => i.code)).toEqual(['hyperframes.missingFiles']);
  });

  it('mounts snippet blocks and renamed compositions from the host page', () => {
    const snippet = new URL(hyperframesPageUrl(hyperframesLayerData({ item: 'code-snippet-dark-2026' }, catalog)), 'http://x/');
    expect(snippet.pathname).toBe('/hyperframes/host.html');
    expect(snippet.searchParams.get('c')).toBe('vscode-dark-2026');
    expect(snippet.searchParams.get('src')).toBe('blocks/code-snippet-dark-2026/code-snippet-dark-2026.html');
    const renamed = new URL(hyperframesPageUrl(hyperframesLayerData({ item: 'caption-blend-difference' }, catalog)), 'http://x/');
    expect(renamed.searchParams.get('c')).toBe('root');
    expect(renamed.searchParams.get('src')).toBe('components/caption-blend-difference/caption-blend-difference.html');
  });

  it('warns on undeclared variables and on fixed-content blocks', () => {
    expect(check({ item: 'data-chart', variables: { title: 'x' } }).map((i) => i.code)).toEqual(['hyperframes.variable.unknown', 'hyperframes.fixedContent']);
  });

  it('checks structure only without a catalog', () => {
    expect(checkHyperFramesUse({ item: 'anything' }, 'u')).toEqual([]);
    expect(checkHyperFramesUse({ item: '' }, 'u').map((i) => i.code)).toEqual(['hyperframes.item']);
  });
});

describe('page URL and time mapping', () => {
  it('loads blocks directly with ?hfv= variables', () => {
    const data = hyperframesLayerData({ item: 'bar-chart-race', variables: { title: 'Rent' } }, catalog);
    expect(data).toMatchObject({ item: 'bar-chart-race', itemType: 'block', duration: 12 });
    expect(hyperframesPageUrl(data)).toBe(`hyperframes/blocks/bar-chart-race/bar-chart-race.html?hfv=${encodeURIComponent('{"title":"Rent"}')}`);
    expect(hyperframesPageUrl(hyperframesLayerData({ item: 'light-leak' }, catalog))).toBe('hyperframes/blocks/light-leak/light-leak.html');
  });

  it('mounts components in the host page', () => {
    const data = hyperframesLayerData({ item: 'count-up', variables: { end: 61 }, box: [10, 20, 80, 40], theme: { '--brand': '#ffc72c' } }, catalog);
    const url = new URL(hyperframesPageUrl(data), 'http://x/');
    expect(url.pathname).toBe('/hyperframes/host.html');
    expect(url.searchParams.get('c')).toBe('count-up');
    expect(JSON.parse(url.searchParams.get('v')!)).toEqual({ end: 61 });
    expect(url.searchParams.get('box')).toBe('10,20,80,40');
    expect(url.searchParams.get('d')).toBe('3');
  });

  it('maps frames to item time with startAt and speed, holding the last frame', () => {
    expect(hyperframesTimeAt({ item: 'x', startAt: 1, speed: 2 }, 30, 30)).toBe(3);
    expect(hyperframesTimeAt({ item: 'x', duration: 3 }, 300, 30)).toBeCloseTo(3 - 1 / 30);
  });
});

describe('Shot.block and Shot.overlays', () => {
  it('lets a block replace the type payload', () => {
    const p = plan((x) => {
      const stat = x.shots.find((s) => s.id === 'stat')!;
      delete stat.number;
      stat.block = { item: 'bar-chart-race', variables: { title: 'Rent income' } };
    });
    expect(codes(validateShotPlan(p, { hyperframes: catalog }).errors)).toEqual([]);
    const r = compileShotPlan(p, { hyperframes: catalog });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const scene = r.project.scenes.find((s) => s.id === 'stat')!;
    const block = scene.layers.find((l) => l.id === 'stat:block')!;
    expect(block).toMatchObject({ type: 'graphic', kind: 'hyperframes', data: { item: 'bar-chart-race', itemType: 'block', duration: 12 } });
    // The default counter is not composed, and the shot's motion skill is not applied to the block.
    expect(scene.layers.some((l) => l.id === 'stat:number')).toBe(false);
    expect(r.notes.some((n) => n.startsWith('stat: motion skill "number_pop" not applied'))).toBe(true);
    expect(r.validation.errors).toEqual([]);
  });

  it('reports unknown items against the catalog', () => {
    const p = plan((x) => { x.shots[0]!.block = { item: 'not-in-catalog' }; });
    expect(codes(validateShotPlan(p, { hyperframes: catalog }).errors)).toContain('hyperframes.unknown');
  });

  it('layers overlays in screen space, clamped to the shot, and flags embedded media', () => {
    const p = plan((x) => {
      x.shots.find((s) => s.id === 'counter')!.overlays = [
        { item: 'lt-clean-bar', startFrame: 15, durationInFrames: 500 },
        { item: 'organic-light-leak-overlay' },
      ];
    });
    const r = compileShotPlan(p, { hyperframes: catalog });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const scene = r.project.scenes.find((s) => s.id === 'counter')!;
    const lt = scene.layers.find((l) => l.id === 'counter:overlay-0')!;
    expect(lt).toMatchObject({ kind: 'hyperframes', startFrame: 15, durationInFrames: 105 - 15, screenSpace: true, zIndex: 50 });
    expect(r.notes.some((n) => n.includes('[SRC-01]') && n.includes('organic-light-leak-overlay'))).toBe(true);
    expect(r.validation.errors).toEqual([]);
  });
});
