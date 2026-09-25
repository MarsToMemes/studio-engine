/**
 * The McDonald's sequence of VIDEO_EDITING_BIBLE.md §27 as a version 2
 * editorial plan: chapters, scenes with beats, intents and reasons, visual
 * hierarchy, camera, music states, a narration cut into sentence segments
 * (a silent chapter card, a controlled silence before the revelation) and a
 * visual callback at the end.
 */
import { getShotStartFrames, type AssetRegistry, type NarrationSegment, type Shot, type ShotPlan, type TranscriptWord } from '../../src/index.js';
import { transcript } from './shotplan-episode.js';

const FPS = 30;

const SCRIPT =
  "McDonald's isn't a burger company. Behind every counter there is something else. " +
  'Over sixty one percent of its revenue comes from franchisees. The annual report says it plainly. ' +
  'Rent keeps growing year after year. The real estate empire. They own the land. ' +
  "We discovered that McDonald's makes BILLIONS from real estate.";

const own = { provider: 'own production', license: 'own', commercialUse: true, attributionRequired: false } as const;

export const editorialAssets: AssetRegistry = {
  narration: { id: 'narration', kind: 'audio', src: 'narration.wav', durationInSeconds: 40, source: own },
  music: { id: 'music', kind: 'audio', src: 'music.wav', durationInSeconds: 60, source: { provider: 'Example Music', id: 'track-42', license: 'royalty-free', commercialUse: true, attributionRequired: false } },
  landscape: { id: 'landscape', kind: 'image', src: 'landscape.png', width: 1920, height: 1080, source: own },
  report: { id: 'report', kind: 'image', src: 'report.png', width: 1000, height: 1400, source: { provider: "McDonald's investor relations", url: 'https://corporate.mcdonalds.com', license: 'press use', commercialUse: true, attributionRequired: true, attribution: "McDonald's Annual Report 2023" } },
  'sfx-impact': { id: 'sfx-impact', kind: 'audio', src: 'sfx/impact.wav', durationInSeconds: 1, source: own },
};

/** The narration file: one sentence per segment. */
export const editorialWords: TranscriptWord[] = transcript(SCRIPT, 24);

function sentences(words: readonly TranscriptWord[]): Array<{ startMs: number; endMs: number }> {
  const out: Array<{ startMs: number; endMs: number }> = [];
  let start: number | undefined;
  for (const w of words) {
    start ??= w.startMs;
    if (/[.!?]$/.test(w.text)) {
      out.push({ startMs: start, endMs: w.endMs + 40 });
      start = undefined;
    }
  }
  return out;
}

type Slot = { shot: Omit<Shot, 'durationInFrames'>; sentence?: number; seconds?: number; tailFrames?: number };

/**
 * Lays the shots on the voice: a shot carrying a sentence lasts as long as the
 * sentence plus a short pause, so every cut falls between two words.
 */
function layout(slots: Slot[]): { shots: Shot[]; segments: NarrationSegment[] } {
  const ranges = sentences(editorialWords);
  const shots = slots.map((slot): Shot => {
    const r = slot.sentence !== undefined ? ranges[slot.sentence]! : undefined;
    const duration = r ? Math.ceil(((r.endMs - r.startMs) / 1000) * FPS) + (slot.tailFrames ?? 4) : Math.round((slot.seconds ?? 1.5) * FPS);
    return { ...slot.shot, durationInFrames: duration } as Shot;
  });
  // Transitions overlap shots: each sentence starts where its shot really starts.
  const starts = getShotStartFrames({ shots, fps: FPS });
  const segments = slots.flatMap((slot, i): NarrationSegment[] => {
    if (slot.sentence === undefined) return [];
    const r = ranges[slot.sentence]!;
    return [{ id: `s${slot.sentence + 1}`, sourceStartMs: r.startMs, sourceEndMs: r.endMs, startFrame: starts[i]! }];
  });
  return { shots, segments };
}

export function buildEditorialPlan(): ShotPlan {
  const { shots, segments } = layout([
    {
      sentence: 0,
      shot: {
        id: 'hook', type: 'text', sceneId: 'business', beat: 'setup', editorialIntent: 'hook', importance: 5,
        text: "McDonald's isn't a burger company", highlightedWords: ['burger'], motionSkill: 'keyword_pop', intensity: 'strong',
        visualHierarchy: { primary: 'statement', background: 'dark texture' }, musicState: 'tension',
        reasons: { shot: 'State the contradiction the whole video is built on, in one sentence.', motion: '"burger" is the only word worth isolating.', sfx: 'A discreet impact on "burger".' },
        sfx: [{ sfx: 'sfx-impact', at: 30 }], decidedBy: 'ai', metadata: { role: 'hook' },
      },
    },
    {
      sentence: 1,
      shot: {
        id: 'counter', type: 'image', sceneId: 'business', beat: 'contradiction', editorialIntent: 'contradiction', importance: 3,
        media: 'landscape', camera: 'push_in', framing: 'medium', musicState: 'tension',
        visualHierarchy: { primary: 'restaurant' },
        reasons: { shot: 'Show the familiar restaurant while the voice says the truth is elsewhere.', camera: 'A slow push invites the viewer to look closer.' },
        decidedBy: 'ai',
      },
    },
    {
      sentence: 2,
      shot: {
        id: 'stat', type: 'number', sceneId: 'business', beat: 'escalation', editorialIntent: 'number', importance: 5,
        number: { value: 61, suffix: '%', label: 'of revenue from franchisees' }, motionSkill: 'number_pop', intensity: 'medium', musicState: 'tension',
        visualHierarchy: { primary: '61 %', secondary: 'label' },
        reasons: { shot: 'The key figure must be on screen when it is spoken.', motion: 'The number builds up to 61.' },
        decidedBy: 'ai',
      },
    },
    {
      sentence: 3,
      shot: {
        id: 'report', type: 'document', sceneId: 'business', beat: 'proof', editorialIntent: 'proof', importance: 4,
        media: 'report', motionSkill: 'document_highlight', camera: 'push_in', musicState: 'tension',
        document: { source: "McDonald's Annual Report 2023", highlights: [{ x: 9, y: 26, width: 72, height: 4, at: 20 }] },
        visualHierarchy: { primary: 'annual report', secondary: 'highlighted line', background: 'dark texture' },
        reasons: { shot: 'Prove the figure right after the claim.', motion: 'The highlight lands on the sentence the voice reads.' },
        decidedBy: 'ai',
      },
    },
    {
      sentence: 4,
      shot: {
        id: 'rent', type: 'chart', sceneId: 'business', beat: 'payoff', editorialIntent: 'statistic', importance: 4,
        chart: { kind: 'barChart', labels: ['2019', '2021', '2023'], values: [7.6, 8.9, 9.9], unit: 'B$', title: 'Rent income' }, motionSkill: 'bar_animation', musicState: 'tension',
        visualHierarchy: { primary: 'growing bars' },
        reasons: { shot: 'Show that rent grows every year: an evolution, one idea.' },
        decidedBy: 'ai',
      },
    },
    {
      seconds: 1.5,
      shot: {
        id: 'chapter-2', type: 'chapter', sceneId: 'empire', beat: 'transition', editorialIntent: 'chapter', importance: 3,
        text: 'The real estate empire', subtext: 'CHAPTER 2', motionSkill: 'chapter_card', transition: 'fade', musicState: 'build',
        visualHierarchy: { primary: 'chapter title', background: 'black' },
        reasons: { shot: 'Change of chapter: the question becomes how big the empire is.', transition: 'A fade marks the change of chapter.' },
        decidedBy: 'ai',
      },
    },
    {
      sentence: 5,
      tailFrames: 16, // pause + controlled silence before the revelation
      shot: {
        id: 'world', type: 'map', sceneId: 'empire', beat: 'setup', editorialIntent: 'location', importance: 3,
        map: { center: [-87.63, 41.88], zoom: 3, markers: [{ label: 'Chicago HQ', coordinates: [-87.63, 41.88] }] }, motionSkill: 'map_zoom', musicState: 'build',
        visualHierarchy: { primary: 'map', secondary: 'headquarters pin' },
        reasons: { shot: 'Give the scale of the empire before revealing what it is made of.' },
        decidedBy: 'ai',
      },
    },
    {
      sentence: 6,
      shot: {
        id: 'reveal', type: 'revelation', sceneId: 'empire', beat: 'revelation', editorialIntent: 'revelation', importance: 5,
        text: 'They own the land', highlightedWords: ['land'], motionSkill: 'blackout_reveal', camera: 'punch_in', intensity: 'strong', musicState: 'reveal',
        sfx: [{ sfx: 'sfx-impact' }],
        visualHierarchy: { primary: 'statement' },
        reasons: { shot: 'The revelation of the chapter, after a silence.', camera: 'Punch-in on "land".', sfx: 'Impact right after the silence.' },
        decidedBy: 'ai',
      },
    },
    {
      sentence: 7,
      tailFrames: 20, // the dissolve into the conclusion must not start on the last word
      shot: {
        id: 'billions', type: 'text', sceneId: 'empire', beat: 'aftermath', editorialIntent: 'important_fact', importance: 4,
        text: "McDonald's makes BILLIONS from real estate", highlightedWords: ['BILLIONS'], motionSkill: 'highlight_word', musicState: 'aftermath',
        visualHierarchy: { primary: 'statement' },
        reasons: { shot: 'Let the revelation sink in with its consequence.' },
        decidedBy: 'ai',
      },
    },
    {
      seconds: 2.5,
      shot: {
        id: 'conclusion', type: 'image', sceneId: 'empire', beat: 'payoff', editorialIntent: 'conclusion', importance: 3,
        media: 'landscape', camera: 'pull_out', framing: 'wide', transition: 'dissolve', musicState: 'aftermath',
        visualHierarchy: { primary: 'restaurant' },
        reasons: { shot: 'The restaurant of the beginning returns: the viewer now sees a landlord.', camera: 'Pulling out reveals the whole plot of land.' },
        decidedBy: 'ai',
      },
    },
  ]);
  return {
    version: 2,
    fps: FPS,
    width: 1920,
    height: 1080,
    assets: { ...editorialAssets },
    narration: { assetId: 'narration', words: editorialWords, segments },
    music: { assetId: 'music', gainDb: -18, duckDb: -6 },
    captions: { enabled: true, style: 'caption-bold-pop', wordsPerCue: 3 },
    chapters: [
      { id: 'c1', title: 'The real business', question: "How does McDonald's really make money?" },
      { id: 'c2', title: 'The real estate empire', question: 'How big is it?' },
    ],
    scenes: [
      { id: 'business', chapterId: 'c1', purpose: "Show that McDonald's money does not come from burgers.", motifs: ['restaurant'] },
      { id: 'empire', chapterId: 'c2', purpose: 'Reveal that McDonald’s is a landlord.', motifs: ['restaurant'] },
    ],
    silences: [{ id: 'before-reveal', beforeShotId: 'reveal', durationInFrames: 12, kinds: ['music_drop'] }],
    memory: {
      visualMotifs: [{ id: 'restaurant', description: 'McDonald’s restaurant exterior', assetId: 'landscape', introducedIn: 'counter' }],
      introducedConcepts: [{ id: 'franchise', label: 'franchisees pay rent', introducedIn: 'stat' }],
      callbackCandidates: [{ motifId: 'restaurant', callbackShotId: 'conclusion', note: 'same restaurant, now seen as real estate' }],
    },
    metadata: { id: 'editorial-episode' },
    shots,
  };
}
