/**
 * Recorded answers of the story tool for the McDonald's example, written as a
 * good model would answer. They are fixtures, not real API responses: they
 * test the contract (validation, repair, fallback, merge), not the model.
 */
export const goodAnswer = {
  sentences: [
    { id: 'u1', intent: 'hook', importance: 5, surprise: 4, tension: 3, emphasis: ['burger'], why: 'Opens on a contradiction: McDonald’s defined by what it is not.', media: null },
    { id: 'u2', intent: 'contradiction', importance: 4, surprise: 3, tension: 3, emphasis: ['counter'], why: 'Announces that the visible business hides another one.', media: 'restaurant' },
    { id: 'u3', intent: 'number', importance: 5, surprise: 4, tension: 3, emphasis: ['franchisees'], why: 'The key figure: most of the revenue comes from franchisees, not food.', proofRequired: true, media: null },
    { id: 'u4', intent: 'proof', importance: 4, tension: 3, emphasis: ['rent', 'royalties'], why: 'The annual report is the source that proves the figure.', media: null },
    { id: 'u5', intent: 'statistic', importance: 4, tension: 3, emphasis: ['growing'], why: 'Rent rises every year: an evolution worth a chart.', media: null },
    { id: 'u6', intent: 'location', importance: 3, tension: 4, emphasis: ['land'], why: 'Gives the scale of the empire across continents.', media: null, places: ['Chicago', 'Tokyo', 'London', 'Sydney'] },
    { id: 'u7', intent: 'revelation', importance: 5, surprise: 5, tension: 5, emotion: 'shock', emphasis: ['land'], why: 'The hidden truth the chapter builds to: McDonald’s owns the ground.', media: null },
    { id: 'u8', intent: 'aftermath', importance: 4, tension: 3, emphasis: ['BILLIONS'], why: 'Gives the consequence of the revelation in money.', media: null },
    { id: 'u9', intent: 'conclusion', importance: 4, tension: 2, emphasis: ['landlord'], why: 'Answers the hook: every restaurant is real estate.', media: null },
  ],
  scenes: [
    { sentenceIds: ['u1', 'u2', 'u3', 'u4', 'u5'], beats: ['setup', 'contradiction', 'escalation', 'proof', 'payoff'], purpose: 'Show that McDonald’s money does not come from burgers.' },
    { sentenceIds: ['u6', 'u7', 'u8', 'u9'], beats: ['setup', 'revelation', 'aftermath', 'payoff'], purpose: 'Reveal that McDonald’s is, above all, a landlord.' },
  ],
};

/** An answer with the usual mistakes: invented intent, a word not in the sentence, a scene across chapters. */
export const badAnswer = {
  sentences: goodAnswer.sentences.map((s) => (s.id === 'u3' ? { ...s, intent: 'big_number', emphasis: ['pizza'] } : s.id === 'u8' ? { ...s, importance: 0.87 } : s)),
  scenes: [
    { sentenceIds: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], beats: ['setup', 'contradiction', 'escalation', 'proof', 'payoff', 'setup'], purpose: 'Everything at once' },
    { sentenceIds: ['u7', 'u8', 'u9'], beats: ['revelation', 'aftermath', 'payoff'], purpose: 'Reveal' },
  ],
};
