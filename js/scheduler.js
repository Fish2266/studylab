/* scheduler.js — the adaptive engine behind Learn mode.
 *
 * A Leitner-style box system: a term moves up a box for each correct answer and
 * is mastered at `masteryTarget`. Wrong answers drop it back (all the way, or one
 * box, depending on the "penalty" setting). Boxes also map to spaced-repetition
 * intervals so a term studied today resurfaces on a sensible day.
 */
import { DEFAULT_CARD } from './data.js';

const DAY = 86400000;
const INTERVALS = [0, 0.4, 1, 3, 7, 16, 35];   // days per box

export function ensureCard(progress, termId) {
  return progress.cards[termId] || (progress.cards[termId] = { ...DEFAULT_CARD });
}

export function recordAnswer(progress, termId, correct, { masteryTarget = 2, penalty = 'reset' } = {}) {
  const c = ensureCard(progress, termId);
  const now = Date.now();
  c.seen++;
  c.lastSeen = now;
  if (correct) {
    c.right++;
    c.streak++;
    c.box = Math.min(c.box + 1, INTERVALS.length - 1);
    c.status = c.streak >= masteryTarget ? 'mastered' : 'learning';
  } else {
    c.wrong++;
    c.streak = 0;
    c.box = penalty === 'step' ? Math.max(0, c.box - 1) : 0;
    c.status = 'learning';
  }
  c.due = now + INTERVALS[Math.min(c.box, INTERVALS.length - 1)] * DAY;
  return c;
}

/** Lower score = study sooner. */
function urgency(card, now) {
  if (!card || card.status === 'new') return -1000;                 // brand new first
  if (card.status === 'mastered') return 1000 + (card.due - now) / DAY;
  const overdue = (now - (card.due || 0)) / DAY;
  return card.box * 10 - overdue * 3 - card.wrong * 2;
}

/**
 * Choose the terms for the next round.
 * Keeps unfinished work in front of new material so rounds feel like progress.
 */
export function buildRound(terms, progress, { roundSize = 7, masteryTarget = 2, includeMastered = false } = {}) {
  const now = Date.now();
  const pool = terms.filter(t => {
    const c = progress.cards[t.id];
    if (!c) return true;
    if (c.status === 'mastered' && !includeMastered) return false;
    return true;
  });
  if (!pool.length) return [];
  const ranked = pool
    .map(t => ({ t, u: urgency(progress.cards[t.id], now) }))
    .sort((a, b) => a.u - b.u);

  const inProgress = ranked.filter(r => { const c = progress.cards[r.t.id]; return c && c.status === 'learning'; });
  const fresh = ranked.filter(r => { const c = progress.cards[r.t.id]; return !c || c.status === 'new'; });
  const rest = ranked.filter(r => !inProgress.includes(r) && !fresh.includes(r));

  const size = Math.min(roundSize, pool.length);
  const out = [];
  const take = (list) => { for (const r of list) { if (out.length >= size) return; out.push(r.t); } };
  take(inProgress.slice(0, Math.max(1, Math.ceil(size * 0.6))));
  take(fresh);
  take(inProgress);
  take(rest);
  return out;
}

/**
 * Which question format a term deserves right now.
 * Early exposure is recognition (multiple choice / true-false); once a term is
 * familiar it graduates to recall (written). Honours the user's enabled types.
 */
export function questionKindFor(card, types, { rng = Math.random } = {}) {
  const enabled = Object.entries(types).filter(([, on]) => on).map(([k]) => k);
  if (!enabled.length) return 'multiple';
  const box = card ? card.box : 0;
  const prefer = [];
  if (box === 0) prefer.push('multiple', 'truefalse', 'flashcard', 'written');
  else if (box === 1) prefer.push('written', 'multiple', 'truefalse', 'flashcard');
  else prefer.push('written', 'multiple', 'truefalse', 'flashcard');

  const ordered = prefer.filter(k => enabled.includes(k));
  if (!ordered.length) return enabled[0];
  // A term you have never seen always gets its easiest enabled format; after
  // that, mix in some variety so rounds do not feel rote.
  if (box > 0 && ordered.length > 1 && rng() < 0.2) return ordered[1 + Math.floor(rng() * (ordered.length - 1))];
  return ordered[0];
}

/** Human-readable "next review" label used on the set overview. */
export function nextReviewLabel(progress) {
  const dues = Object.values(progress.cards || {})
    .filter(c => c.status === 'learning' || c.status === 'mastered')
    .map(c => c.due || 0)
    .filter(Boolean);
  if (!dues.length) return '';
  const soonest = Math.min(...dues);
  const diff = soonest - Date.now();
  if (diff <= 0) return 'Due now';
  if (diff < DAY) return `Due in ${Math.max(1, Math.round(diff / 3600000))}h`;
  return `Due in ${Math.round(diff / DAY)}d`;
}
