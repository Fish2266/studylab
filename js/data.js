/* data.js — the domain model: sets, terms, progress, settings.
 *
 * Sets are stored whole in IndexedDB, but the library screen reads a lightweight
 * index (title/count/timestamps only) so opening the app stays fast no matter how
 * many thousand-term sets are saved. The index is derived state: `rebuildIndex()`
 * can always reconstruct it from the sets themselves.
 */
import * as store from './storage.js';
import { uid } from './utils.js';

export const SCHEMA_VERSION = 1;

/* ---------- defaults ---------- */
export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',                 // system | light | dark
  accentHue: 245,
  fontScale: 1,
  readFont: 'sans',                // sans | serif | mono | dys
  reduceMotion: false,
  confirmDelete: true,
  sound: false,
  library: { sort: 'updated', view: 'grid' },

  flashcards: {
    front: 'term',                 // term | definition | random
    shuffle: false,
    trackProgress: true,
    starredOnly: false,
    unknownOnly: false,
    autoplay: false,
    autoplaySpeed: 4,              // seconds per side
    speak: false,
    speakSide: 'both',             // front | back | both
    showHints: true,
  },
  learn: {
    answerWith: 'definition',      // term | definition | both
    types: { multiple: true, written: true, truefalse: false, flashcard: false },
    roundSize: 7,
    masteryTarget: 2,              // consecutive correct answers to master
    smartGrading: true,
    acceptTypos: true,
    requireExact: false,
    instantNext: true,             // auto-advance after a correct answer
    shuffle: true,
    starredOnly: false,
    speak: false,
    showHints: true,
    penalty: 'reset',              // reset | step
  },
  test: {
    questionCount: 20,
    types: { written: true, multiple: true, truefalse: true, matching: false },
    answerWith: 'definition',
    instantFeedback: false,
    shuffle: true,
    starredOnly: false,
    unmasteredOnly: false,
    smartGrading: true,
    timeLimit: 0,                  // minutes, 0 = untimed
  },
  match: { pairs: 6, source: 'all' },
});

export const DEFAULT_CARD = Object.freeze({
  box: 0, right: 0, wrong: 0, streak: 0, seen: 0,
  lastSeen: 0, due: 0, status: 'new', fc: null,
});

/* ---------- in-memory caches ---------- */
let settings = structuredCloneSafe(DEFAULT_SETTINGS);
let index = [];                              // [{id,title,description,count,createdAt,updatedAt,folder}]
const setCache = new Map();                  // id -> full set (bounded)
const progressCache = new Map();
const MAX_CACHED_SETS = 12;

function structuredCloneSafe(v) {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}
/** Deep-merge stored settings over defaults so new options appear for old users. */
function mergeDefaults(base, over) {
  if (!over || typeof over !== 'object') return structuredCloneSafe(base);
  const out = structuredCloneSafe(base);
  for (const [k, v] of Object.entries(over)) {
    if (!(k in out)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = mergeDefaults(out[k], v);
    } else if (v !== null && v !== undefined && typeof v === typeof out[k]) {
      out[k] = v;
    }
  }
  return out;
}

/* ---------- boot ---------- */
export async function init() {
  const backend = await store.initStorage();
  settings = mergeDefaults(DEFAULT_SETTINGS, await store.kvGet('settings'));
  index = (await store.kvGet('index')) || [];
  if (!Array.isArray(index)) index = [];
  // Self-heal: if the index is empty but sets exist (or vice versa), rebuild.
  const rows = await store.getAll('sets');
  if (rows.length !== index.length) await rebuildIndex(rows);
  return backend;
}
export async function rebuildIndex(rows) {
  const all = rows || await store.getAll('sets');
  index = all.filter(Boolean).map(toIndexRow).sort((a, b) => b.updatedAt - a.updatedAt);
  await store.kvSet('index', index);
  return index;
}
function toIndexRow(s) {
  return {
    id: s.id, title: s.title, description: s.description || '',
    count: Array.isArray(s.terms) ? s.terms.length : 0,
    createdAt: s.createdAt, updatedAt: s.updatedAt, folder: s.folder || '',
  };
}

/* ---------- settings ---------- */
export const getSettings = () => settings;
export async function saveSettings(patch) {
  settings = mergeDefaults(settings, patch);
  await store.kvSet('settings', settings);
  return settings;
}
export async function resetSettings() {
  settings = structuredCloneSafe(DEFAULT_SETTINGS);
  await store.kvSet('settings', settings);
  return settings;
}
/** Persist one mode's options (called whenever a study-options panel changes). */
export function saveModeOptions(mode, opts) { return saveSettings({ [mode]: opts }); }

/* ---------- sets ---------- */
export const getIndex = () => index;

export function newSet(partial = {}) {
  const now = Date.now();
  return {
    id: uid('set_'), schema: SCHEMA_VERSION,
    title: partial.title || 'Untitled set',
    description: partial.description || '',
    folder: partial.folder || '',
    termLang: partial.termLang || '', defLang: partial.defLang || '',
    createdAt: now, updatedAt: now,
    terms: (partial.terms || []).map(newTerm),
  };
}
export function newTerm(t = {}) {
  return {
    id: t.id || uid('t_'),
    term: String(t.term ?? '').slice(0, 5000),
    definition: String(t.definition ?? '').slice(0, 5000),
    hint: String(t.hint ?? '').slice(0, 1000),
    starred: !!t.starred,
  };
}

export async function getSet(id) {
  if (setCache.has(id)) return setCache.get(id);
  const s = await store.get('sets', id);
  if (!s) return null;
  const clean = normalizeSet(s);
  cacheSet(clean);
  return clean;
}
function cacheSet(s) {
  setCache.set(s.id, s);
  if (setCache.size > MAX_CACHED_SETS) setCache.delete(setCache.keys().next().value);
}

/** Defensive normalisation — imported or hand-edited data can be anything. */
export function normalizeSet(raw) {
  const now = Date.now();
  const terms = Array.isArray(raw.terms) ? raw.terms.filter(t => t && typeof t === 'object').map(newTerm) : [];
  const seen = new Set();
  for (const t of terms) {                              // guarantee unique ids
    if (seen.has(t.id)) t.id = uid('t_');
    seen.add(t.id);
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('set_'),
    schema: SCHEMA_VERSION,
    title: String(raw.title ?? 'Untitled set').slice(0, 300) || 'Untitled set',
    description: String(raw.description ?? '').slice(0, 2000),
    folder: String(raw.folder ?? '').slice(0, 120),
    termLang: String(raw.termLang ?? '').slice(0, 20),
    defLang: String(raw.defLang ?? '').slice(0, 20),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    terms,
  };
}

export async function saveSet(set, { touch = true } = {}) {
  if (touch) set.updatedAt = Date.now();
  await store.put('sets', set);
  cacheSet(set);
  const row = toIndexRow(set);
  const i = index.findIndex(r => r.id === set.id);
  if (i === -1) index.unshift(row); else index[i] = row;
  await store.kvSet('index', index);
  return set;
}
export async function deleteSet(id) {
  const snapshot = await getSet(id);
  const progress = await store.get('progress', id);
  await store.del('sets', id);
  await store.del('progress', id);
  setCache.delete(id);
  progressCache.delete(id);
  index = index.filter(r => r.id !== id);
  await store.kvSet('index', index);
  return { set: snapshot, progress };                   // returned so delete can be undone
}
export async function restoreSet(snapshot, progress) {
  if (!snapshot) return;
  await saveSet(snapshot, { touch: false });
  if (progress) await store.put('progress', progress);
}
export async function duplicateSet(id) {
  const src = await getSet(id);
  if (!src) return null;
  const copy = newSet({ ...src, title: `${src.title} (copy)`, terms: src.terms.map(t => ({ ...t, id: undefined })) });
  await saveSet(copy);
  return copy;
}

/* ---------- progress ---------- */
export async function getProgress(setId) {
  if (progressCache.has(setId)) return progressCache.get(setId);
  const row = await store.get('progress', setId);
  const p = row && typeof row === 'object' && row.cards ? row : { id: setId, cards: {}, updatedAt: 0, sessions: {} };
  if (!p.sessions) p.sessions = {};
  progressCache.set(setId, p);
  return p;
}
export async function saveProgress(p) {
  p.updatedAt = Date.now();
  progressCache.set(p.id, p);
  await store.put('progress', p);
  return p;
}
export async function resetProgress(setId, { keepStars = true } = {}) {
  const p = { id: setId, cards: {}, updatedAt: Date.now(), sessions: {} };
  progressCache.set(setId, p);
  await store.put('progress', p);
  if (!keepStars) {
    const s = await getSet(setId);
    if (s) { s.terms.forEach(t => { t.starred = false; }); await saveSet(s); }
  }
  return p;
}

/** Counts used by every progress bar in the app. */
export function summarize(set, progress) {
  let mastered = 0, learning = 0, notStarted = 0, starred = 0;
  for (const t of set.terms) {
    if (t.starred) starred++;
    const c = progress.cards[t.id];
    if (!c || c.status === 'new') notStarted++;
    else if (c.status === 'mastered') mastered++;
    else learning++;
  }
  const total = set.terms.length;
  return { total, mastered, learning, notStarted, starred, pct: total ? Math.round((mastered / total) * 100) : 0 };
}

/* ---------- bulk export / import ---------- */
export async function exportAll() {
  const sets = await store.getAll('sets');
  const progress = await store.getAll('progress');
  return {
    app: 'StudyLab', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    settings, sets: sets.map(normalizeSet), progress,
  };
}
export async function importBackup(data, { mode = 'merge' } = {}) {
  if (!data || typeof data !== 'object') throw new Error('That file is not a StudyLab backup.');
  const incoming = Array.isArray(data.sets) ? data.sets : (Array.isArray(data) ? data : null);
  if (!incoming) throw new Error('No sets found in that file.');
  if (mode === 'replace') {
    await store.clearStore('sets');
    await store.clearStore('progress');
    index = [];
  }
  const existing = new Set(index.map(r => r.id));
  const sets = [], progressRows = [];
  const idMap = new Map();
  for (const raw of incoming) {
    const s = normalizeSet(raw);
    if (mode === 'merge' && existing.has(s.id)) {       // keep both copies rather than clobber
      const oldId = s.id;
      s.id = uid('set_');
      s.title = `${s.title} (imported)`;
      idMap.set(oldId, s.id);
    }
    sets.push(s);
  }
  if (Array.isArray(data.progress)) {
    for (const p of data.progress) {
      if (!p || typeof p !== 'object' || !p.id) continue;
      const id = idMap.get(p.id) || p.id;
      progressRows.push({ id, cards: p.cards && typeof p.cards === 'object' ? p.cards : {}, sessions: {}, updatedAt: p.updatedAt || 0 });
    }
  }
  await store.putMany('sets', sets);
  await store.putMany('progress', progressRows);
  if (data.settings && mode === 'replace') await saveSettings(data.settings);
  setCache.clear(); progressCache.clear();
  await rebuildIndex();
  return sets.length;
}

/* ---------- misc ---------- */export function folders() {
  return [...new Set(index.map(r => r.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
