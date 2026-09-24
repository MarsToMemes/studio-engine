/**
 * Language helpers for the heuristic analyzer (English and French).
 * Deliberately simple and explicit: the LLM analyzer (Phase 4) produces the
 * same `EditorialUnit` with far better understanding; these rules are the
 * offline fallback and the test baseline.
 */
import { normalizeWord } from '@studio-engine/scene-engine';
import type { NumberEntity } from './types.js';

export { normalizeWord };

/** Splits narration into sentences (keeps the final punctuation). */
export function splitSentences(text: string): string[] {
  return (text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+(?:[.!?…]+["»”’)]*|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

export const tokenize = (sentence: string): string[] => sentence.split(/\s+/).filter(Boolean);

const STOPWORDS = new Set(
  (
    'a an the of to in on at by for from with and or but is are was were be been it its this that these those there their they them he she we you i ' +
    'as not no so do does did has have had will would can could just also than then very into over after before about ' +
    'something else every behind there here what which who whom whose when where why how all any each some such only ' +
    'le la les un une des du de d l et ou mais est sont était été ce cet cette ces il elle ils elles on nous vous je en au aux par pour sur dans avec ' +
    'que qui quoi ne pas plus se sa son ses leur leurs y a été'
  ).split(' '),
);

export const isStopword = (w: string) => STOPWORDS.has(normalizeWord(w).replace(/^(l|d|qu|n|s|c|j)['’]/, ''));
export const contentWords = (words: readonly string[]) => words.filter((w) => normalizeWord(w) && !isStopword(w) && !/^\d/.test(w));

// ---------------------------------------------------------------------------
// Editorial cues (the evidence behind an intent)
// ---------------------------------------------------------------------------

const cue = (words: string) => new RegExp(`(?:^|[\\s,;:(])(${words})(?=$|[\\s,.;:!?)])`, 'i');

export const CUES = {
  negation: cue("isn't|is not|aren't|wasn't|doesn't|don't|never|n'est pas|ne sont pas|n'était pas|jamais"),
  contradiction: cue("but|however|yet|isn't|is not|aren't|doesn't|something else|mais|pourtant|cependant|autre chose|n'est pas|ne sont pas"),
  revelation: cue("discovered|revealed|the truth|the real(?! estate)|in reality|actually|secret|hidden|that's where|here's the thing|nous avons découvert|on a découvert|découvert|la vérité|en réalité|en fait|le vrai|la vraie|secret|caché|c'est là que"),
  proof: cue("report|document|filing|filings|according to|records|annual report|the data|rapport|document|selon|d'après|archives|registre|les chiffres"),
  growth: cue("grow|grows|growing|grew|rise|rises|rising|increase|increases|increasing|year after year|every year|double|doubled|augmente|augmenté|croît|croissance|chaque année|année après année|progresse|double|doublé"),
  comparison: cue("compared to|versus|vs|than|more than|less than|twice|half|contre|par rapport|plus que|moins que|deux fois|moitié"),
  process: cue("first|then|next|finally|step|d'abord|ensuite|puis|enfin|étape"),
} as const;

export function findCue(re: RegExp, text: string): string | undefined {
  return re.exec(text)?.[1];
}

// ---------------------------------------------------------------------------
// Numbers (digits in any language, spelled-out numbers in English)
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9, milliard: 1e9, milliards: 1e9, mille: 1e3 };
const PERCENT = /^(percent|per cent|%|pourcent)$/i;
const CURRENCY: Record<string, string> = { $: '$', '€': '€', '£': '£', dollars: '$', dollar: '$', euros: '€', euro: '€' };

const lower = (w: string) => w.toLowerCase().replace(/[.,;:!?)"»”]+$/, '').replace(/^["«“(]+/, '');

/** Numbers of a sentence, with what follows them as a label. */
export function findNumbers(words: readonly string[]): NumberEntity[] {
  const out: NumberEntity[] = [];
  for (let i = 0; i < words.length; i++) {
    const start = i;
    let raw = lower(words[i]!);
    let prefix: string | undefined;
    if (/^[$€£]/.test(raw)) {
      prefix = raw[0];
      raw = raw.slice(1);
    }
    let value: number | undefined;
    let suffix: string | undefined;
    const digits = /^(\d+(?:[.,]\d+)?)(%|[kmb])?$/i.exec(raw.replace(/(\d)[\s ](?=\d{3})/g, '$1'));
    if (digits) {
      value = Number(digits[1]!.replace(',', '.'));
      const tail = digits[2]?.toLowerCase();
      if (tail === '%') suffix = '%';
      else if (tail) suffix = tail === 'k' ? 'K' : tail === 'm' ? 'M' : 'B';
    } else if (UNITS[raw] !== undefined || TENS[raw] !== undefined) {
      // Spelled-out English number: "sixty one", "one hundred twenty".
      let total = 0;
      let current = 0;
      let j = i;
      for (; j < words.length; j++) {
        const w = lower(words[j]!).replace(/-/g, ' ');
        const parts = w.split(' ');
        let consumed = true;
        for (const part of parts) {
          if (UNITS[part] !== undefined) current += UNITS[part]!;
          else if (TENS[part] !== undefined) current += TENS[part]!;
          else if (part === 'hundred') current *= 100;
          else if (part === 'and' && j > i) continue;
          else consumed = false;
        }
        if (!consumed) break;
      }
      value = total + current;
      i = j - 1;
    } else continue;
    // Scale / percent / currency words after the number.
    let k = i + 1;
    const next = words[k] ? lower(words[k]!) : '';
    if (SCALES[next]) {
      suffix = next.startsWith('milli') && next !== 'million' && next !== 'millions' ? 'B' : SCALES[next]! >= 1e9 ? 'B' : SCALES[next]! >= 1e6 ? 'M' : 'K';
      k++;
    }
    const after = words[k] ? lower(words[k]!) : '';
    const after2 = words[k + 1] ? lower(words[k + 1]!) : '';
    if (PERCENT.test(after) || (after === 'pour' && after2 === 'cent')) {
      suffix = '%';
      k += after === 'pour' ? 2 : 1;
    } else if (CURRENCY[after]) {
      prefix = CURRENCY[after];
      k++;
    }
    if (value === undefined || Number.isNaN(value)) continue;
    // "one of the…", "two companies": small spelled-out numbers are not figures.
    if (!digits && !suffix && !prefix && value < 10) continue;
    // Years are dates, not figures to animate.
    if (!suffix && !prefix && value >= 1800 && value <= 2100 && Number.isInteger(value)) continue;
    const label = words.slice(k, k + 7).join(' ').replace(/[.!?…]+$/, '').trim();
    out.push({ value, text: words.slice(start, k).join(' '), ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}), wordIndex: start, ...(label ? { label } : {}) });
    i = k - 1;
  }
  return out;
}

/**
 * Words worth emphasising (max 2, bible TYPO-03): words written in capitals,
 * else the noun a negation contradicts ("isn't a BURGER company"), else the
 * last content word (sentence-final stress).
 */
export function emphasisWords(words: readonly string[], text: string): string[] {
  const caps = words.filter((w) => /^[A-ZÀ-Ý]{3,}[’']?[A-Z]*[.,!?]*$/.test(w)).map((w) => w.replace(/[.,!?]+$/, ''));
  if (caps.length) return caps.slice(0, 2);
  const neg = findCue(CUES.negation, text);
  if (neg) {
    const after = text.slice(text.toLowerCase().indexOf(neg.toLowerCase()) + neg.length);
    const w = contentWords(tokenize(after))[0];
    if (w) return [w.replace(/[.,!?;:]+$/, '')];
  }
  const content = contentWords(words);
  const last = content[content.length - 1];
  return last && words.length <= 10 ? [last.replace(/[.,!?;:]+$/, '')] : [];
}

/** Text between quotes, when the sentence quotes someone. */
export function findQuote(text: string): string | undefined {
  const m = /[“"«]\s*([^”"»]{8,})\s*[”"»]/.exec(text);
  return m?.[1]?.trim();
}
