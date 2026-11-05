/* main.js — boot the app: storage, theme, routes, global shortcuts. */
import { $, el, icon, isTyping } from './utils.js';
import * as data from './data.js';
import { applyAppearance, watchSystemTheme, nextTheme, THEME_LABEL } from './theme.js';
import { addRoute, startRouter, navigate } from './router.js';
import { toast } from './ui.js';

/* Screens load on demand: the first paint only needs the library (and its few
 * imports, preloaded from index.html), not all 30-odd modules. The rest are
 * fetched in the background right after (prefetchViews), so moving around is
 * still instant. Loading everything up front made a first visit arrive in five
 * sequential waves of requests — 3.3s before the library showed on a 4G phone. */
// `retry` re-requests under a fresh URL: browsers remember a failed module load
// and would otherwise fail the same import() again for the life of the page.
const view = (path) => (retry = false) => import(retry ? `${path}?retry=${Date.now()}` : path);
const VIEWS = {
  library: view('./views/library.js'),
  setview: view('./views/setview.js'),
  editor: view('./views/editor.js'),
  flashcards: view('./views/flashcards.js'),
  learn: view('./views/learn.js'),
  test: view('./views/test.js'),
  match: view('./views/match.js'),
  importview: view('./views/importview.js'),
  settings: view('./views/settings.js'),
  shared: view('./views/shared.js'),
};
const openShortcutsDialog = () => import('./views/dialogs.js').then(m => m.openShortcutsDialog());

function registerRoutes() {
  addRoute(/^\/$/, VIEWS.library);
  addRoute(/^\/create$/, VIEWS.editor);
  addRoute(/^\/import(?:\?.*)?$/, VIEWS.importview);
  addRoute(/^\/settings$/, VIEWS.settings);
  addRoute(/^\/s\/(.+)$/, VIEWS.shared);
  addRoute(/^\/set\/([^/?]+)\/edit$/, VIEWS.editor);
  addRoute(/^\/set\/([^/?]+)\/flashcards$/, VIEWS.flashcards);
  addRoute(/^\/set\/([^/?]+)\/learn$/, VIEWS.learn);
  addRoute(/^\/set\/([^/?]+)\/test$/, VIEWS.test);
  addRoute(/^\/set\/([^/?]+)\/match$/, VIEWS.match);
  addRoute(/^\/set\/([^/?]+)$/, VIEWS.setview);
}

/** Warm every other screen once the first one is on screen and the browser is idle. */
function prefetchViews() {
  const go = () => { for (const load of Object.values(VIEWS)) load().catch(() => { /* offline on a first visit: fetched (fresh) on demand later */ }); };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 1200);
}

/* ---------- global keyboard shortcuts ---------- */
let chord = null;
let chordTimer = null;
function installShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (isTyping(e)) return;

    if (chord === 'g') {
      clearTimeout(chordTimer);
      chord = null;
      const k = e.key.toLowerCase();
      if (k === 'l') { e.preventDefault(); navigate('/'); return; }
      if (k === 'c') { e.preventDefault(); navigate('/create'); return; }
      if (k === 'i') { e.preventDefault(); navigate('/import'); return; }
      if (k === 's') { e.preventDefault(); navigate('/settings'); return; }
      return;
    }

    if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); openShortcutsDialog(); return; }
    if (e.key.toLowerCase() === 'g') {
      chord = 'g';
      clearTimeout(chordTimer);
      chordTimer = setTimeout(() => { chord = null; }, 1200);
      return;
    }
    // Mode views own T, so only handle it on non-study screens.
    if (e.key.toLowerCase() === 't' && !location.hash.match(/\/(flashcards|learn|test|match)$/)) {
      e.preventDefault();
      toggleTheme();
    }
  });
}

async function toggleTheme() {
  const theme = nextTheme(data.getSettings().theme);
  applyAppearance(await data.saveSettings({ theme }));
  toast(`Theme: ${THEME_LABEL[theme]}`, { timeout: 1400 });
}

/* ---------- chrome wiring ---------- */
function installChrome() {
  const themeBtn = $('#btn-theme');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  const shortcutsBtn = $('#btn-shortcuts');
  if (shortcutsBtn) shortcutsBtn.addEventListener('click', openShortcutsDialog);
}

/* ---------- offline support ---------- */
function installServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // Boot is async, so `load` has usually fired by the time we get here —
  // waiting for it again would mean never registering at all.
  // updateViaCache: 'none' so the browser fetches sw.js from the network on
  // every check. Left to the HTTP cache, a new worker — and with it a new
  // deploy — can sit unnoticed for as long as the cache headers allow.
  const register = () => navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then(reg => {
      // A home-screen app can stay open for days: look for a new version when it comes back to the front.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    })
    .catch(() => { /* offline support is a bonus, not a requirement */ });

  // The worker is cache-first, so a new deploy arrives as a new worker taking
  // over (controllerchange). Swap to it straight away if the app was only just
  // opened on a screen with nothing in progress; otherwise ask, so an update
  // never throws away a Learn round, a test or unsaved edits.
  const hadController = !!navigator.serviceWorker.controller;   // first install: nothing to update from
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    const route = location.hash.replace(/^#/, '') || '/';
    const calm = /^\/(?:|settings|set\/[^/]+)$/.test(route) && !document.querySelector('.modal-backdrop');
    if (calm && performance.now() < 10000) { reloading = true; location.reload(); return; }
    toast('StudyLab has been updated.', { timeout: 0, action: { label: 'Reload', onClick: () => { reloading = true; location.reload(); } } });
  });
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/* ---------- failure surface ---------- */
function installErrorReporting() {
  window.addEventListener('error', (e) => {
    if (e.message && /ResizeObserver/.test(e.message)) return;    // benign, browser-internal
    console.error(e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    const msg = e.reason && e.reason.message ? e.reason.message : 'Something went wrong';
    toast(msg, { type: 'bad', timeout: 6000 });
  });
}

function fatal(message) {
  const main = $('#main');
  if (!main) return;
  main.replaceChildren(el('div', { class: 'empty' },
    el('div', { class: 'empty__icon' }, icon('warn')),
    el('h1', {}, 'StudyLab could not start'),
    el('p', {}, message),
    el('button', { class: 'btn btn--primary', type: 'button', onclick: () => location.reload() }, 'Try again')));
}

async function boot() {
  installErrorReporting();
  try {
    const backend = await data.init();
    applyAppearance(data.getSettings());
    watchSystemTheme();
    installChrome();
    installShortcuts();
    registerRoutes();
    startRouter();
    prefetchViews();
    installServiceWorker();
    // First study of the day: a small nudge that the streak grew.
    window.addEventListener('studylab:streak', (e) => {
      const n = e.detail && e.detail.current;
      if (n >= 2) toast(`🔥 ${n}-day streak — nice!`, { type: 'good', timeout: 2600 });
    });

    if (backend === 'memory') {
      toast('This browser is blocking storage, so nothing will be saved when you close the tab. Export a backup before you leave.', { type: 'bad', timeout: 12000 });
    } else if (backend === 'ls') {
      console.info('StudyLab: using localStorage (IndexedDB unavailable).');
    }
  } catch (err) {
    console.error(err);
    fatal(err && err.message ? err.message : 'Unknown error while loading your data.');
  }
}

boot();
