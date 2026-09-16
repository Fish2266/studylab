/* grading.js — answer checking for Learn and Test ("smart grading").
 *
 * Mirrors what people expect from Quizlet: capitalisation, punctuation, accents
 * and articles are ignored; "a / b" style answers accept either side; a single
 * typo is reported separately so the learner can be told "almost" instead of
 * being marked wrong outright.
 */
import { stripDiacritics } from './utils.js';

const ARTICLES = /^(the|a|an|to|el|la|los|las|un|una|le|les|der|die|das|il|lo|gli)\s+/i;

/** Levenshtein distance with a cheap early exit — answers are short. */
export function editDistance(a, b, cap = 8) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Three strictness levels:
 *   'exact' — trimmed, character for character.
 *   'basic' — case and surrounding whitespace ignored, nothing else.
 *   'smart' — also ignores punctuation, accents and leading articles.
 */
export function normalize(text, opts = {}) {
  const level = opts.level || (opts.exact ? 'exact' : 'smart');
  let s = String(text ?? '').normalize('NFC').trim();
  if (level === 'exact') return s;
  s = s.toLowerCase().replace(/\s+/g, ' ');
  if (level === 'basic') return s;

  s = stripDiacritics(s);
  s = s.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  // Apostrophes are dropped rather than spaced, so "it's" matches "its".
  s = s.replace(/['`´]/g, '');
  s = s.replace(/[.,;:!?¿¡"()[\]{}<>«»…*_~#]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (opts.ignoreArticles !== false) s = s.replace(ARTICLES, '');
  return s;
}

/** Every string that should count as a correct response to `answer`. */
export function acceptedVariants(answer, opts = {}) {
  const raw = String(answer ?? '');
  const out = new Set();
  const add = (v) => { const n = normalize(v, opts); if (n) out.add(n); };

  add(raw);
  // "cat / kitty", "cat; kitty", or one per line → either is fine.
  const parts = raw.split(/\s*[\/;\n]\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) parts.forEach(add);
  // Parenthesised or bracketed qualifiers are optional: "(to) run" ≡ "run".
  const noParens = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (noParens) {
    add(noParens);
    noParens.split(/\s*[\/;]\s*/).map(s => s.trim()).filter(Boolean).forEach(add);
  }
  // …and so is the surrounding text, so the qualifier alone also counts.
  const parenOnly = [...raw.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim()).filter(Boolean);
  if (parenOnly.length === 1 && !noParens) add(parenOnly[0]);

  if (opts.commaAlternatives) raw.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean).forEach(add);
  return [...out];
}

/**
 * @returns {{correct:boolean, close:boolean, distance:number, expected:string}}
 *   `close` means "one or two typos away" — the caller decides whether to accept
 *   it (settings.acceptTypos) or show a "check your spelling" retry.
 */
export function grade(userAnswer, expected, opts = {}) {
  const level = opts.requireExact ? 'exact' : opts.smart === false ? 'basic' : 'smart';
  const gopts = { level, ignoreArticles: opts.ignoreArticles !== false, commaAlternatives: !!opts.commaAlternatives };
  const user = normalize(userAnswer, gopts);
  const result = { correct: false, close: false, distance: Infinity, expected: String(expected ?? ''), level };
  if (!user) return result;

  const variants = level === 'smart' ? acceptedVariants(expected, gopts) : [normalize(expected, gopts)];
  for (const v of variants) {
    if (!v) continue;
    if (v === user) return { ...result, correct: true, distance: 0 };
  }
  if (level !== 'smart') return result;

  let best = Infinity;
  for (const v of variants) {
    if (!v) continue;
    const d = editDistance(user, v, 4);
    if (d < best) best = d;
  }
  result.distance = best;
  const target = variants[0] || '';
  const tolerance = target.length <= 4 ? 1 : target.length <= 9 ? 1 : target.length <= 16 ? 2 : 3;
  result.close = best <= tolerance;
  return result;
}

/** Cheap dedupe key — full `normalize` is far too expensive to run over a
 *  thousand-item pool for every single question. */
const dedupeKey = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Pick plausible wrong answers, preferring options of a similar shape to the
 * real one so a one-word answer is not obvious among essays.
 *
 * Only a bounded random window of the pool is inspected, so cost stays flat
 * whether the set has 20 terms or 5,000.
 */
export function distractors(correctText, pool, n, rng = Math.random) {
  if (!pool.length || n <= 0) return [];
  const correctKey = dedupeKey(correctText);
  const target = String(correctText || '').length;
  const windowSize = Math.min(pool.length, Math.max(24, n * 10));

  // Partial Fisher-Yates over an index array: sample without replacement,
  // touching only `windowSize` entries rather than sorting the whole pool.
  const idx = new Int32Array(pool.length);
  for (let i = 0; i < pool.length; i++) idx[i] = i;
  const seen = new Set([correctKey]);
  const scored = [];
  for (let i = 0; i < windowSize; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
    const text = pool[idx[i]];
    const key = dedupeKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    scored.push({ text, d: Math.abs(text.length - target) + rng() * target * 0.9 });
  }
  if (scored.length <= n) return scored.map(s => s.text);

  scored.sort((a, b) => a.d - b.d);
  const near = scored.slice(0, n * 3);
  const out = [];
  while (out.length < n && near.length) out.push(near.splice(Math.floor(rng() * near.length), 1)[0].text);
  return out;
}
