/* storage.js — durable local persistence.
 *
 * Primary store: IndexedDB (no practical size cap, survives reloads and browser
 * restarts). Fallback: localStorage, used automatically when IndexedDB is
 * unavailable or blocked (private windows, embedded webviews, disabled storage).
 * Every write goes through `withRetry` so a transient failure surfaces as a
 * recoverable error instead of silently losing a user's set.
 */

const DB_NAME = 'studylab';
const DB_VERSION = 1;
const STORES = ['sets', 'progress', 'kv'];
const LS_PREFIX = 'studylab:';

let dbPromise = null;
let backend = 'unknown';           // 'idb' | 'ls' | 'memory'
const memory = new Map();          // last-resort store so the app still runs

export const getBackend = () => backend;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (err) { return reject(err); }

    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
    // Safari can leave open() hanging forever in some private-mode states.
    setTimeout(() => reject(new Error('IndexedDB open timed out')), 4000);
  }).catch(err => { dbPromise = null; throw err; });
  return dbPromise;
}

function idbRequest(storeName, mode, run) {
  return openDB().then(db => new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(storeName, mode); }
    catch (err) { return reject(err); }
    const req = run(tx.objectStore(storeName));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
  }));
}

/* ---------- localStorage fallback ---------- */
const lsKey = (store, id) => `${LS_PREFIX}${store}:${id}`;
const ls = {
  get(store, id) {
    try { const raw = localStorage.getItem(lsKey(store, id)); return raw ? JSON.parse(raw) : undefined; }
    catch { return undefined; }
  },
  all(store) {
    const out = [], prefix = `${LS_PREFIX}${store}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      try { out.push(JSON.parse(localStorage.getItem(k))); } catch { /* skip corrupt row */ }
    }
    return out;
  },
  put(store, value) { localStorage.setItem(lsKey(store, value.id), JSON.stringify(value)); },
  del(store, id) { localStorage.removeItem(lsKey(store, id)); },
  clear(store) {
    const prefix = `${LS_PREFIX}${store}:`;
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
  },
};
const mem = {
  key: (s, id) => `${s}:${id}`,
  get(s, id) { return memory.get(mem.key(s, id)); },
  all(s) { return [...memory.entries()].filter(([k]) => k.startsWith(s + ':')).map(([, v]) => v); },
  put(s, v) { memory.set(mem.key(s, v.id), v); },
  del(s, id) { memory.delete(mem.key(s, id)); },
  clear(s) { for (const k of [...memory.keys()]) if (k.startsWith(s + ':')) memory.delete(k); },
};

/** Probe once at boot so the rest of the app can assume a working backend. */
export async function initStorage() {
  try {
    await openDB();
    await idbRequest('kv', 'readwrite', s => s.put({ id: '__probe', t: Date.now() }));
    await idbRequest('kv', 'readwrite', s => s.delete('__probe'));
    backend = 'idb';
  } catch {
    try {
      localStorage.setItem(LS_PREFIX + '__probe', '1');
      localStorage.removeItem(LS_PREFIX + '__probe');
      backend = 'ls';
      await migrateIdbLeftovers();
    } catch {
      backend = 'memory';
    }
  }
  return backend;
}
/** If IndexedDB was working before and is not now, we do not want to lose data
 *  silently — but we also cannot read it. Nothing to migrate; kept as a hook. */
async function migrateIdbLeftovers() { /* intentionally empty */ }

/* ---------- public API ---------- */
async function withRetry(fn, label) {
  try { return await fn(); }
  catch (err) {
    if (backend === 'idb') {
      dbPromise = null;                                   // force a reconnect once
      try { return await fn(); }
      catch (err2) { throw annotate(err2, label); }
    }
    throw annotate(err, label);
  }
}
function annotate(err, label) {
  const e = new Error(`${label}: ${err && err.message ? err.message : 'storage error'}`);
  e.cause = err;
  e.quota = !!(err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || '')));
  return e;
}

export function get(store, id) {
  if (backend === 'idb') return withRetry(() => idbRequest(store, 'readonly', s => s.get(id)), 'read');
  return Promise.resolve((backend === 'ls' ? ls : mem).get(store, id));
}
export function getAll(store) {
  if (backend === 'idb') return withRetry(() => idbRequest(store, 'readonly', s => s.getAll()), 'read');
  return Promise.resolve((backend === 'ls' ? ls : mem).all(store));
}
export function put(store, value) {
  if (backend === 'idb') return withRetry(() => idbRequest(store, 'readwrite', s => s.put(value)), 'save');
  try { (backend === 'ls' ? ls : mem).put(store, value); return Promise.resolve(); }
  catch (err) { return Promise.reject(annotate(err, 'save')); }
}
export function putMany(store, values) {
  if (!values.length) return Promise.resolve();
  if (backend === 'idb') {
    return withRetry(() => idbRequest(store, 'readwrite', s => { values.forEach(v => s.put(v)); }), 'save');
  }
  try { values.forEach(v => (backend === 'ls' ? ls : mem).put(store, v)); return Promise.resolve(); }
  catch (err) { return Promise.reject(annotate(err, 'save')); }
}
export function del(store, id) {
  if (backend === 'idb') return withRetry(() => idbRequest(store, 'readwrite', s => s.delete(id)), 'delete');
  (backend === 'ls' ? ls : mem).del(store, id);
  return Promise.resolve();
}
export function clearStore(store) {
  if (backend === 'idb') return withRetry(() => idbRequest(store, 'readwrite', s => s.clear()), 'clear');
  (backend === 'ls' ? ls : mem).clear(store);
  return Promise.resolve();
}

/* ---------- key/value helpers ---------- */
export async function kvGet(key, fallback = null) {
  const row = await get('kv', key);
  return row && 'v' in row ? row.v : fallback;
}
export function kvSet(key, v) { return put('kv', { id: key, v }); }

/* ---------- capacity reporting (Settings panel) ---------- */
export async function estimateUsage() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    } catch { /* not supported */ }
  }
  if (backend === 'ls') {
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) bytes += k.length + (localStorage.getItem(k) || '').length;
    }
    return { usage: bytes * 2, quota: 5 * 1024 * 1024 };
  }
  return { usage: 0, quota: 0 };
}

/** Ask the browser to make storage persistent so it is not evicted under pressure. */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch { return 'unsupported'; }
}
export async function isPersisted() {
  try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; }
  catch { return false; }
}
