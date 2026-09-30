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
  EXPLAINING_NEEDS,
  MEDIA_NEED_TIERS,
  MEDIA_TIERS,
  NATURE_TIER,
  REAL_SUBJECT_NEEDS,
  type AssetRegistry,
  type MediaNature,
  type MediaNeed,
  type MediaTier,
  type DocumentHighlight,
  type Framing,
  type ShotCameraMove,
  type Shot,
  type ShotType,
  type VisualHierarchy,
} from '@studio-engine/scene-engine';
import type { Chunk } from './rhythm.js';
import { isFrench, mediaNatureOf, subjectOf } from './media.js';
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
  /** Level of the authenticity scale used (bible §27). */
  tier?: MediaTier;
  /** Why this media: the need and the scale (goes into `reasons.media`). */
  mediaReason?: string;
}

/** Intents whose treatment is rhetorical or structural (the hook is the promise, stated): the grammar decides, not the scale. */
const GRAMMAR_ONLY: ReadonlySet<string> = new Set(['hook', 'keyword', 'number', 'statistic', 'comparison', 'quote', 'proof', 'location', 'contradiction', 'revelation', 'chapter']);

const TIER_LABEL: Record<MediaTier, string> = { real_video: 'real video', real_photo: 'real photo or archive', document: 'screenshot or document', data_viz: 'data visualisation', generated: 'generated visual', motion: 'motion design' };
const NEED_LABEL: Record<MediaNeed, string> = {
  explain_number: 'explains a figure',
  show_relation: 'shows a relation',
  connect_concepts: 'connects concepts',
  abstract_mechanism: 'explains a business mechanism',
  historical_context: 'historical context',
  introduce_entity: 'introduces a person, company or product',
  archival_evidence: 'archive or historical proof',
  human_behavior: 'shows human behaviour',
  product_in_use: 'shows a product in use',
  atmosphere: 'the setting matters',
  platform_reference: 'refers to a platform',
  financial_document: 'refers to a financial document',
  source_interface: 'a precise source or interface',
  none: 'no specific need',
};
const NEED_RULE: Partial<Record<MediaNeed, string>> = {
  explain_number: 'MED-03', show_relation: 'MED-03', connect_concepts: 'MED-03', abstract_mechanism: 'MED-03',
  historical_context: 'MED-04', introduce_entity: 'MED-04', archival_evidence: 'MED-04',
  human_behavior: 'MED-05', product_in_use: 'MED-05', atmosphere: 'MED-05',
  platform_reference: 'MED-06', financial_document: 'MED-06', source_interface: 'MED-06',
};

/** Tier of a shot the grammar produced (what the viewer sees). */
export function tierOfType(type: ShotType, nature?: MediaNature): MediaTier {
  if (nature) return NATURE_TIER[nature];
  switch (type) {
    case 'video':
      return 'real_video';
    case 'image':
      return 'real_photo';
    case 'document':
      return 'document';
    case 'number':
    case 'chart':
    case 'map':
      return 'data_viz';
    default:
      return 'motion';
  }
}

const stem = (w: string) => normalizeWord(w).replace(/(ies|es|s)$/, '');
const MAX_TEXT_WORDS = 12;

export class VisualDirector {
  private readonly entries: Array<CatalogEntry & { kind: string; tokens: Set<string>; isDocument: boolean; nature: MediaNature }>;
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
  constructor(assets: AssetRegistry, catalog: CatalogEntry[] | undefined, private readonly fps: number, private readonly motifBefore = Infinity, private readonly mapStyle?: { url: string; attribution: string }) {
    const byId = new Map((catalog ?? []).map((c) => [c.assetId, c]));
    this.entries = Object.values(assets)
      .filter((a) => a.kind === 'image' || a.kind === 'video' || a.kind === 'svg')
      .map((a) => {
        const meta = a.metadata as { description?: string; tags?: string[] } | undefined;
        const c = byId.get(a.id) ?? { assetId: a.id, ...(meta?.description ? { description: meta.description } : {}), ...(meta?.tags ? { tags: meta.tags } : {}) };
        const words = [...(c.description ?? '').split(/\s+/), ...(c.tags ?? []).flatMap((t) => t.split(/[\s:-]+/))];
        const nature = mediaNatureOf(a, c.nature, c.tags ?? []);
        return { ...c, kind: a.kind, nature, tokens: new Set(contentWords(words).map(stem)), isDocument: nature === 'document' || nature === 'screenshot' };
      });
  }

  /** Best asset of a kind for a sentence (score > 0 only: an unrelated image illustrates nothing, STORY-04). */
  private match(u: EditorialUnit, kinds: string[], opts: { document?: boolean; exclude?: string; natures?: readonly MediaNature[] } = {}): { assetId: string; description: string } | undefined {
    const words = new Set(contentWords([...u.words, ...u.entities.emphasis, ...u.entities.places.map((p) => p.name)]).map(stem));
    let best: { id: string; score: number; description: string } | undefined;
    for (const e of this.entries) {
      if (!kinds.includes(e.kind) || e.isDocument !== Boolean(opts.document) || e.assetId === opts.exclude) continue;
      if (opts.natures ? !opts.natures.includes(e.nature) : !this.allowed(u, e.nature)) continue;
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

  /** Whether a media of this nature may stand for the sentence (MED-07: never a generated visual for reality). */
  private allowed(u: EditorialUnit, nature: MediaNature): boolean {
    if (nature !== 'generated') return true;
    return !(u.mediaNeed && REAL_SUBJECT_NEEDS.includes(u.mediaNeed)) && u.intent !== 'proof';
  }

  /** The need, the level used and the rule, for `reasons.media`. */
  private mediaReason(u: EditorialUnit, tier: MediaTier, note?: string, support = false): string {
    const need = u.mediaNeed ?? 'none';
    // The rule of the need when the level answers it; the grammar's when the intent decided the key shot.
    const rule = support ? (NEED_RULE[need] ?? 'MED-01') : GRAMMAR_ONLY.has(u.intent) ? 'GRAM-01' : MEDIA_NEED_TIERS[need].includes(tier) || tier === 'motion' ? (NEED_RULE[need] ?? 'MED-01') : 'MED-01';
    return `${capitalize(NEED_LABEL[need])}${u.mediaWhy ? ` (${u.mediaWhy})` : ''} → ${TIER_LABEL[tier]} (${rule})${note ? `; ${note}` : ''}.`;
  }

  /**
   * Levels to try for a sentence: its need's preferred media first, then the
   * rest of the scale (MED-02). A document proves, it does not illustrate: it
   * is only tried when the need asks for one (DOC, MED-06).
   */
  private ladder(u: EditorialUnit): MediaTier[] {
    const need = u.mediaNeed ?? 'none';
    const preferred = MEDIA_NEED_TIERS[need];
    const rest = MEDIA_TIERS.filter((t) => !preferred.includes(t) && t !== 'document' && (t !== 'data_viz' || need === 'none'));
    return [...preferred, ...rest].filter((t) => t !== 'generated' || this.allowed(u, 'generated'));
  }

  /** Main visual of a sentence: the need decides, then the most authentic media that answers it (bible §27). */
  keyVisual(u: EditorialUnit, chunk: Chunk, shotId: string): Visual {
    const grammar = EDITORIAL_GRAMMAR[u.intent];
    const h = u.hints;
    const tag = (v: Visual, note?: string): Visual => {
      const tier = v.tier ?? tierOfType(v.type, v.media ? this.entries.find((e) => e.assetId === v.media)?.nature : undefined);
      return { ...v, tier, mediaReason: this.mediaReason(u, tier, note) };
    };
    if (u.intent === 'conclusion' && this.motif && !h?.media) {
      this.use(this.motif.assetId);
      return tag({ type: 'image', media: this.motif.assetId, reason: `Visual callback: ${this.motif.description} returns, now seen differently.` }, 'visual callback of the opening (CALL-02)');
    }
    // A media chosen by the author wins over the grammar and the scale.
    const forced = h?.media ? this.entries.find((e) => e.assetId === h.media) : undefined;
    if (forced) {
      const type: ShotType = forced.isDocument ? 'document' : forced.kind === 'video' ? 'video' : 'image';
      const v = this.tryType(type, u, chunk, shotId);
      if (v) return tag({ ...v, reason: `${v.reason} (media chosen by the author)` }, 'media chosen by the author');
    }
    // Rhetorical and structural intents keep their grammar (a figure builds up, a proof is a document…).
    if (GRAMMAR_ONLY.has(u.intent)) {
      for (const type of grammar.shotTypes) {
        const v = this.tryType(type, u, chunk, shotId);
        if (v) return tag(v, `${u.intent}: the grammar decides`);
      }
      return this.fallback(u, chunk, grammar.shotTypes[0]!, tag);
    }
    // Explaining: data or motion design carries it; an authentic media, if any, comes as support (MED-03).
    const need = u.mediaNeed ?? 'none';
    if (EXPLAINING_NEEDS.includes(need)) {
      for (const tier of MEDIA_NEED_TIERS[need]) {
        const v = this.tryTier(tier, u, chunk, shotId);
        if (v) return tag(v);
      }
    }
    // Showing: the most authentic media that shows what the sentence says, down the scale (MED-01).
    for (const tier of this.ladder(u)) {
      if (tier === 'motion') break;
      const v = this.tryTier(tier, u, chunk, shotId);
      if (v) return tag(v, tier === MEDIA_NEED_TIERS[need][0] || need === 'none' ? undefined : `no matching ${TIER_LABEL[MEDIA_NEED_TIERS[need][0]!]}`);
    }
    // Nothing authentic shows it: motion design, and say what to look for (MED-08).
    if (need !== 'none' && !EXPLAINING_NEEDS.includes(need)) this.requestAuthentic(u);
    else if (grammar.shotTypes[0] !== 'text' && grammar.shotTypes[0] !== 'revelation') this.requestAuthentic(u);
    return tag({ type: 'text', ...this.statement(u, chunk), reason: `${capitalize(u.why)}; no authentic media shows it, the statement carries it.` }, need === 'none' || EXPLAINING_NEEDS.includes(need) ? undefined : 'no authentic media available, asset requested');
  }

  /** The grammar's first type is missing: typography, and say what is missing. */
  private fallback(u: EditorialUnit, chunk: Chunk, wanted: ShotType, tag: (v: Visual, note?: string) => Visual): Visual {
    const need: AssetRequest['need'] = wanted === 'document' ? 'document' : wanted === 'chart' ? 'chart-data' : wanted === 'map' ? 'map-place' : wanted === 'video' ? 'video' : 'image';
    if (wanted !== 'text' && wanted !== 'revelation' && wanted !== 'number') this.request(u, need, describeNeed(need, u));
    return tag({ type: 'text', ...this.statement(u, chunk), reason: `${capitalize(u.why)}; no ${wanted} available, the statement carries it.` }, wanted !== 'text' && wanted !== 'revelation' ? `no ${wanted} available` : undefined);
  }

  /** One level of the scale for a sentence, if a media of that level shows it. */
  private tryTier(tier: MediaTier, u: EditorialUnit, chunk: Chunk, shotId: string): Visual | undefined {
    switch (tier) {
      case 'real_video':
        return this.tryType('video', u, chunk, shotId);
      case 'real_photo': {
        // History and archives: an archive first.
        if (u.mediaNeed === 'historical_context' || u.mediaNeed === 'archival_evidence') {
          const archive = this.match(u, ['image'], { natures: ['archive'] });
          if (archive) return this.stillImage(u, archive, shotId, 'real_photo');
        }
        return this.tryType('image', u, chunk, shotId);
      }
      case 'document':
        return this.tryType('document', u, chunk, shotId);
      case 'data_viz':
        return this.tryType('chart', u, chunk, shotId) ?? this.tryType('number', u, chunk, shotId) ?? this.tryType('map', u, chunk, shotId);
      case 'generated': {
        const m = this.match(u, ['image', 'video'], { natures: ['generated'] });
        if (!m) return undefined;
        const kind = this.entries.find((e) => e.assetId === m.assetId)!.kind;
        this.use(m.assetId);
        return { type: kind === 'video' ? 'video' : 'image', media: m.assetId, tier: 'generated', reason: `${capitalize(u.why)}: ${m.description} (generated visual).` };
      }
      case 'motion':
        return { type: 'text', ...this.statement(u, chunk), tier: 'motion', reason: `${capitalize(u.why)}.` };
    }
  }

  private stillImage(u: EditorialUnit, m: { assetId: string; description: string }, shotId: string, tier: MediaTier): Visual {
    this.use(m.assetId);
    if (!this.motif && u.index < this.motifBefore) this.motif = { assetId: m.assetId, shotId, description: m.description };
    return { type: 'image', media: m.assetId, tier, reason: `${capitalize(u.why)}: ${m.description}.` };
  }

  /** Secondary shot of a long sentence: another authentic media, most authentic first; else the words on screen. */
  supportVisual(u: EditorialUnit, chunk: Chunk, keyMedia: string | undefined, shotId: string): Visual {
    const exclude = keyMedia ? { exclude: keyMedia } : {};
    const image = u.hints?.media && u.hints.media !== keyMedia
      ? { assetId: u.hints.media, description: u.hints.media }
      : this.match(u, ['video'], { ...exclude, natures: ['real_video'] }) ?? this.match(u, ['image'], { ...exclude, natures: ['real_photo', 'archive'] }) ?? this.match(u, ['image', 'video'], exclude);
    if (image) {
      this.use(image.assetId);
      const asset = this.entries.find((e) => e.assetId === image.assetId)!;
      if (asset.kind === 'image' && !this.motif && u.index < this.motifBefore) this.motif = { assetId: image.assetId, shotId, description: image.description };
      const tier = NATURE_TIER[asset.nature];
      return { type: asset.kind === 'video' ? 'video' : 'image', media: image.assetId, tier, reason: `Keeps the sentence visual: ${image.description}.`, mediaReason: this.mediaReason(u, tier, 'support shot', true) };
    }
    const words = u.words.slice(chunk.from, Math.min(chunk.to, chunk.from + MAX_TEXT_WORDS));
    const text = words.join(' ').replace(/[.,;:!?…]+$/, '');
    // An explanation does not need a picture; a sentence that shows reality does (MED-08).
    if (!EXPLAINING_NEEDS.includes(u.mediaNeed ?? 'none')) this.requestAuthentic(u);
    return { type: 'text', text, tier: 'motion', reason: 'No related image: the spoken words carry the rest of the sentence.', mediaReason: this.mediaReason(u, 'motion', 'no authentic media for the support shot', true) };
  }

  /** Asks for the most authentic media of the sentence's need, in order of preference, with licensed sources (MED-08). */
  private requestAuthentic(u: EditorialUnit): void {
    const need = u.mediaNeed ?? 'none';
    const first = EXPLAINING_NEEDS.includes(need) || need === 'none' ? 'real_photo' : MEDIA_NEED_TIERS[need][0]!;
    const kind: AssetRequest['need'] = first === 'real_video' ? 'video' : first === 'document' ? 'document' : 'image';
    this.request(u, kind, describeAuthentic(need, u));
  }

  private tryType(type: ShotType, u: EditorialUnit, chunk: Chunk, shotId: string): Visual | undefined {
    const h = u.hints;
    switch (type) {
      case 'text':
      case 'revelation':
        return { type, ...this.statement(u, chunk), reason: capitalize(u.why) + '.' };
      case 'image':
      case 'video': {
        // The authentic levels only: a generated visual is its own level (tryTier).
        const m = h?.media ? { assetId: h.media, description: h.media } : this.match(u, [type], { natures: type === 'video' ? ['real_video'] : ['real_photo', 'archive'] });
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
        const map = h?.map ?? toMap(u, this.mapStyle);
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
          else this.request(u, 'document-region', isFrench(u.text) ? `la zone de « ${doc.description} » qui dit : « ${u.text} »` : `the region of "${doc.description}" that says: “${u.text}”`);
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
function toMap(u: EditorialUnit, style?: { url: string; attribution: string }): Shot['map'] | undefined {
  const places = u.entities.places.slice(0, 8);
  if (!places.length) return undefined;
  const lons = places.map((p) => p.coordinates[0]);
  const lats = places.map((p) => p.coordinates[1]);
  const span = Math.max(Math.max(...lons) - Math.min(...lons), (Math.max(...lats) - Math.min(...lats)) * 2);
  const zoom = places.length === 1 ? 3 : span > 120 ? 0.25 : span > 60 ? 0.6 : span > 25 ? 1.2 : 2;
  const center: [number, number] = [(Math.max(...lons) + Math.min(...lons)) / 2, (Math.max(...lats) + Math.min(...lats)) / 2];
  // One place and a tile style: down to the street (city_zoom).
  if (places.length === 1 && style) return { center, zoom: 12, style: style.url, attribution: style.attribution, markers: places.map((p) => ({ label: p.name, coordinates: p.coordinates })) };
  return { center, zoom, markers: places.map((p) => ({ label: p.name, coordinates: p.coordinates })) };
}

function describeNeed(need: AssetRequest['need'], u: EditorialUnit): string {
  const about = contentWords(u.words).slice(0, 6).join(' ');
  if (isFrench(u.text)) {
    const quote = `« ${u.text} »`;
    switch (need) {
      case 'document':
        return `un vrai document qui prouve : ${quote}`;
      case 'chart-data':
        return `les données derrière : ${quote} (libellés, valeurs, source)`;
      case 'map-place':
        return `le ou les lieux de : ${quote} (noms ou coordonnées)`;
      case 'video':
        return `une vidéo de : ${about}`;
      default:
        return `une image de : ${about}`;
    }
  }
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

/**
 * The authentic media to look for, in order of preference, and where to find
 * it under a licence (bible MED-08, SRC-01): in the language of the script.
 */
function describeAuthentic(need: MediaNeed, u: EditorialUnit): string {
  const subject = subjectOf(u.words, contentWords(u.words));
  const fr = isFrench(u.text);
  const quote = fr ? `« ${u.text} »` : `“${u.text}”`;
  const T: Record<MediaNeed, [string, string]> = {
    introduce_entity: [`une photo réelle de ${subject} (Wikimedia Commons, kit presse ou site officiel, licence vérifiée), sinon une vidéo`, `a real photo of ${subject} (Wikimedia Commons, press kit or official site, verified licence), else a video`],
    historical_context: [`une photo d'archive : ${subject} (Wikimedia Commons, archives, presse sous licence), sinon une vidéo d'époque`, `an archive photo: ${subject} (Wikimedia Commons, archives, licensed press), else period footage`],
    archival_evidence: [`une archive ou un document d'époque qui montre ${quote}`, `an archive or period document that shows ${quote}`],
    human_behavior: [`une vidéo réelle : ${subject} (vos rushes, Pexels, Pixabay), sinon une photo`, `real footage: ${subject} (your rushes, Pexels, Pixabay), else a photo`],
    product_in_use: [`une vidéo du produit utilisé : ${subject} (vos rushes, site du fabricant, Pexels), sinon une photo`, `footage of the product in use: ${subject} (your rushes, maker's site, Pexels), else a photo`],
    atmosphere: [`une vidéo d'ambiance : ${subject} (vos rushes, Pexels, Pixabay), sinon une photo`, `atmosphere footage: ${subject} (your rushes, Pexels, Pixabay), else a photo`],
    platform_reference: [`une capture d'écran de la plateforme citée : ${subject}`, `a screenshot of the platform: ${subject}`],
    financial_document: [`le document financier cité (rapport annuel, 10-K…) qui montre ${quote}`, `the financial document (annual report, 10-K…) that shows ${quote}`],
    source_interface: [`une capture d'écran de la source ou de l'interface : ${subject}`, `a screenshot of the source or interface: ${subject}`],
    explain_number: [`une photo réelle en plan secondaire : ${subject}`, `a real photo for the support shot: ${subject}`],
    show_relation: [`une photo réelle en plan secondaire : ${subject}`, `a real photo for the support shot: ${subject}`],
    connect_concepts: [`une photo réelle en plan secondaire : ${subject}`, `a real photo for the support shot: ${subject}`],
    abstract_mechanism: [`une photo réelle en plan secondaire : ${subject}`, `a real photo for the support shot: ${subject}`],
    none: [`une vidéo ou une photo réelle : ${subject} (vos rushes, Wikimedia Commons, Pexels)`, `real footage or a real photo: ${subject} (your rushes, Wikimedia Commons, Pexels)`],
  };
  return T[need][fr ? 0 : 1];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
