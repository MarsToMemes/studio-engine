/**
 * MEDIA SELECTION (bible §27): what a sentence needs the picture to do, and
 * what each media file is.
 *
 * The need is decided before the authenticity scale (MED-02). These rules are
 * the offline fallback, in English and French: with a key, Claude decides the
 * need of every sentence (llm/story.ts) and these only fill the gaps.
 */
import { MEDIA_NATURES, type Asset, type EditorialIntent, type MediaNature, type MediaNeed } from '@studio-engine/scene-engine';
import { isStopword, normalizeWord } from './text.js';
import type { NumberEntity } from './types.js';

const cue = (words: string) => new RegExp(`(?:^|[\\s,;:(«"'’])(${words})(?=$|[\\s,.;:!?)»"])`, 'i');

/** Evidence of each need, strongest first. */
const NEED_CUES: Array<[MediaNeed, RegExp]> = [
  ['financial_document', cue("annual reports?|10-k|10-q|financial statements?|balance sheet|earnings report|income statement|sec filings?|filings?|prospectus|rapports? annuels?|bilans?|comptes annuels|états financiers|compte de résultat|document de référence|résultats (?:annuels|trimestriels|financiers)")],
  ['platform_reference', cue("youtube|tiktok|instagram|facebook|twitter|linkedin|snapchat|reddit|amazon|netflix|spotify|uber|airbnb|shopify|google|app store|play store|website|web site|platform|platforms|social network|app|apps|site web|site internet|plateformes?|réseaux? sociaux?|appli|applis|application|applications")],
  ['source_interface', cue("interface|dashboard|homepage|home page|screen|screenshot|tweet|tweets|posts?|headline|article|press release|tableau de bord|page d'accueil|écran|capture d'écran|publication|communiqué|gros titre|une du journal")],
  ['archival_evidence', cue("archives?|archive footage|old photo|period document|photo d'époque|images d'archives?|document d'époque|vieille photo")],
  ['historical_context', cue("history|historic|historical|century|centuries|in the (?:19|20)?\\d0s|back then|at the time|decades ago|founded|was born|histoire|historique|siècles?|dans les années|à l'époque|autrefois|jadis|il y a \\d+ ans|fondée?s?|créée?s? en|est née?|après-guerre|avant-guerre")],
  ['abstract_mechanism', cue("business model|model|mechanism|system|works like|how it works|in exchange|in return|royalties|royalty|rent|fees?|commissions?|margins?|cash flow|pay|paid|paying|charges?|modèle économique|modèle|mécanisme|système|fonctionne|en échange|en contrepartie|redevances?|loyers?|commissions?|marges?|reversent|reverse|paient|payent|paie|facture|facturent")],
  ['show_relation', cue("because|therefore|which means|the more|depends on|linked to|relationship|between|so that|parce que|donc|ce qui veut dire|plus .+ plus|dépend de|lié à|liée à|relation|entre")],
  ['connect_concepts', cue("ecosystem|network of|combines?|connects?|at the same time|both|together|écosystème|réseau de|combine|relie|à la fois|en même temps|ensemble")],
  ['human_behavior', cue("customers?|clients?|people|consumers?|shoppers?|employees?|workers?|staff|crowds?|families|kids|children|queue|line up|wait(?:s|ing)?|buy(?:s|ing)?|eat(?:s|ing)?|orders|ordering|gens|consommateurs?|acheteurs?|employés?|salariés?|travailleurs?|foule|familles?|enfants|file d'attente|attendent|achètent|mangent|commandent|travaillent")],
  ['product_in_use', cue("uses?|using|used to|tries|trying|drives?|driving|wears?|wearing|opens?|swipes?|scroll(?:s|ing)?|cooks?|cooking|prepares?|utilise|utilisent|utiliser|essaie|essayent|conduit|conduisent|porte|portent|ouvre|ouvrent|cuisine|cuisinent|prépare|préparent")],
  ['atmosphere', cue("night|city|cities|streets?|atmosphere|mood|lights|landscape|restaurants?|counter|factory|factories|office|store|stores|shop|shops|warehouse|harbou?r|port|airport|kitchen|nuit|villes?|rues?|ambiance|atmosphère|lumières|paysage|comptoirs?|usines?|bureaux?|magasins?|boutiques?|entrepôts?|aéroport|cuisine")],
];

/** Words that introduce a person, a company or a product. */
const ENTITY_CUE = cue("founder|co-founder|ceo|boss|owner|inventor|creator|brand|company|companies|firm|group|product|fondateur|cofondateur|pdg|patron|propriétaire|inventeur|créateur|marque|entreprise|société|groupe|produit");

/** A proper noun: capitalised, not a function word, not the first word unless it is clearly a name. */
function properNouns(words: readonly string[], places: ReadonlySet<string>): string[] {
  const out: string[] = [];
  words.forEach((raw, i) => {
    const w = raw.replace(/^[«"'(]+|[»"'),.;:!?…]+$/g, '');
    if (!/^[A-ZÀ-Ý][\p{L}’'-]{1,}/u.test(w) || places.has(normalizeWord(w))) return;
    const nameLike = /[’']s$|[a-zà-ÿ][A-Z]/.test(w) || /^[A-ZÀ-Ý][\p{L}’'-]+$/u.test(words[i + 1] ?? '');
    if (i === 0 && (!nameLike || isStopword(w))) return;
    if (isStopword(w)) return;
    if (/^(The|A|An|It|This|That|They|We|He|She|Le|La|Les|Un|Une|Des|Il|Elle|Ils|Elles|On|Nous|Ce|Cette|Ces|Et|Mais|Derrière|Plus|Chaque|Pour|Dans)$/.test(w)) return;
    out.push(w);
  });
  return out;
}

export interface NeedInput {
  text: string;
  words: readonly string[];
  intent: EditorialIntent;
  numbers: readonly NumberEntity[];
  places: ReadonlyArray<{ name: string }>;
}

/** The need of a sentence and the evidence for it (heuristic, MED-03..06). */
export function detectMediaNeed(s: NeedInput): { need: MediaNeed; why: string } {
  if (s.intent === 'chapter' || s.intent === 'quote') return { need: 'none', why: `${s.intent}: shown as such` };
  const hit = (need: MediaNeed) => NEED_CUES.find(([n]) => n === need)![1].exec(s.text)?.[1];
  for (const need of ['financial_document', 'platform_reference', 'source_interface'] as const) {
    const w = hit(need);
    if (w) return { need, why: `mentions "${w}"` };
  }
  if (s.numbers.length) return { need: 'explain_number', why: `explains the figure "${s.numbers[0]!.text}"` };
  for (const need of ['archival_evidence', 'historical_context', 'abstract_mechanism', 'show_relation', 'connect_concepts'] as const) {
    const w = hit(need);
    if (w) return { need, why: `mentions "${w}"` };
  }
  const years = s.text.match(/\b(1[5-9]\d\d|20[01]\d)\b/);
  if (years) return { need: 'historical_context', why: `dates back to ${years[1]}` };
  for (const need of ['human_behavior', 'product_in_use'] as const) {
    const w = hit(need);
    if (w) return { need, why: `mentions "${w}"` };
  }
  const names = properNouns(s.words, new Set(s.places.map((p) => normalizeWord(p.name))));
  const entity = ENTITY_CUE.exec(s.text)?.[1];
  if (names.length || entity) return { need: 'introduce_entity', why: names.length ? `names ${names.slice(0, 2).join(', ')}` : `introduces a ${entity}` };
  const w = hit('atmosphere');
  if (w) return { need: 'atmosphere', why: `mentions "${w}"` };
  if (s.intent === 'proof') return { need: 'source_interface', why: 'proof: a precise source' };
  return { need: 'none', why: 'no specific need: the authenticity scale in order' };
}

/** Subject of a sentence for an asset request: its proper nouns, else its first content words. */
export function subjectOf(words: readonly string[], content: readonly string[]): string {
  const names = properNouns(words, new Set());
  return (names.length ? names.slice(0, 3) : content.slice(0, 6)).join(' ').replace(/[.,;:!?…]+$/, '');
}

/**
 * What a media file is (bible §27): its declared nature, else the synthetic
 * flag of its rights, its tags, its kind.
 */
export function mediaNatureOf(asset: Pick<Asset, 'kind' | 'nature' | 'source'>, declared?: MediaNature, tags: readonly string[] = []): MediaNature {
  const n = declared ?? asset.nature;
  if (n && (MEDIA_NATURES as readonly string[]).includes(n)) return n;
  if (asset.source?.syntheticMedia) return 'generated';
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => /generated|ai image|généré|image ia/.test(x))) return 'generated';
  if (t.some((x) => /screenshot|capture|interface|website|site web/.test(x))) return 'screenshot';
  if (t.some((x) => /document|report|rapport|pdf|filing|10-k/.test(x))) return 'document';
  if (t.some((x) => /archive|historical|historique|d'époque/.test(x))) return 'archive';
  return asset.kind === 'video' ? 'real_video' : 'real_photo';
}

/** French or English, from the function words of a text (asset requests speak the script's language). */
export function isFrench(text: string): boolean {
  const words = text.toLowerCase().split(/[^\p{L}']+/u);
  const fr = words.filter((w) => /^(le|la|les|des|une|est|sont|du|et|que|qui|pour|dans|avec|pas|sur|au|aux|ce|cette|leurs?|l'|d'|c'est|n'est)$/.test(w)).length;
  const en = words.filter((w) => /^(the|of|and|is|are|to|in|that|with|for|on|its|their|this|it's|isn't)$/.test(w)).length;
  return fr > en;
}
