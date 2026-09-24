/**
 * EDITORIAL ANALYZER (heuristic). For every sentence of narration: what kind
 * of information it is (intent), how important, what it contains (numbers,
 * places, quote, words to emphasise), and WHY it was classified that way.
 *
 * Scores are ordinal levels 1–5, editorial heuristics — never measurements
 * (bible §0). The LLM analyzer of Phase 4 produces the same structure.
 */
import type { EditorialIntent, EditorialLevel } from '@studio-engine/scene-engine';
import { alignSentences, type SentenceTiming } from './align.js';
import { findPlaces } from './gazetteer.js';
import { CUES, emphasisWords, findCue, findNumbers, findQuote, splitSentences, tokenize } from './text.js';
import type { BrainInput, EditorialUnit, UnitHints } from './types.js';

const BASE_IMPORTANCE: Record<EditorialIntent, EditorialLevel> = {
  hook: 5,
  context: 2,
  fact: 2,
  important_fact: 4,
  keyword: 3,
  number: 4,
  statistic: 4,
  comparison: 4,
  quote: 3,
  proof: 4,
  location: 3,
  process: 3,
  contradiction: 4,
  revelation: 5,
  aftermath: 3,
  chapter: 3,
  conclusion: 4,
};

const SURPRISE: Partial<Record<EditorialIntent, EditorialLevel>> = { revelation: 5, contradiction: 4, hook: 4, number: 3, statistic: 3, comparison: 3 };
const VISUAL_POTENTIAL: Partial<Record<EditorialIntent, EditorialLevel>> = { number: 4, statistic: 5, comparison: 4, proof: 5, location: 4, revelation: 4, hook: 4, quote: 3 };

const level = (n: number): EditorialLevel => Math.max(1, Math.min(5, Math.round(n))) as EditorialLevel;

interface Sentence {
  text: string;
  words: string[];
  chapterIndex: number;
  hints?: UnitHints;
}

/** Sentences of the script, with the chapter they belong to. */
export function scriptSentences(input: Pick<BrainInput, 'script'>): { sentences: Sentence[]; chapters: Array<{ title: string; question?: string }> } {
  const sentences: Sentence[] = [];
  const chapters: Array<{ title: string; question?: string }> = [];
  for (const block of input.script) {
    if (block.kind === 'chapter') {
      chapters.push({ title: block.title, ...(block.question ? { question: block.question } : {}) });
      continue;
    }
    if (!chapters.length) chapters.push({ title: '' });
    const parts = splitSentences(block.text);
    // Hints describe the block: they go to its first sentence (usually the block IS one sentence).
    parts.forEach((text, i) => sentences.push({ text, words: tokenize(text), chapterIndex: chapters.length - 1, ...(block.hints && i === 0 ? { hints: block.hints } : {}) }));
  }
  return { sentences, chapters };
}

export function analyzeScript(input: BrainInput): EditorialUnit[] {
  const { sentences } = scriptSentences(input);
  const timings: SentenceTiming[] = alignSentences(
    sentences.map((s) => s.words),
    input.narration?.words ?? [],
  );
  const units: EditorialUnit[] = [];
  sentences.forEach((s, index) => {
    const t = timings[index]!;
    const numbers = s.hints?.number ? [] : findNumbers(s.words);
    const places = findPlaces(s.words);
    const quote = findQuote(s.text);
    const previous = units[index - 1];
    const isChapterStart = index === 0 || sentences[index - 1]!.chapterIndex !== s.chapterIndex;
    const isLast = index === sentences.length - 1;
    const { intent, why } = classify(s, { index, numbers: numbers.length || (s.hints?.number ? 1 : 0), places: places.length + (s.hints?.places?.length ?? 0), quote, previous: previous?.intent, isChapterStart, isLast });
    let importance = s.hints?.importance ?? BASE_IMPORTANCE[intent];
    const emphasis = s.hints?.highlightedWords ?? emphasisWords(s.words, s.text);
    if (!s.hints?.importance && s.words.some((w) => /^[A-Z]{3,}/.test(w))) importance = level(importance + 1);
    const density = level(1 + s.words.length / 6 + numbers.length + places.length);
    units.push({
      id: `u${index + 1}`,
      index,
      chapterIndex: s.chapterIndex,
      text: s.text,
      words: s.words,
      startMs: t.startMs,
      endMs: t.endMs,
      wordStartsMs: t.wordStartsMs,
      estimatedTiming: t.estimated,
      intent,
      importance,
      analysis: {
        surprise: SURPRISE[intent] ?? 2,
        informationDensity: density,
        visualPotential: VISUAL_POTENTIAL[intent] ?? 3,
        tension: 2,
        proofRequired: numbers.length > 0 || intent === 'revelation' || intent === 'contradiction',
      },
      entities: { numbers, emphasis: emphasis.slice(0, 2), places, ...(quote ? { quote } : {}) },
      why,
      ...(s.hints ? { hints: s.hints } : {}),
    });
  });
  applyTension(units);
  return units;
}

interface Context {
  index: number;
  numbers: number;
  places: number;
  quote?: string;
  previous?: EditorialIntent;
  isChapterStart: boolean;
  isLast: boolean;
}

/** First matching rule wins; `why` names the evidence. */
function classify(s: Sentence, c: Context): { intent: EditorialIntent; why: string } {
  const t = s.text;
  if (s.hints?.intent) return { intent: s.hints.intent, why: 'intent given by the author' };
  if (c.index === 0) return { intent: 'hook', why: 'first sentence of the video: the hook' };
  if (c.quote && c.quote.split(/\s+/).length >= 3) return { intent: 'quote', why: `quotes someone: “${c.quote.slice(0, 40)}”` };
  // Two revelations in a row dilute each other: the second one lets the first sink in.
  if (c.previous === 'revelation') return { intent: 'aftermath', why: 'follows a revelation: let it sink in' };
  const revelation = findCue(CUES.revelation, t);
  if (revelation) return { intent: 'revelation', why: `revelation cue "${revelation}"` };
  const contradiction = findCue(CUES.contradiction, t);
  if (contradiction) return { intent: 'contradiction', why: `contradiction cue "${contradiction}"` };
  const proof = findCue(CUES.proof, t);
  if (proof || s.hints?.document) return { intent: 'proof', why: proof ? `refers to a source ("${proof}")` : 'a document is attached' };
  if (s.hints?.chart) return { intent: 'statistic', why: 'chart data attached' };
  const growth = findCue(CUES.growth, t);
  const comparison = findCue(CUES.comparison, t);
  if (c.numbers >= 2 && comparison) return { intent: 'comparison', why: `compares figures ("${comparison}")` };
  if (c.numbers >= 2 && growth) return { intent: 'statistic', why: `figures that evolve ("${growth}")` };
  if (c.numbers >= 1) return { intent: 'number', why: 'contains a key figure' };
  // An evolution without figures still calls for a chart: the visual director will ask for the data.
  if (growth) return { intent: 'statistic', why: `describes an evolution ("${growth}")` };
  if (c.places >= 1 || s.hints?.map) return { intent: 'location', why: 'names a place' };
  const steps = (t.match(new RegExp(CUES.process.source, 'gi')) ?? []).length;
  if (steps >= 2) return { intent: 'process', why: 'describes steps' };
  if (c.isLast) return { intent: 'conclusion', why: 'last sentence: the conclusion' };
  if (s.words.length <= 3) return { intent: 'keyword', why: 'a few words said on their own' };
  if (s.words.length <= 6 || s.words.some((w) => /^[A-Z]{3,}/.test(w))) return { intent: 'important_fact', why: s.words.length <= 6 ? 'short, stressed statement' : 'a word written in capitals' };
  if (c.isChapterStart) return { intent: 'context', why: 'opens a chapter: sets the scene' };
  return { intent: 'fact', why: 'plain information' };
}

/** Tension rises towards each revelation of a chapter, then falls. */
function applyTension(units: EditorialUnit[]): void {
  for (const u of units) {
    const next = units.slice(u.index).find((x) => x.intent === 'revelation' && x.chapterIndex === u.chapterIndex);
    const distance = next ? next.index - u.index : Infinity;
    u.analysis.tension = distance === 0 ? 5 : distance === 1 ? 4 : distance <= 3 ? 3 : u.intent === 'contradiction' ? 3 : 2;
  }
}
