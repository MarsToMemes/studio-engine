/**
 * Media selection (bible §27): the need of a sentence first, then the most
 * authentic media that answers it.
 */
import { describe, expect, it } from 'vitest';
import { validateShotPlan, type AssetRegistry, type AssetSource } from '@studio-engine/scene-engine';
import { analyzeScript, detectMediaNeed, directEpisode, directEpisodeWithLlm, isFrench, mediaNatureOf, RecordedModel, type BrainInput, type ScriptBlock } from '../src/index';

const own: AssetSource = { provider: 'own production', license: 'own', commercialUse: true, attributionRequired: false };
const need = (text: string, intent: Parameters<typeof detectMediaNeed>[0]['intent'] = 'fact') => {
  const units = analyzeScript({ script: [{ kind: 'text', text: 'Intro.' }, { kind: 'text', text }], assets: {} });
  return detectMediaNeed({ text, words: text.split(/\s+/), intent, numbers: units[1]!.entities.numbers, places: units[1]!.entities.places }).need;
};

describe('the need of a sentence (heuristic fallback, English and French)', () => {
  it.each([
    ['Over 60% of its revenue comes from franchisees.', 'explain_number'],
    ['Plus de 60 % de ses revenus viennent des franchisés.', 'explain_number'],
    ['The annual report says it plainly.', 'financial_document'],
    ['Le rapport annuel le dit clairement.', 'financial_document'],
    ['Everything started on YouTube.', 'platform_reference'],
    ['Tout a commencé sur une application.', 'platform_reference'],
    ['In 1955, the first restaurant opened in Des Plaines.', 'historical_context'],
    ["À l'époque, la marque n'existait pas encore.", 'historical_context'],
    ['Franchisees pay rent and royalties in exchange for the brand.', 'abstract_mechanism'],
    ['Les franchisés reversent un loyer et des redevances.', 'abstract_mechanism'],
    ['Customers wait in line every morning.', 'human_behavior'],
    ['Les clients attendent au comptoir chaque matin.', 'human_behavior'],
    ['Ray Kroc was a milkshake machine salesman.', 'introduce_entity'],
    ['Ray Kroc vendait des machines à milkshake.', 'introduce_entity'],
    ['At night the streets of the city go quiet.', 'atmosphere'],
    ['La nuit, les rues de la ville se vident.', 'atmosphere'],
  ])('%s → %s', (text, expected) => {
    expect(need(text)).toBe(expected);
  });

  it('never takes a sentence-initial function word for a name', () => {
    expect(need('From Chicago to Tokyo the restaurants sit on prime land.')).not.toBe('introduce_entity');
  });

  it('keeps chapters and quotes on their own treatment', () => {
    expect(need('A new chapter', 'chapter')).toBe('none');
  });

  it('tells French from English', () => {
    expect(isFrench("McDonald's n'est pas une entreprise de burgers.")).toBe(true);
    expect(isFrench("McDonald's isn't a burger company.")).toBe(false);
  });
});

describe('the nature of a media file', () => {
  it('uses the declared nature, else the rights, the tags and the kind', () => {
    expect(mediaNatureOf({ kind: 'image' }, 'archive')).toBe('archive');
    expect(mediaNatureOf({ kind: 'image', source: { ...own, syntheticMedia: true } })).toBe('generated');
    expect(mediaNatureOf({ kind: 'image' }, undefined, ['annual report'])).toBe('document');
    expect(mediaNatureOf({ kind: 'image' }, undefined, ['screenshot'])).toBe('screenshot');
    expect(mediaNatureOf({ kind: 'video' })).toBe('real_video');
    expect(mediaNatureOf({ kind: 'image' })).toBe('real_photo');
  });
});

/** A small episode where several media could illustrate the same sentences. */
function episode(script: ScriptBlock[], assets: AssetRegistry, catalog: BrainInput['catalog']): BrainInput {
  return { title: 'Test', script: [{ kind: 'text', text: 'This is the promise of the video.' }, ...script], assets, catalog };
}
const shotOf = (r: ReturnType<typeof directEpisode>, unit: string) => r.plan.shots.find((s) => s.id === unit || s.id === `${unit}-a`)!;

describe('choosing the media (bible §27)', () => {
  const assets: AssetRegistry = {
    queueVideo: { id: 'queueVideo', kind: 'video', src: 'q.mp4', durationInSeconds: 8, width: 1920, height: 1080, source: own },
    queuePhoto: { id: 'queuePhoto', kind: 'image', src: 'q.jpg', width: 1920, height: 1080, source: own },
    krocPortrait: { id: 'krocPortrait', kind: 'image', src: 'kroc.jpg', width: 1600, height: 1200, source: { ...own, provider: 'Wikimedia Commons', license: 'CC BY-SA 4.0', attributionRequired: true, attribution: 'Wikimedia Commons' } },
    krocAi: { id: 'krocAi', kind: 'image', src: 'kroc-ai.jpg', width: 1920, height: 1080, source: { ...own, syntheticMedia: true } },
    store1955: { id: 'store1955', kind: 'image', src: '1955.jpg', width: 1600, height: 1200, nature: 'archive', source: own },
    storeToday: { id: 'storeToday', kind: 'image', src: 'today.jpg', width: 1920, height: 1080, source: own },
  };
  const catalog: BrainInput['catalog'] = [
    { assetId: 'queueVideo', description: 'customers waiting in line at the counter', tags: ['customers', 'queue', 'wait', 'line'] },
    { assetId: 'queuePhoto', description: 'customers waiting in line', tags: ['customers', 'queue', 'wait', 'line'] },
    { assetId: 'krocPortrait', description: 'portrait of Ray Kroc', tags: ['Ray Kroc', 'founder'] },
    { assetId: 'krocAi', description: 'Ray Kroc in his office (AI illustration)', tags: ['Ray Kroc', 'office'] },
    { assetId: 'store1955', description: 'the first restaurant in Des Plaines, 1955', tags: ['restaurant', 'Des Plaines', 'first'] },
    { assetId: 'storeToday', description: 'the restaurant in Des Plaines today', tags: ['restaurant', 'Des Plaines', 'first'] },
  ];

  it('human behaviour: the real video before the photo (MED-05)', () => {
    const r = directEpisode(episode([{ kind: 'text', text: 'Customers wait in line every morning.' }], assets, catalog));
    const s = shotOf(r, 'u2');
    expect(s).toMatchObject({ type: 'video', media: 'queueVideo', mediaNeed: 'human_behavior', mediaTier: 'real_video' });
    expect(s.reasons!.media).toContain('MED-05');
  });

  it('a person: the real photo, never the generated one (MED-04, MED-07)', () => {
    const r = directEpisode(episode([{ kind: 'text', text: 'Ray Kroc was a milkshake machine salesman.' }], assets, catalog));
    expect(shotOf(r, 'u2')).toMatchObject({ type: 'image', media: 'krocPortrait', mediaNeed: 'introduce_entity', mediaTier: 'real_photo' });
    expect(r.plan.shots.some((s) => s.media === 'krocAi')).toBe(false);
  });

  it('without a real photo of the person: motion design and a precise request, still never the generated visual', () => {
    const { krocPortrait: _k, ...rest } = assets;
    const r = directEpisode(episode([{ kind: 'text', text: 'Ray Kroc was a milkshake machine salesman.' }], rest, catalog!.filter((c) => c.assetId !== 'krocPortrait')));
    expect(shotOf(r, 'u2')).toMatchObject({ type: 'text', mediaTier: 'motion' });
    expect(r.plan.shots.some((s) => s.media === 'krocAi')).toBe(false);
    expect(r.assetRequests).toContainEqual(expect.objectContaining({ unitId: 'u2', need: 'image', description: expect.stringContaining('Wikimedia Commons') }));
    expect(validateShotPlan(r.plan).warnings.some((w) => w.code === 'media.generated.real')).toBe(false);
  });

  it('history: the archive before the photo of today (MED-04)', () => {
    const r = directEpisode(episode([{ kind: 'text', text: 'In 1955, the first restaurant opened in Des Plaines.' }], assets, catalog));
    expect(shotOf(r, 'u2')).toMatchObject({ media: 'store1955', mediaNeed: 'historical_context', mediaTier: 'real_photo' });
  });

  it('an explained figure: data first, the authentic media as support (MED-03)', () => {
    const r = directEpisode(episode([{ kind: 'text', text: 'Every single morning, 68% of the customers wait in line at the counter before they order their breakfast.' }], assets, catalog));
    const shots = r.plan.shots.filter((s) => (s.metadata as { unit?: string } | undefined)?.unit === 'u2');
    // The figure is the key shot (data), the queue footage supports it; the words before the figure may lead in (J-cut).
    expect(shots.find((s) => s.type === 'number')).toMatchObject({ mediaNeed: 'explain_number', mediaTier: 'data_viz' });
    const support = shots.find((s) => s.mediaTier === 'real_video' || s.mediaTier === 'real_photo');
    expect(support?.reasons!.media).toContain('MED-03');
  });

  it('the author decides the need when the heuristics would not', () => {
    const r = directEpisode(episode([{ kind: 'text', text: 'It all begins here.', hints: { mediaNeed: 'historical_context' } }], assets, catalog));
    expect(r.analysis[1]!.mediaNeed).toBe('historical_context');
  });

  it('asks for media in the language of the script', () => {
    const r = directEpisode({ title: 'Test', script: [{ kind: 'text', text: 'Voici la promesse de la vidéo.' }, { kind: 'text', text: 'Ray Kroc vendait des machines à milkshake.' }], assets: {} });
    expect(r.assetRequests.find((a) => a.unitId === 'u2')!.description).toMatch(/^une photo réelle de Ray Kroc/);
  });
});

describe('the need decided by Claude', () => {
  it('takes the model need, checks it, and keeps the author hint first', async () => {
    const input = episode([{ kind: 'text', text: 'It all begins here.' }, { kind: 'text', text: 'Nobody saw it coming.', hints: { mediaNeed: 'atmosphere' } }], {}, []);
    const answer = {
      sentences: [
        { id: 'u1', intent: 'hook', importance: 5, why: 'the promise', emphasis: [], mediaNeed: 'none' },
        { id: 'u2', intent: 'context', importance: 3, why: 'sets the scene', emphasis: [], mediaNeed: 'historical_context' },
        { id: 'u3', intent: 'aftermath', importance: 3, why: 'sinks in', emphasis: [], mediaNeed: 'human_behavior' },
      ],
      scenes: [{ sentenceIds: ['u1', 'u2', 'u3'], beats: ['setup', 'development', 'payoff'], purpose: 'Open the story.' }],
    };
    const r = await directEpisodeWithLlm(input, { model: new RecordedModel([answer]) });
    expect(r.analysis.map((u) => u.mediaNeed)).toEqual(['none', 'historical_context', 'atmosphere']);
    const bad = await directEpisodeWithLlm(input, { model: new RecordedModel([{ ...answer, sentences: answer.sentences.map((s) => ({ ...s, mediaNeed: 'decoration' })) }]) });
    expect(bad.llm!.errors.join(' ')).toContain('mediaNeed "decoration"');
  });
});

describe('style apple: real footage becomes a studio-video block', () => {
  it('reveals the footage like a still, with the synced title, and a gentler zoom', () => {
    const video: AssetRegistry = { queue: { id: 'queue', kind: 'video', src: 'clip.webm', durationInSeconds: 6, width: 1920, height: 1080, source: own } };
    const r = directEpisode({ ...episode([{ kind: 'text', text: 'Customers wait in line every morning.' }, { kind: 'text', text: 'Nobody asks who owns the building.' }], video, [{ assetId: 'queue', description: 'customers waiting in line', tags: ['customers', 'queue', 'wait', 'line'] }]), style: 'apple' });
    const s = shotOf(r, 'u2');
    expect(s).toMatchObject({ type: 'video', mediaTier: 'real_video', block: { item: 'studio-video', variables: { src: 'clip.webm', window: 56, zoom: 0.05 } } });
    expect(String(s.block!.variables!.text)).toContain('line');
    expect(r.decisions.some((d) => d.includes('u2') && d.includes("engine's composition"))).toBe(false);
  });
});
