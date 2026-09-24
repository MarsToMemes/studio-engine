/**
 * SHOT PLANNER + VISUAL DIRECTOR. For each shot: what the viewer sees (type,
 * media, text, data), what matters on screen (hierarchy), how it is framed
 * and how the camera moves.
 *
 * It never invents proof: no document, chart data or place it was not given
 * (bible SRC-05, DOC-06). When the grammar asks for something missing, the
 * shot falls back to typography and an asset request says what to provide.
 */
import {
  EDITORIAL_GRAMMAR,
  type AssetRegistry,
  type DocumentHighlight,
  type Framing,
  type ShotCameraMove,
  type Shot,
  type ShotType,
  type VisualHierarchy,
} from '@studio-engine/scene-engine';
import type { Chunk } from './rhythm.js';
import { contentWords, normalizeWord } from './text.js';
import type { AssetRequest, CatalogEntry, EditorialUnit } from './types.js';

export interface Visual {
  type: ShotType;
  media?: string;
  text?: string;
  highlightedWords?: string[];
  number?: Shot['number'];
  chart?: Shot['chart'];
  map?: Shot['map'];
  document?: Shot['document'];
  /** Why this image / type (goes into `reasons.shot`). */
  reason: string;
}

const stem = (w: string) => normalizeWord(w).replace(/(ies|es|s)$/, '');
const MAX_TEXT_WORDS = 12;

export class VisualDirector {
  private readonly entries: Array<CatalogEntry & { kind: string; tokens: Set<string>; isDocument: boolean }>;
  private readonly used = new Map<string, number>();
  private lastCamera: ShotCameraMove | undefined;
  /** First image of the video: the natural callback of the conclusion (bible CALL-02). */
  motif: { assetId: string; shotId: string; description: string } | undefined;
  readonly requests: AssetRequest[] = [];

  /**
   * `motifBefore`: only an image introduced before this sentence index can be
   * the callback of the conclusion (the first third of the video): a callback
   * repeats the beginning in a new context, not a shot seen a moment ago.
   */
  constructor(assets: AssetRegistry, catalog: CatalogEntry[] | undefined, private readonly fps: number, private readonly motifBefore = Infinity) {
    const byId = new Map((catalog ?? []).map((c) => [c.assetId, c]));
    this.entries = Object.values(assets)
      .filter((a) => a.kind === 'image' || a.kind === 'video' || a.kind === 'svg')
      .map((a) => {
        const meta = a.metadata as { description?: string; tags?: string[] } | undefined;
        const c = byId.get(a.id) ?? { assetId: a.id, ...(meta?.description ? { description: meta.description } : {}), ...(meta?.tags ? { tags: meta.tags } : {}) };
        const words = [...(c.description ?? '').split(/\s+/), ...(c.tags ?? []).flatMap((t) => t.split(/[\s:-]+/))];
        const tags = (c.tags ?? []).map((t) => t.toLowerCase());
        return { ...c, kind: a.kind, tokens: new Set(contentWords(words).map(stem)), isDocument: tags.some((t) => /document|report|rapport|pdf|filing/.test(t)) };
      });
  }

  /** Best asset of a kind for a sentence (score > 0 only: an unrelated image illustrates nothing, STORY-04). */
  private match(u: EditorialUnit, kinds: string[], opts: { document?: boolean; exclude?: string } = {}): { assetId: string; description: string } | undefined {
    const words = new Set(contentWords([...u.words, ...u.entities.emphasis, ...u.entities.places.map((p) => p.name)]).map(stem));
    let best: { id: string; score: number; description: string } | undefined;
    for (const e of this.entries) {
      if (!kinds.includes(e.kind) || e.isDocument !== Boolean(opts.document) || e.assetId === opts.exclude) continue;
      // The motif is kept for the callback of the conclusion: seen again too soon, it would mean nothing.
      if (this.motif?.assetId === e.assetId && u.intent !== 'conclusion') continue;
      const overlap = [...e.tokens].filter((t) => words.has(t)).length;
      if (!overlap) continue;
      const score = overlap - 0.75 * (this.used.get(e.assetId) ?? 0);
      if (!best || score > best.score) best = { id: e.assetId, score, description: e.description ?? e.assetId };
    }
    return best ? { assetId: best.id, description: best.description } : undefined;
  }

  private use(assetId: string): void {
    this.used.set(assetId, (this.used.get(assetId) ?? 0) + 1);
  }

  private request(u: EditorialUnit, need: AssetRequest['need'], description: string): void {
    if (!this.requests.some((r) => r.unitId === u.id && r.need === need)) this.requests.push({ unitId: u.id, need, description });
  }

  /** The sentence as an on-screen statement (≤ 12 words, TYPO-02). */
  private statement(u: EditorialUnit, chunk: Chunk): { text: string; highlightedWords?: string[] } {
    const words = u.words.length <= MAX_TEXT_WORDS ? u.words : u.words.slice(chunk.from, Math.min(chunk.to, chunk.from + MAX_TEXT_WORDS));
    const text = words.join(' ').replace(/[.,;:!?…]+$/, '');
    const shown = new Set(text.split(/\s+/).map(normalizeWord));
    const highlightedWords = u.entities.emphasis.filter((w) => shown.has(normalizeWord(w))).slice(0, 2);
    return { text, ...(highlightedWords.length ? { highlightedWords } : {}) };
  }

  /** Main visual of a sentence, following the grammar of its intent. */
  keyVisual(u: EditorialUnit, chunk: Chunk, shotId: string): Visual {
    const grammar = EDITORIAL_GRAMMAR[u.intent];
    const h = u.hints;
    if (u.intent === 'conclusion' && this.motif && !h?.media) {
      this.use(this.motif.assetId);
      return { type: 'image', media: this.motif.assetId, reason: `Visual callback: ${this.motif.description} returns, now seen differently.` };
    }
    // A media chosen by the author wins over the grammar's preferred type.
    const forced = h?.media ? this.entries.find((e) => e.assetId === h.media) : undefined;
    if (forced) {
      const type: ShotType = forced.isDocument ? 'document' : forced.kind === 'video' ? 'video' : 'image';
      const v = this.tryType(type, u, chunk, shotId);
      if (v) return { ...v, reason: `${v.reason} (media chosen by the author)` };
    }
    for (const type of grammar.shotTypes) {
      const v = this.tryType(type, u, chunk, shotId);
      if (v) return v;
    }
    // Nothing the grammar asks for is available: typography, and say what is missing.
    const wanted = grammar.shotTypes[0]!;
    const need: AssetRequest['need'] = wanted === 'document' ? 'document' : wanted === 'chart' ? 'chart-data' : wanted === 'map' ? 'map-place' : wanted === 'video' ? 'video' : 'image';
    if (wanted !== 'text' && wanted !== 'revelation' && wanted !== 'number') {
      this.request(u, need, describeNeed(need, u));
    }
    return { type: 'text', ...this.statement(u, chunk), reason: `${capitalize(u.why)}; no ${wanted} available, the statement carries it.` };
  }

  /** Secondary shot of a long sentence: another related image, else the words on screen. */
  supportVisual(u: EditorialUnit, chunk: Chunk, keyMedia: string | undefined, shotId: string): Visual {
    const image = u.hints?.media && u.hints.media !== keyMedia ? { assetId: u.hints.media, description: u.hints.media } : this.match(u, ['image', 'video'], keyMedia ? { exclude: keyMedia } : {});
    if (image) {
      this.use(image.assetId);
      const asset = this.entries.find((e) => e.assetId === image.assetId)!;
      if (asset.kind === 'image' && !this.motif && u.index < this.motifBefore) this.motif = { assetId: image.assetId, shotId, description: image.description };
      return { type: asset.kind === 'video' ? 'video' : 'image', media: image.assetId, reason: `Keeps the sentence visual: ${image.description}.` };
    }
    const words = u.words.slice(chunk.from, Math.min(chunk.to, chunk.from + MAX_TEXT_WORDS));
    const text = words.join(' ').replace(/[.,;:!?…]+$/, '');
    this.request(u, 'image', describeNeed('image', u));
    return { type: 'text', text, reason: 'No related image: the spoken words carry the rest of the sentence.' };
  }

  private tryType(type: ShotType, u: EditorialUnit, chunk: Chunk, shotId: string): Visual | undefined {
    const h = u.hints;
    switch (type) {
      case 'text':
      case 'revelation':
        return { type, ...this.statement(u, chunk), reason: capitalize(u.why) + '.' };
      case 'image':
      case 'video': {
        const m = h?.media ? { assetId: h.media, description: h.media } : this.match(u, [type]);
        if (!m) return undefined;
        this.use(m.assetId);
        if (type === 'image' && !this.motif && u.index < this.motifBefore) this.motif = { assetId: m.assetId, shotId, description: m.description };
        return { type, media: m.assetId, reason: `${capitalize(u.why)}: ${m.description}.` };
      }
      case 'number': {
        const n = h?.number ?? toNumber(u);
        return n ? { type, number: n, reason: `${capitalize(u.why)}: ${u.entities.numbers[0]?.text ?? n.value}.` } : undefined;
      }
      case 'chart':
        if (!h?.chart) return undefined; // never invent data
        return { type, chart: { kind: h.chart.kind, labels: h.chart.labels, values: h.chart.values, ...(h.chart.unit ? { unit: h.chart.unit } : {}), ...(h.chart.title ? { title: h.chart.title } : {}) }, reason: `${capitalize(u.why)}: the data builds with the voice.` };
      case 'map': {
        const map = h?.map ?? toMap(u);
        return map ? { type, map, reason: `${capitalize(u.why)}: ${u.entities.places.map((p) => p.name).join(', ') || 'the place'} on the map.` } : undefined;
      }
      case 'document': {
        const doc = h?.media ? { assetId: h.media, description: h.media } : this.match(u, ['image'], { document: true });
        if (!doc) return undefined;
        this.use(doc.assetId);
        const document: NonNullable<Shot['document']> = { ...(h?.document ?? {}) };
        const entry = this.entries.find((e) => e.assetId === doc.assetId);
        if (!document.source && entry?.description) document.source = entry.description;
        if (!document.highlights) {
          const highlights = this.regions(u, chunk, entry);
          if (highlights.length) document.highlights = highlights;
          else this.request(u, 'document-region', `the region of "${doc.description}" that says: “${u.text}”`);
        }
        return { type, media: doc.assetId, document, reason: `${capitalize(u.why)}: ${doc.description} proves it.` };
      }
      default:
        return undefined;
    }
  }

  /** Catalogued regions of a document that the sentence reads, timed on the voice (DOC-03). */
  private regions(u: EditorialUnit, chunk: Chunk, entry: CatalogEntry | undefined): DocumentHighlight[] {
    const out: DocumentHighlight[] = [];
    const spoken = u.words.map((w) => stem(w));
    for (const r of entry?.regions ?? []) {
      const regionWords = new Set(contentWords(r.text.split(/\s+/)).map(stem));
      const first = spoken.findIndex((w, i) => i >= chunk.from && regionWords.has(w));
      const overlap = spoken.filter((w) => regionWords.has(w)).length;
      if (first < 0 || overlap < 2) continue;
      const at = Math.max(0, Math.round(((u.wordStartsMs[first]! - u.wordStartsMs[chunk.from]!) / 1000) * this.fps));
      out.push({ x: r.x, y: r.y, width: r.width, height: r.height, at });
    }
    return out;
  }

  hierarchy(v: Visual, u: EditorialUnit): VisualHierarchy {
    const describe = (id?: string) => (id ? (this.entries.find((e) => e.assetId === id)?.description ?? id) : 'image');
    switch (v.type) {
      case 'text':
      case 'revelation':
        return { primary: 'statement', ...(v.highlightedWords?.length ? { secondary: `emphasised: ${v.highlightedWords.join(', ')}` } : {}), background: 'dark texture' };
      case 'number':
        return { primary: `${v.number!.prefix ?? ''}${v.number!.value}${v.number!.suffix ?? ''}`, ...(v.number!.label ? { secondary: v.number!.label } : {}) };
      case 'chart':
        return { primary: v.chart!.title ?? 'chart', secondary: 'key value' };
      case 'map':
        return { primary: 'map', secondary: u.entities.places.map((p) => p.name).join(', ') || 'place' };
      case 'document':
        return { primary: describe(v.media), ...(v.document?.highlights?.length ? { secondary: 'highlighted line' } : {}), background: 'dark texture' };
      case 'chapter':
        return { primary: 'chapter title', background: 'black' };
      default:
        return { primary: describe(v.media) };
    }
  }

  /** Framing of stills: wide to establish, medium otherwise. */
  framing(v: Visual, firstImageOfScene: boolean, u: EditorialUnit): Framing | undefined {
    if (v.type !== 'image') return undefined;
    return firstImageOfScene || u.intent === 'conclusion' || u.intent === 'location' ? 'wide' : 'medium';
  }

  /**
   * Camera with a reason (CAM-01): stills move, alternating directions so two
   * shots never repeat the same move (CAM-06, REP-04); the conclusion pulls
   * out; typography stays still except the punch of a hook or a revelation.
   */
  camera(v: Visual, u: EditorialUnit, skillControlsCamera: boolean): { move?: ShotCameraMove; why?: string } {
    if (skillControlsCamera) return {};
    if (v.type === 'image' || v.type === 'video') {
      if (u.intent === 'conclusion') return this.take('pull_out', 'Pulling out reveals the whole picture: the story closes.');
      const options: ShotCameraMove[] = v.type === 'video' ? ['static'] : ['push_in', 'pan_right', 'pan_left'];
      const move = options.find((m) => m !== this.lastCamera) ?? options[0]!;
      if (move === 'static') return {};
      return this.take(move, move === 'push_in' ? 'A slow push keeps the still alive and draws the eye in.' : 'A slow pan explores the image instead of freezing it.');
    }
    if ((u.intent === 'hook' || u.intent === 'revelation') && (v.type === 'text' || v.type === 'revelation')) return this.take('punch_in', 'A punch-in lands the key word.');
    return {};
  }

  private take(move: ShotCameraMove, why: string): { move: ShotCameraMove; why: string } {
    this.lastCamera = move;
    return { move, why };
  }
}

function toNumber(u: EditorialUnit): Shot['number'] | undefined {
  const n = u.entities.numbers[0];
  if (!n) return undefined;
  const label = n.label ? n.label.split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:!?…]+$/, '') : undefined;
  return { value: n.value, ...(n.prefix ? { prefix: n.prefix } : {}), ...(n.suffix ? { suffix: n.suffix === '%' ? '%' : n.suffix } : {}), ...(label ? { label } : {}) };
}

/**
 * Frames every place: the centre of their bounding box, and a zoom that fits
 * its span (0.25 shows the whole world in the reference map renderer).
 */
function toMap(u: EditorialUnit): Shot['map'] | undefined {
  const places = u.entities.places.slice(0, 8);
  if (!places.length) return undefined;
  const lons = places.map((p) => p.coordinates[0]);
  const lats = places.map((p) => p.coordinates[1]);
  const span = Math.max(Math.max(...lons) - Math.min(...lons), (Math.max(...lats) - Math.min(...lats)) * 2);
  const zoom = places.length === 1 ? 3 : span > 120 ? 0.25 : span > 60 ? 0.6 : span > 25 ? 1.2 : 2;
  const center: [number, number] = [(Math.max(...lons) + Math.min(...lons)) / 2, (Math.max(...lats) + Math.min(...lats)) / 2];
  return { center, zoom, markers: places.map((p) => ({ label: p.name, coordinates: p.coordinates })) };
}

function describeNeed(need: AssetRequest['need'], u: EditorialUnit): string {
  const about = contentWords(u.words).slice(0, 6).join(' ');
  switch (need) {
    case 'document':
      return `a real document that proves: “${u.text}”`;
    case 'chart-data':
      return `the data behind: “${u.text}” (labels, values, source)`;
    case 'map-place':
      return `the place(s) of: “${u.text}” (names or coordinates)`;
    case 'video':
      return `footage of: ${about}`;
    default:
      return `an image of: ${about}`;
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
