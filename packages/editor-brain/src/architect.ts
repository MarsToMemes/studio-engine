/**
 * STORY ARCHITECT. Thinks in scenes, not clips (bible §3): chapters from the
 * script, scenes with a narrative purpose, and the beat of every sentence
 * (setup → development/escalation → contradiction → revelation → proof →
 * payoff → aftermath).
 */
import { RESOLVING_BEATS, type Beat } from '@studio-engine/scene-engine';
import type { EditorialUnit, StoryStructure } from './types.js';

/** Scenes longer than this get split (bible SCENE-04: 15–60 s). */
export const MAX_SCENE_MS = 60_000;

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s).replace(/[.!?…]+$/, '');

export function architectStory(units: EditorialUnit[], chapters: Array<{ title: string; question?: string }>, decisions: string[]): StoryStructure {
  const structure: StoryStructure = { chapters: [], scenes: [], beats: {} };
  chapters.forEach((c, ci) => {
    const inChapter = units.filter((u) => u.chapterIndex === ci);
    if (!inChapter.length) return;
    const chapterId = `c${ci + 1}`;
    structure.chapters.push({ id: chapterId, title: c.title || clip(inChapter[0]!.text, 40), ...(c.question ? { question: c.question } : {}), unitIds: inChapter.map((u) => u.id) });

    // 1. Cut the chapter into scenes: a scene ends after its aftermath / conclusion, or when it gets too long.
    let groups: EditorialUnit[][] = [];
    for (const u of inChapter) {
      const current = groups[groups.length - 1];
      const prev = current?.[current.length - 1];
      const closes = prev && (prev.intent === 'aftermath' || prev.intent === 'conclusion') && u.intent !== 'aftermath' && u.intent !== 'proof';
      const tooLong = current && u.endMs - current[0]!.startMs > MAX_SCENE_MS;
      if (!current || closes || tooLong) groups.push([u]);
      else current.push(u);
    }
    // 2. A one-sentence scene cannot have a setup AND a resolution (SCENE-02): merge it.
    groups = groups.reduce<EditorialUnit[][]>((acc, g) => {
      if (g.length === 1 && acc.length) acc[acc.length - 1]!.push(...g);
      else acc.push(g);
      return acc;
    }, []);
    if (groups.length > 1 && groups[0]!.length === 1) groups.splice(0, 2, [...groups[0]!, ...groups[1]!]);

    groups.forEach((group, gi) => {
      const sceneId = `${chapterId}-s${gi + 1}`;
      // 3. A revelation needs something before it in its scene (REV-02).
      if (group[0]!.intent === 'revelation') {
        group[0]!.intent = 'important_fact';
        decisions.push(`${group[0]!.id}: revelation opening a scene has no setup; treated as an important fact`);
      }
      assignBeats(group, structure.beats);
      structure.scenes.push({ id: sceneId, chapterId, purpose: purposeOf(group), unitIds: group.map((u) => u.id) });
    });
  });
  return structure;
}

function assignBeats(group: EditorialUnit[], beats: Record<string, Beat>): void {
  group.forEach((u, i) => {
    let beat: Beat;
    if (i === 0) beat = 'setup';
    else if (u.intent === 'contradiction') beat = 'contradiction';
    else if (u.intent === 'revelation') beat = 'revelation';
    else if (u.intent === 'proof') beat = 'proof';
    else if (u.intent === 'aftermath') beat = 'aftermath';
    else if (u.intent === 'conclusion') beat = 'payoff';
    else beat = u.importance >= group[i - 1]!.importance ? 'escalation' : 'development';
    beats[u.id] = beat;
  });
  // Every scene resolves (SCENE-02): without a revelation / proof / payoff, its last sentence is the payoff.
  if (!group.some((u) => RESOLVING_BEATS.includes(beats[u.id]!)) && group.length > 1) beats[group[group.length - 1]!.id] = 'payoff';
}

/**
 * One-sentence purpose. Templated from the strongest sentence: the LLM
 * architect (Phase 4) writes real purposes; this keeps plans valid offline.
 */
function purposeOf(group: EditorialUnit[]): string {
  const find = (intent: EditorialUnit['intent']) => group.find((u) => u.intent === intent);
  const revelation = find('revelation');
  if (revelation) return `Reveal: ${clip(revelation.text)}`;
  const hook = find('hook');
  if (hook) return `Hook the viewer: ${clip(hook.text)}`;
  const proof = find('proof');
  if (proof) return `Prove: ${clip(group[group.indexOf(proof) - 1]?.text ?? proof.text)}`;
  const conclusion = find('conclusion');
  if (conclusion) return `Conclude: ${clip(conclusion.text)}`;
  const strongest = [...group].sort((a, b) => b.importance - a.importance)[0]!;
  return `Explain: ${clip(strongest.text)}`;
}
