/**
 * The contract between the LLM and the brain: the tool schema, a strict
 * validator whose messages are written for a repair turn, and the merge of
 * an accepted answer into the deterministic story.
 *
 * The LLM decides intents, emphasis, scores, scenes, beats and purposes. It
 * never provides timing, figures or data: those stay deterministic.
 * Author hints always win over the LLM.
 */
import { BEATS, normalizeWord, RESOLVING_BEATS, type Beat, type EditorialIntent, type EditorialLevel } from '@studio-engine/scene-engine';
import type { Story } from '../direct.js';
import { architectStory } from '../architect.js';
import { lookupPlace } from '../gazetteer.js';
import { SENTENCE_INTENTS } from './prompt.js';

export const STORY_TOOL_NAME = 'submit_editorial_story';

const level = { type: 'integer', minimum: 1, maximum: 5 };

export const STORY_TOOL = {
  name: STORY_TOOL_NAME,
  description: 'Submit the editorial analysis and the scene structure of the whole script.',
  inputSchema: {
    type: 'object',
    required: ['sentences', 'scenes'],
    properties: {
      sentences: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'intent', 'importance', 'why', 'emphasis'],
          properties: {
            id: { type: 'string' },
            intent: { type: 'string', enum: [...SENTENCE_INTENTS] },
            importance: level,
            surprise: level,
            tension: level,
            informationDensity: level,
            visualPotential: level,
            emotion: { type: 'string' },
            proofRequired: { type: 'boolean' },
            emphasis: { type: 'array', items: { type: 'string' }, maxItems: 2 },
            why: { type: 'string' },
            media: { type: ['string', 'null'] },
            places: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['sentenceIds', 'beats', 'purpose'],
          properties: {
            sentenceIds: { type: 'array', items: { type: 'string' } },
            beats: { type: 'array', items: { type: 'string', enum: [...BEATS] } },
            purpose: { type: 'string' },
          },
        },
      },
      chapterQuestions: { type: 'array', items: { type: 'object', required: ['chapter', 'question'], properties: { chapter: { type: 'integer' }, question: { type: 'string' } } } },
    },
  },
} as const;

export interface LlmSentence {
  id: string;
  intent: EditorialIntent;
  importance: EditorialLevel;
  surprise?: EditorialLevel;
  tension?: EditorialLevel;
  informationDensity?: EditorialLevel;
  visualPotential?: EditorialLevel;
  emotion?: string;
  proofRequired?: boolean;
  emphasis: string[];
  why: string;
  media?: string | null;
  places?: string[];
}

export interface LlmScene {
  sentenceIds: string[];
  beats: Beat[];
  purpose: string;
}

export interface CheckedStory {
  /** Sentences that passed, by id. */
  sentences: Map<string, LlmSentence>;
  /** Accepted scenes (all or nothing: a structure is consistent as a whole). */
  scenes?: LlmScene[];
  chapterQuestions: Map<number, string>;
  /** Problems, phrased for the model. Empty = fully accepted. */
  errors: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLevel = (v: unknown): v is EditorialLevel => v === 1 || v === 2 || v === 3 || v === 4 || v === 5;

/** Validates the model's answer against the script it was given. */
export function checkStory(raw: unknown, story: Story, catalogIds: ReadonlySet<string>): CheckedStory {
  const out: CheckedStory = { sentences: new Map(), chapterQuestions: new Map(), errors: [] };
  const units = story.units;
  if (!isObj(raw)) {
    out.errors.push('the answer must be an object with "sentences" and "scenes"');
    return out;
  }
  // Sentences.
  const sentences = Array.isArray(raw.sentences) ? raw.sentences : [];
  const ids = sentences.map((s) => (isObj(s) ? s.id : undefined));
  const expected = units.map((u) => u.id);
  if (ids.join() !== expected.join()) out.errors.push(`"sentences" must list every sentence exactly once, in order: ${expected.join(', ')} (got ${ids.join(', ') || 'nothing'})`);
  for (const s of sentences) {
    if (!isObj(s) || typeof s.id !== 'string') continue;
    const u = units.find((x) => x.id === s.id);
    if (!u) continue;
    const errs: string[] = [];
    if (!SENTENCE_INTENTS.includes(s.intent as EditorialIntent)) errs.push(`intent "${String(s.intent)}" is not one of ${SENTENCE_INTENTS.join(', ')}`);
    for (const k of ['importance', 'surprise', 'tension', 'informationDensity', 'visualPotential'] as const) {
      if ((k === 'importance' || s[k] !== undefined) && !isLevel(s[k])) errs.push(`${k} must be an integer level from 1 to 5 (got ${JSON.stringify(s[k])})`);
    }
    const emphasis = Array.isArray(s.emphasis) ? s.emphasis : [];
    const spoken = new Set(u.words.map(normalizeWord));
    if (emphasis.length > 2) errs.push('emphasis has more than 2 words');
    for (const w of emphasis) if (typeof w !== 'string' || !spoken.has(normalizeWord(w))) errs.push(`emphasis "${String(w)}" is not a word of the sentence`);
    if (typeof s.why !== 'string' || !s.why.trim()) errs.push('why is missing');
    if (s.media !== undefined && s.media !== null && !catalogIds.has(String(s.media))) errs.push(`media "${String(s.media)}" is not in the catalogue (use null)`);
    if (errs.length) out.errors.push(...errs.map((e) => `${u.id}: ${e}`));
    else out.sentences.set(u.id, { ...(s as unknown as LlmSentence), emphasis: emphasis as string[] });
  }
  // Scenes.
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  const sceneErrors: string[] = [];
  const order = scenes.flatMap((sc) => (isObj(sc) && Array.isArray(sc.sentenceIds) ? sc.sentenceIds : []));
  if (order.join() !== expected.join()) sceneErrors.push(`scenes must cover every sentence exactly once, contiguous and in order (${expected.join(', ')})`);
  scenes.forEach((sc, i) => {
    const p = `scene ${i + 1}`;
    if (!isObj(sc) || !Array.isArray(sc.sentenceIds) || !Array.isArray(sc.beats)) return sceneErrors.push(`${p}: needs sentenceIds and beats`);
    const members = sc.sentenceIds.map((id) => units.find((u) => u.id === id)).filter((u) => u !== undefined);
    if (typeof sc.purpose !== 'string' || !sc.purpose.trim()) sceneErrors.push(`${p}: purpose is missing (SCENE-01)`);
    if (sc.beats.length !== sc.sentenceIds.length) sceneErrors.push(`${p}: one beat per sentence (${sc.sentenceIds.length} sentences, ${sc.beats.length} beats)`);
    if (sc.beats.some((b) => !BEATS.includes(b as Beat))) sceneErrors.push(`${p}: beats must be among ${BEATS.join(', ')}`);
    if (new Set(members.map((u) => u.chapterIndex)).size > 1) sceneErrors.push(`${p}: a scene stays inside one chapter`);
    if (members.length < 2) sceneErrors.push(`${p}: a scene has at least 2 sentences (setup and resolution, SCENE-02); merge it with a neighbour`);
    if (sc.beats[0] !== 'setup') sceneErrors.push(`${p}: the first beat is "setup" (SCENE-02)`);
    if (!sc.beats.some((b) => RESOLVING_BEATS.includes(b as Beat))) sceneErrors.push(`${p}: needs a payoff, revelation or proof beat (SCENE-02)`);
    const first = members[0];
    const firstIntent = first ? (out.sentences.get(first.id)?.intent ?? first.intent) : undefined;
    if (firstIntent === 'revelation') sceneErrors.push(`${p}: starts with a revelation (${first!.id}); a revelation needs a setup before it (REV-02)`);
  });
  if (sceneErrors.length) out.errors.push(...sceneErrors);
  else out.scenes = scenes as unknown as LlmScene[];
  for (const q of Array.isArray(raw.chapterQuestions) ? raw.chapterQuestions : []) {
    if (isObj(q) && typeof q.chapter === 'number' && typeof q.question === 'string' && q.question.trim()) out.chapterQuestions.set(q.chapter, q.question.trim());
  }
  return out;
}

/**
 * Accepted answer → Story. Rejected sentences and a rejected structure keep
 * the heuristic version (and say so). Author hints always win.
 */
export function mergeStory(heuristic: Story, checked: CheckedStory, model: string): Story {
  const decisions = [...heuristic.decisions];
  const units = heuristic.units.map((u) => {
    const s = checked.sentences.get(u.id);
    if (!s) {
      decisions.push(`${u.id}: the model's analysis was rejected, heuristic analysis kept`);
      return u;
    }
    const hints = u.hints ?? {};
    const places = (s.places ?? []).flatMap((name) => {
      const coordinates = lookupPlace(name);
      const wordIndex = u.words.findIndex((w) => normalizeWord(w) === normalizeWord(name.split(/\s+/)[0]!));
      return coordinates && wordIndex >= 0 && !u.entities.places.some((p) => p.name === name) ? [{ name, coordinates, wordIndex }] : [];
    });
    return {
      ...u,
      intent: hints.intent ?? s.intent,
      importance: hints.importance ?? s.importance,
      analysis: {
        ...u.analysis,
        ...(s.surprise ? { surprise: s.surprise } : {}),
        ...(s.tension ? { tension: s.tension } : {}),
        ...(s.informationDensity ? { informationDensity: s.informationDensity } : {}),
        ...(s.visualPotential ? { visualPotential: s.visualPotential } : {}),
        ...(s.emotion ? { emotion: s.emotion } : {}),
        proofRequired: s.proofRequired ?? u.analysis.proofRequired,
      },
      entities: { ...u.entities, emphasis: hints.highlightedWords ?? s.emphasis.slice(0, 2), places: [...u.entities.places, ...places] },
      why: hints.intent ? u.why : s.why,
      ...(s.media && !hints.media ? { hints: { ...hints, media: s.media } } : {}),
    };
  });
  let structure = heuristic.structure;
  if (checked.scenes) {
    const beats: Record<string, Beat> = {};
    const counters = new Map<string, number>();
    const scenes = checked.scenes.map((sc) => {
      const chapter = heuristic.structure.chapters.find((c) => c.unitIds.includes(sc.sentenceIds[0]!))!;
      const n = (counters.get(chapter.id) ?? 0) + 1;
      counters.set(chapter.id, n);
      sc.sentenceIds.forEach((id, i) => (beats[id] = sc.beats[i]!));
      return { id: `${chapter.id}-s${n}`, chapterId: chapter.id, purpose: sc.purpose.trim(), unitIds: [...sc.sentenceIds] };
    });
    const chapters = heuristic.structure.chapters.map((c, i) => ({ ...c, ...(!c.question && checked.chapterQuestions.get(i + 1) ? { question: checked.chapterQuestions.get(i + 1)! } : {}) }));
    structure = { chapters, scenes, beats };
  } else {
    // Rebuild the heuristic structure on the model's intents (the architect re-checks REV-02, SCENE-02).
    structure = architectStory(units, heuristic.structure.chapters.map((c) => ({ title: c.title, ...(c.question ? { question: c.question } : {}) })), decisions);
    decisions.push("the model's scene structure was rejected, heuristic structure rebuilt on its analysis");
  }
  decisions.push(`editorial analysis by ${model}${checked.errors.length ? ` (partially: ${checked.errors.length} problem(s) left)` : ''}`);
  return { units, structure, decisions };
}
