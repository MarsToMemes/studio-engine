/**
 * "apple" edit style: every shot the studio blocks can draw becomes a studio block
 * (HyperFrames compositions of packages/remotion/hyperframes-studio, SCENE_ENGINE.md §28.1),
 * with every word cued on the narration. Hard cuts, no burned-in captions.
 *
 * Facts are never invented: a share (studio-units), a rebuilt document (studio-document), a
 * strike-through and sources come from the author's hints (`UnitHints`), otherwise the shot
 * keeps the engine's own composition.
 */
import { getShotStartFrames, type HyperFramesUse, type JsonObject, type Shot, type ShotPlan, type TranscriptWord } from '@studio-engine/scene-engine';
import type { BrainInput, EditorialUnit } from '../types.js';

export type EditStyle = 'default' | 'apple';

const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'and', 'or', 'but', 'is', 'are', 'was', 'its', 'than', 'more', 'under', 'with', 'by', 'as', 'that', 'this', 'there', 'their', 'they', 'it', 'be']);
const NUMBER_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'trillion', 'point', 'percent']);

export const norm = (w: string): string => w.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const isNumeric = (w: string) => /\d/.test(w);
const isSpokenNumber = (w: string) => /\d/.test(w) || w.toLowerCase().replace(/[^a-z-]/g, '').split('-').some((p) => NUMBER_WORDS.has(p));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------
// Timing

/**
 * Timeline time (s) of a moment of the narration FILE (ms): the narration segment that
 * plays it (the unit's own, else the latest one starting before) + the offset in the file.
 */
export function narrationTimeline(plan: Pick<ShotPlan, 'fps' | 'narration'>, ms: number, unitId?: string): number {
  const segments = plan.narration?.segments;
  if (!segments?.length) return ms / 1000;
  const own = unitId ? segments.find((s) => s.id === unitId && s.sourceStartMs <= ms + 1 && ms < s.sourceEndMs + 1) : undefined;
  const seg = own ?? [...segments].filter((s) => s.sourceStartMs <= ms).sort((a, b) => b.sourceStartMs - a.sourceStartMs)[0] ?? segments[0]!;
  return seg.startFrame / plan.fps + (ms - seg.sourceStartMs) / 1000;
}

/**
 * Start (ms of the file) of each written word of a unit. The brain's alignment interpolates
 * numbers written as digits ("$9.8" is spoken "nine point eight"): they are snapped to the
 * first spoken number word after the previous word.
 */
export function unitWordStarts(unit: EditorialUnit, words: readonly TranscriptWord[] | undefined): number[] {
  const starts = [...unit.wordStartsMs];
  if (!words?.length || unit.estimatedTiming) return starts;
  for (let i = 0; i < unit.words.length; i++) {
    if (!isNumeric(unit.words[i]!)) continue;
    const after = i > 0 ? starts[i - 1]! + 1 : unit.startMs - 1;
    const spoken = words.find((w) => w.startMs >= after && w.startMs <= unit.endMs && isSpokenNumber(w.text));
    if (spoken) starts[i] = spoken.startMs;
  }
  return starts;
}

/** Times (ms) of display tokens, found in order among the unit's words (normalized match). */
export function locateTokens(tokens: readonly string[], unitWords: readonly string[], starts: readonly number[]): Array<number | undefined> {
  const out: Array<number | undefined> = [];
  let j = 0;
  for (let ti = 0; ti < tokens.length; ti++) {
    const n = norm(tokens[ti]!);
    const next = tokens[ti + 1] !== undefined ? norm(tokens[ti + 1]!) : undefined;
    let found = -1;
    // The first match whose next word matches too (a shot's text can start mid-sentence on a common word).
    for (let k = j; k < unitWords.length; k++) {
      if (norm(unitWords[k]!) !== n) continue;
      if (found < 0) found = k;
      if (next === undefined || (unitWords[k + 1] !== undefined && norm(unitWords[k + 1]!) === next)) {
        found = k;
        break;
      }
    }
    if (found >= 0) {
      out.push(starts[found]);
      j = found + 1;
    } else out.push(undefined);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Titles

interface TitleSpec {
  text: string;
  sizes: string;
  soft?: string;
  tokens: string[];
}

const cleanWord = (w: string) => w.replace(/[*~_|]/g, '');

/**
 * Lines, sizes and gold words of a title. Gold: the highlighted / emphasis words of the main
 * line, else its last word; a gold word takes the word before it when that is a content word
 * ("real estate", "prime land"). Lines: a comma splits a soft lead-in from the main line; a short
 * gold phrase at the end becomes the main line; otherwise two balanced lines from 22 characters.
 */
export function titleSpec(raw: string, gold: readonly string[], options: { maxLines?: number; maxChars?: number; extend?: boolean } = {}): TitleSpec {
  let text = raw.trim().replace(/^(and|but|so)\s+/i, '').replace(/[:;]\s*$/, '.');
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?…]$/.test(text)) text += '.';
  const words = text.split(/\s+/).map(cleanWord);
  const goldSet = new Set(gold.map(norm));
  const extend = options.extend ?? true;
  let lines: string[][];
  let soft = false;
  const comma = words.findIndex((w, i) => /,$/.test(w) && i < words.length - 1);
  const maxChars = options.maxChars ?? 22;
  if (options.maxLines && options.maxLines > 2) {
    lines = [];
    let cur: string[] = [];
    for (const w of words) {
      if (cur.length && [...cur, w].join(' ').length > maxChars) {
        lines.push(cur);
        cur = [];
      }
      cur.push(w);
    }
    if (cur.length) lines.push(cur);
  } else if (comma >= 0) {
    lines = [words.slice(0, comma + 1), words.slice(comma + 1)];
    soft = true;
  } else if (text.length > maxChars) {
    // Gold phrase at the end (≤ 2 words) after a short lead-in: lead-in + punch line.
    const main = goldMarks(words, goldSet, extend);
    const firstGold = main.findIndex((g) => g);
    if (firstGold >= Math.max(2, words.length - 2) && main.slice(firstGold).every(Boolean) && words.slice(0, firstGold).join(' ').length <= 24) {
      lines = [words.slice(0, firstGold), words.slice(firstGold)];
      soft = true;
    } else {
      let best = 1;
      for (let k = 1; k < words.length; k++) {
        const a = words.slice(0, k).join(' ').length;
        const b = words.slice(k).join(' ').length;
        const bestA = words.slice(0, best).join(' ').length;
        if (Math.abs(a - b) < Math.abs(bestA - words.slice(best).join(' ').length)) best = k;
      }
      lines = [words.slice(0, best), words.slice(best)];
    }
  } else lines = [words];
  const mainLines = soft ? lines.slice(1) : lines;
  const mainWords = mainLines.flat();
  const marks = goldMarks(mainWords, goldSet, extend);
  // Rebuild with markup; consecutive gold words share one mark ("*real estate.*").
  let k = 0;
  const rendered = lines.map((line, li) => {
    if (soft && li === 0) return line.join(' ');
    const lineMarks = line.map(() => marks[k++]!);
    const out: string[] = [];
    line.forEach((w, i) => {
      const open = lineMarks[i] && !lineMarks[i - 1];
      const close = lineMarks[i] && !lineMarks[i + 1];
      out.push(`${open ? '*' : ''}${w}${close ? '*' : ''}`);
    });
    return out.join(' ');
  });
  const sizes = lines.map((line, li) => {
    const len = line.join(' ').length;
    return soft && li === 0 ? Math.max(64, Math.min(86, Math.round(1700 / len))) : Math.max(96, Math.min(200, Math.round(2700 / len)));
  });
  return { text: rendered.join('|'), sizes: sizes.join(','), ...(soft ? { soft: '0' } : {}), tokens: words };
}

/** Gold words of a line: the given ones, else the last word; extended to the word before (and quantifiers). */
function goldMarks(words: readonly string[], gold: ReadonlySet<string>, extend: boolean): boolean[] {
  let marks = words.map((w) => gold.has(norm(w)));
  if (!marks.some(Boolean) && words.length) marks = words.map((_, i) => i === words.length - 1);
  return extend ? extendGold(words, marks) : marks;
}

const QUANTIFIERS = [['more', 'than'], ['less', 'than'], ['fewer', 'than'], ['nearly'], ['almost'], ['over'], ['about']];

function extendGold(words: readonly string[], marks: boolean[]): boolean[] {
  const out = [...marks];
  for (let i = 1; i < words.length; i++) {
    if (!marks[i] || marks[i - 1]) continue;
    // "more than half", "nearly a third": the quantifier belongs to the figure.
    const q = QUANTIFIERS.find((ws) => ws.every((w, k) => norm(words[i - ws.length + k] ?? '') === w));
    if (q) {
      for (let k = 1; k <= q.length; k++) out[i - k] = true;
      continue;
    }
    const prev = norm(words[i - 1]!);
    // A content word that is not a conjugated verb ("keeps", "makes"): an adjective or a noun.
    if (!FUNCTION_WORDS.has(prev) && !/s$/.test(prev) && !/,$/.test(words[i - 1]!)) out[i - 1] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Blocks

type Kind = 'title' | 'image' | 'stat' | 'bars' | 'document' | 'map' | 'units' | 'chapter';

interface Draft {
  shot: Shot;
  index: number;
  kind: Kind;
  unit?: EditorialUnit;
}

interface Ctx {
  plan: ShotPlan;
  starts: number[];
  input: BrainInput;
  units: Map<string, EditorialUnit>;
  words?: readonly TranscriptWord[];
}

function kindOf(shot: Shot, unit: EditorialUnit | undefined): Kind | undefined {
  switch (shot.type) {
    case 'text':
    case 'revelation':
      return unit?.hints?.share ? 'units' : 'title';
    case 'image':
      return 'image';
    case 'number':
      return 'stat';
    case 'chart':
      return shot.chart?.kind === 'barChart' ? 'bars' : undefined;
    case 'document':
      return unit?.hints?.documentCard ? 'document' : undefined;
    case 'map':
      return shot.map?.markers?.length ? 'map' : undefined;
    case 'chapter':
      return 'chapter';
    default:
      return undefined; // video: the engine's own composition
  }
}

/** Display tokens → cues (s) relative to `origin` (timeline s), from the unit's words. */
function cuesFor(ctx: Ctx, unit: EditorialUnit | undefined, tokens: readonly string[], origin: number): number[] {
  if (!unit || !ctx.plan.narration) return [];
  const starts = unitWordStarts(unit, ctx.words);
  const ms = locateTokens(tokens, unit.words, starts);
  const out: number[] = [];
  let last = 0.05;
  for (const m of ms) {
    const t = m === undefined ? last + 0.07 : Math.max(0.05, narrationTimeline(ctx.plan, m, unit.id) - origin);
    out.push(round3(t));
    last = t;
  }
  return out;
}

const cueOf = (ctx: Ctx, unit: EditorialUnit | undefined, token: string, origin: number): number | undefined => {
  if (!unit || !ctx.plan.narration) return undefined;
  const starts = unitWordStarts(unit, ctx.words);
  const i = unit.words.findIndex((w) => norm(w) === norm(token));
  return i < 0 ? undefined : round3(Math.max(0.05, narrationTimeline(ctx.plan, starts[i]!, unit.id) - origin));
};

const goldOf = (shot: Shot, unit: EditorialUnit | undefined) => [...(shot.highlightedWords ?? []), ...(unit?.entities.emphasis ?? [])];

/** Text a shot says: its own text, else its unit's sentence when the unit has only this shot. */
function spokenText(ctx: Ctx, d: Draft): string | undefined {
  if (d.shot.text) return d.shot.text;
  const siblings = ctx.plan.shots.filter((s) => s.metadata?.unit === d.shot.metadata?.unit);
  return d.unit && siblings.length === 1 ? d.unit.text : undefined;
}

function sourceLine(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return /^source/i.test(s) ? s : `Source: ${s.replace(/,\s*[^,]*table$/i, '')}`;
}

function unitPrefixSuffix(unit: string | undefined): { prefix: string; suffix: string } {
  if (!unit) return { prefix: '', suffix: '' };
  if (unit.includes('$')) return { prefix: '$', suffix: unit.replace('$', '').trim() };
  if (unit.includes('€')) return { prefix: '', suffix: `${unit.replace('€', '').trim()}€` };
  return { prefix: '', suffix: unit.length <= 2 ? unit : ` ${unit}` };
}

/** Builds the block of a run of shots (one block across them), cues relative to the run start. */
function buildBlock(ctx: Ctx, run: Draft[]): HyperFramesUse | undefined {
  const origin = ctx.starts[run[0]!.index]! / ctx.plan.fps;
  const main = run.find((d) => d.kind !== 'chapter' && d.kind !== 'title') ?? run[0]!;
  const lead = run.find((d) => d !== main && d.kind === 'title');
  const chapter = run.find((d) => d.kind === 'chapter' && d !== main);
  const isLast = run[run.length - 1]!.index === ctx.plan.shots.length - 1;
  const runSeconds = run.reduce((n, d) => n + d.shot.durationInFrames, 0) / ctx.plan.fps;
  const { shot, unit } = main;
  switch (main.kind) {
    case 'title': {
      const text = spokenText(ctx, main);
      if (!text) return undefined;
      const t = titleSpec(text, goldOf(shot, unit));
      const v: JsonObject = { text: t.text, sizes: t.sizes, ...(t.soft ? { soft: t.soft } : {}) };
      const cues = cuesFor(ctx, unit, t.tokens, origin);
      if (cues.length) v.cues = cues.join(',');
      const strike = unit?.hints?.strike;
      if (strike) {
        const idx = t.tokens.findIndex((w) => norm(w) === norm(strike));
        if (idx >= 0) {
          v.strike = idx;
          v.strikeAt = round3((cues[cues.length - 1] ?? 1) + 0.12);
        }
      }
      return { item: 'studio-title', variables: v };
    }
    case 'chapter': {
      const title = shot.text ?? '';
      const t = titleSpec(title, [], { extend: false });
      const kicker = shot.subtext ? shot.subtext.charAt(0).toUpperCase() + shot.subtext.slice(1).toLowerCase() : undefined;
      return { item: 'studio-title', variables: { text: t.text, sizes: t.sizes, ...(kicker ? { kicker } : {}), start: 0.25 } };
    }
    case 'image': {
      const asset = shot.media ? ctx.plan.assets[shot.media] : undefined;
      if (!asset || asset.kind !== 'image') return undefined;
      const v: JsonObject = { src: asset.src, window: 56, revealAt: shot.camera === 'pull_out' ? 0.1 : 0.15, zoom: shot.camera === 'pull_out' ? -0.08 : 0.12 };
      const text = spokenText(ctx, main);
      if (text) {
        const t = titleSpec(text, goldOf(shot, unit));
        Object.assign(v, { text: t.text, sizes: t.sizes, ...(t.soft ? { soft: t.soft } : {}) });
        const cues = cuesFor(ctx, unit, t.tokens, origin);
        if (cues.length) {
          v.cues = cues.join(',');
          const mainFirst = t.soft ? t.text.split('|')[0]!.split(/\s+/).length : 0;
          const deep = (cues[mainFirst] ?? cues[0]!) - (t.soft ? 0.25 : 0.2);
          v.dims = `${Math.min(0.9, Math.max(0.3, deep - 0.6))}:${t.soft ? 0.45 : 0.5}:0;${round3(Math.max(0.1, deep))}:0.86:10`;
        }
      }
      if (isLast) v.fadeOutAt = round3(runSeconds - 0.55);
      return { item: 'studio-image', variables: v };
    }
    case 'stat': {
      const n = shot.number;
      if (!n) return undefined;
      const numIdx = unit ? unit.words.findIndex(isNumeric) : -1;
      const before = unit && numIdx > 0 && numIdx <= 2 ? unit.words.slice(0, numIdx).join(' ') : '';
      const v: JsonObject = { to: n.value, suffix: n.suffix ?? '', prefix: n.prefix ?? '', decimals: n.decimals ?? 0, countDuration: 1.1 };
      if (n.from !== undefined) v.from = n.from;
      if (before) {
        v.kicker = before.charAt(0).toUpperCase() + before.slice(1);
        const k = cuesFor(ctx, unit, [unit!.words[0]!], origin)[0];
        if (k !== undefined) v.kickerAt = k;
      }
      if (unit && numIdx >= 0) {
        const c = cuesFor(ctx, unit, unit.words.slice(0, numIdx + 1), origin);
        if (c.length) v.countAt = c[c.length - 1]!;
      }
      v.ring = n.suffix === '%' && n.value <= 100 ? n.value : '';
      if (n.label) {
        const words = n.label.split(/\s+/);
        const t = titleSpec(n.label, goldOf(shot, unit).filter((g) => words.some((w) => norm(w) === norm(g))));
        v.label = t.text.replace(/^./, (c) => c.toLowerCase());
        const cues = cuesFor(ctx, unit, t.tokens, origin);
        if (cues.length) v.labelCues = cues.join(',');
      }
      const src = sourceLine(unit?.hints?.source);
      if (src) v.source = src;
      return { item: 'studio-stat', variables: v };
    }
    case 'bars': {
      const c = shot.chart!;
      const { prefix, suffix } = unitPrefixSuffix(c.unit);
      const decimals = Math.max(0, ...c.values.map((x) => (String(x).split('.')[1] ?? '').length));
      const v: JsonObject = { labels: c.labels.join(','), values: c.values.join(','), prefix, suffix, decimals };
      let titleEnd = 0.6;
      if (lead) {
        const t = titleSpec(spokenText(ctx, lead) ?? '', goldOf(lead.shot, lead.unit ?? unit));
        Object.assign(v, { text: t.text, sizes: '96' });
        const cues = cuesFor(ctx, lead.unit ?? unit, t.tokens, origin);
        if (cues.length) {
          v.cues = cues.join(',');
          titleEnd = cues[cues.length - 1]!;
        }
        if (c.title) v.kicker = c.title;
      } else if (c.title) Object.assign(v, { text: titleSpec(c.title, []).text, sizes: '96' });
      // A bar grows when its value is spoken, else in turn after the title.
      const spoken = unit ? unit.words.map((w, i) => ({ w, i })).filter(({ w }) => isNumeric(w)) : [];
      const barCues = c.values.map((val, i) => {
        const hit = spoken.find(({ w }) => Math.abs(Number(w.replace(/[^\d.]/g, '')) - val) < 1e-9);
        const at = hit ? cuesFor(ctx, unit, unit!.words.slice(0, hit.i + 1), origin).pop() : undefined;
        return at ?? round3(titleEnd + 0.25 + i * 0.8);
      });
      for (let i = 1; i < barCues.length; i++) if (barCues[i]! < barCues[i - 1]! + 0.4) barCues[i] = round3(barCues[i - 1]! + 0.6);
      v.barCues = barCues.join(',');
      if (c.values.length > 1 && c.values[0]) {
        const pct = Math.round(((c.values[c.values.length - 1]! - c.values[0]) / c.values[0]) * 100);
        v.delta = `${pct >= 0 ? '+' : ''}${pct}%`;
        const lastLabel = c.labels[c.labels.length - 1];
        const hit = unit && lastLabel ? unit.words.findIndex((w) => norm(w) === norm(lastLabel)) : -1;
        const at = hit >= 0 ? cuesFor(ctx, unit, unit!.words.slice(0, hit + 1), origin).pop() : undefined;
        v.deltaAt = at ?? round3(barCues[barCues.length - 1]! + 1.2);
      }
      const src = sourceLine((c as { source?: string }).source ?? unit?.hints?.chart?.source ?? unit?.hints?.source);
      if (src) v.source = src;
      return { item: 'studio-bars', variables: v };
    }
    case 'document': {
      const card = unit!.hints!.documentCard!;
      const marked = [...card.sentence.matchAll(/\*([^*]+)\*/g)].map((m) => m[1]!);
      const hc = marked.map((w) => cueOf(ctx, unit, w, origin) ?? 2);
      const rows = Array.isArray(card.rows) ? card.rows.map((r) => r.join(': ')).join('|') : card.rows ?? '';
      const v: JsonObject = {
        ...(card.header ? { header: card.header } : {}),
        ...(card.heading ? { heading: card.heading } : {}),
        sentence: card.sentence,
        highlightCues: hc.join(','),
        rows,
        rowsAt: hc.map((t) => round3(t + 0.35)).join(','),
        pushAt: 0.8,
        ...(card.column ? { column: card.column } : {}),
        ...(card.footnote ? { footnote: card.footnote } : {}),
      };
      const src = sourceLine(unit?.hints?.source ?? shot.document?.source);
      if (src) v.source = src;
      return { item: 'studio-document', variables: v };
    }
    case 'map': {
      const markers = shot.map!.markers!.map((m) => {
        const at = cueOf(ctx, unit, m.label ?? '', origin) ?? 1;
        return `${m.label}:${m.coordinates[0]}:${m.coordinates[1]}:${at}`;
      });
      const v: JsonObject = { markers: markers.join(';'), dotsAt: 0, zoom: 0.07 };
      if (chapter) {
        const t = titleSpec(chapter.shot.text ?? '', [], { extend: false, maxChars: 40 });
        Object.assign(v, { text: t.text, sizes: '76', titleAt: 0.15 });
        if (chapter.shot.subtext) v.kicker = chapter.shot.subtext.charAt(0).toUpperCase() + chapter.shot.subtext.slice(1).toLowerCase();
      }
      return { item: 'studio-map', variables: v };
    }
    case 'units': {
      const share = unit!.hints!.share!;
      const text = spokenText(ctx, main) ?? unit!.text;
      const t = titleSpec(text, goldOf(shot, unit), { maxLines: 3, maxChars: 20 });
      const v: JsonObject = { text: t.text, sizes: '88', total: share.of ?? 100, lit: share.value, litDuration: 0.8 };
      const cues = cuesFor(ctx, unit, t.tokens, origin);
      if (cues.length) v.cues = cues.join(',');
      // The units light up with the first word of the gold phrase.
      const firstGold = t.text.split(/\s+|\|/).findIndex((w) => w.startsWith('*'));
      const at = firstGold >= 0 ? cues[firstGold] : undefined;
      v.litAt = at ?? 1;
      v.counter = (share.of ?? 100) === 100 ? '%' : '';
      if (share.label) v.counterLabel = share.label;
      const src = sourceLine(unit?.hints?.source);
      if (src) v.source = src;
      return { item: 'studio-units', variables: v };
    }
  }
}

/** Groups consecutive shots drawn by one block (see `applyAppleStyle`). */
export function groupRuns(drafts: readonly (Draft | undefined)[], shots: readonly Shot[]): Draft[][] {
  const runs: Draft[][] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    if (!d) continue;
    const prev = runs[runs.length - 1];
    const last = prev?.[prev.length - 1];
    const adjacent = last && last.index === i - 1;
    const sameUnit = adjacent && last.shot.metadata?.unit !== undefined && last.shot.metadata?.unit === d.shot.metadata?.unit;
    const sameScene = adjacent && last.shot.sceneId === d.shot.sceneId;
    const merge =
      adjacent &&
      prev.length === 1 &&
      // A lead-in sentence and the chart it announces (same sentence).
      ((last.kind === 'title' && d.kind === 'bars' && sameUnit) ||
        // A chapter card becomes the title of the map that opens the chapter.
        (last.kind === 'chapter' && d.kind === 'map') ||
        // The same data block continued across two shots of a scene.
        (last.kind === d.kind && sameScene && ['map', 'bars', 'units', 'stat'].includes(d.kind)));
    if (merge) prev.push(d);
    else runs.push([d]);
  }
  void shots;
  return runs;
}

/**
 * Applies the style to a plan (in place). Returns the decisions, in plain language.
 * Shot starts do not move: a shot that was overlapped by a transition loses the overlap.
 */
export function applyAppleStyle(plan: ShotPlan, units: readonly EditorialUnit[], input: BrainInput): string[] {
  const decisions: string[] = [];
  const starts = getShotStartFrames(plan);
  plan.shots.forEach((s, i) => {
    if (i + 1 < plan.shots.length) s.durationInFrames = starts[i + 1]! - starts[i]!;
    if (s.transition && s.transition !== 'hard_cut') {
      s.transition = 'hard_cut';
      delete s.transitionDurationInFrames;
      s.reasons = { ...s.reasons!, transition: 'Apple style: a clean hard cut.' };
    }
  });
  if (plan.captions) plan.captions = { ...plan.captions, enabled: false };
  decisions.push('style apple: hard cuts (shot starts unchanged), no burned-in captions, studio blocks timed to the voice');

  const ctx: Ctx = { plan, starts, input, units: new Map(units.map((u) => [u.id, u])), ...(input.narration ? { words: input.narration.words } : {}) };
  const drafts = plan.shots.map((shot, index): Draft | undefined => {
    const unit = typeof shot.metadata?.unit === 'string' ? ctx.units.get(shot.metadata.unit) : undefined;
    const kind = kindOf(shot, unit);
    if (!kind) {
      decisions.push(`${shot.id}: ${shot.type} shot kept on the engine's composition (no studio block for it${shot.type === 'document' ? ': give hints.documentCard to rebuild the document' : ''})`);
      return undefined;
    }
    return { shot, index, kind, ...(unit ? { unit } : {}) };
  });
  for (const run of groupRuns(drafts, plan.shots)) {
    const block = buildBlock(ctx, run);
    if (!block) {
      decisions.push(`${run.map((d) => d.shot.id).join(' + ')}: no studio block (missing text or media), engine composition kept`);
      continue;
    }
    let offset = 0;
    for (const d of run) {
      d.shot.block = { ...block, ...(offset ? { startAt: round3(offset) } : {}) };
      delete d.shot.motionSkill;
      delete d.shot.camera;
      d.shot.reasons = { ...d.shot.reasons!, motion: `Studio block "${block.item}" (Apple style), timed to the voice${run.length > 1 ? `, one block across ${run.map((r) => r.shot.id).join(' + ')}` : ''}.` };
      offset += d.shot.durationInFrames / plan.fps;
    }
  }
  return decisions;
}
