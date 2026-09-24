/**
 * Prompts of the LLM editor brain. The rules are not paraphrased here: they
 * are taken from VIDEO_EDITING_BIBLE.md (BIBLE_RULES) and the editorial
 * grammar, the same source the validation enforces.
 */
import { BEATS, BIBLE_RULES, EDITORIAL_GRAMMAR, EDITORIAL_INTENTS, type EditorialIntent } from '@studio-engine/scene-engine';
import type { EditorialUnit, StoryStructure } from '../types.js';

/** What each intent means (the grammar says how it is shown). */
export const INTENT_DEFINITIONS: Record<EditorialIntent, string> = {
  hook: 'the opening promise of the video (first sentence)',
  context: 'sets the scene, low information',
  fact: 'plain information',
  important_fact: 'an important statement the viewer must remember',
  keyword: 'a few words said on their own',
  number: 'a key figure',
  statistic: 'figures that evolve or data worth a chart',
  comparison: 'two values or things compared',
  quote: 'someone is quoted',
  proof: 'a source proves the previous claim (document, report, filing)',
  location: 'where it happens: places',
  process: 'steps one after the other',
  contradiction: 'breaks an expectation ("but", "isn\'t", "something else")',
  revelation: 'the hidden truth the chapter builds towards',
  aftermath: 'lets a revelation sink in, gives its consequence',
  chapter: 'reserved for chapter cards (never a sentence)',
  conclusion: 'closes the story and answers the hook',
};

/** Intents a sentence can take (chapter cards are made by the brain). */
export const SENTENCE_INTENTS: readonly EditorialIntent[] = EDITORIAL_INTENTS.filter((i) => i !== 'chapter');

const RULE_DOMAINS = ['DIR', 'STORY', 'SCENE', 'GRAM', 'REV', 'ESC', 'CHAP', 'TYPO', 'CALL'];

export function buildSystemPrompt(): string {
  const rules = BIBLE_RULES.filter((r) => RULE_DOMAINS.includes(r.domain)).map((r) => `- ${r.id} (${r.severity}): ${r.text}`);
  const grammar = SENTENCE_INTENTS.map((i) => `- ${i}: ${INTENT_DEFINITIONS[i]}. Shown as ${EDITORIAL_GRAMMAR[i].shotTypes.join(' / ')}: ${EDITORIAL_GRAMMAR[i].why}`);
  return [
    'You are the editorial brain of a professional YouTube documentary editing team: an editor, a documentary director and a motion designer.',
    'You do NOT choose effects. You decide what each sentence of the narration IS for the viewer, and how the story is built. A deterministic engine then turns your decisions into shots, following the grammar below.',
    '',
    'For every sentence, think in this order: what information matters; what the viewer must understand, feel or discover; whether to show, explain, compare, prove or reveal; how it prepares the next sentence.',
    '',
    'Think in scenes, not clips. A scene has a narrative purpose (one sentence) and beats: setup → development / escalation → contradiction → revelation → proof → payoff → aftermath.',
    '',
    '## Editorial intents (the grammar)',
    ...grammar,
    '',
    `## Beats: ${BEATS.join(', ')}`,
    '',
    '## Rules (VIDEO_EDITING_BIBLE.md)',
    ...rules,
    '',
    '## Output',
    '- Call the tool once with the complete story: every sentence exactly once, in order.',
    '- Scores (importance, surprise, tension, informationDensity, visualPotential) are ORDINAL editorial levels 1–5, heuristics for editing, never measurements. Use the whole range.',
    '- `emphasis`: at most 2 words copied exactly from the sentence, the ones that carry its meaning. Empty if none.',
    '- `why`: one short sentence with the evidence for the intent (what in the sentence makes it so).',
    '- `media`: an asset id from the catalogue ONLY if it truly shows what the sentence says; otherwise null. Never force an unrelated image.',
    '- `places`: place names exactly as written in the sentence.',
    '- Never invent figures, data, documents or quotes: only classify what is in the script.',
    '- Scenes: contiguous sentences of ONE chapter, at least 2 sentences, first beat `setup`, at least one of payoff / revelation / proof; a revelation is never the first sentence of its scene.',
    '- Write `why`, `purpose` and chapter questions in the language of the script.',
  ].join('\n');
}

export function buildUserMessage(story: { units: EditorialUnit[]; structure: StoryStructure }, context: { title?: string; catalog: Array<{ id: string; kind: string; description: string }> }): string {
  const lines: string[] = [];
  if (context.title) lines.push(`# ${context.title}`, '');
  story.structure.chapters.forEach((c, ci) => {
    lines.push(`## Chapter ${ci + 1}: ${c.title}${c.question ? ` — question: ${c.question}` : ''}`);
    for (const id of c.unitIds) {
      const u = story.units.find((x) => x.id === id)!;
      const facts = [
        ...u.entities.numbers.map((n) => `figure ${n.prefix ?? ''}${n.value}${n.suffix ?? ''}`),
        ...u.entities.places.map((p) => `place ${p.name}`),
        ...(u.hints?.intent ? [`the author sets intent=${u.hints.intent}`] : []),
        ...(u.hints?.chart ? ['chart data attached'] : []),
        ...(u.hints?.media ? [`the author sets media=${u.hints.media}`] : []),
      ];
      lines.push(`${u.id}: ${u.text}${facts.length ? `   [${facts.join('; ')}]` : ''}`);
    }
    lines.push('');
  });
  lines.push('## Asset catalogue');
  lines.push(...(context.catalog.length ? context.catalog.map((a) => `- ${a.id} (${a.kind}): ${a.description}`) : ['(empty)']));
  lines.push('', 'Return the editorial story of this script with the tool.');
  return lines.join('\n');
}
