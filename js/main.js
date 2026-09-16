/* main.js — boot the app: storage, theme, routes, global shortcuts. */
import { $, el, icon, isTyping } from './utils.js';
import * as data from './data.js';
import { applyAppearance, watchSystemTheme, nextTheme, THEME_LABEL } from './theme.js';
import { addRoute, startRouter, navigate } from './router.js';
import { toast } from './ui.js';
import { openShortcutsDialog } from './views/dialogs.js';

import * as library from './views/library.js';
import * as setview from './views/setview.js';
import * as editor from './views/editor.js';
import * as flashcards from './views/flashcards.js';
import * as learn from './views/learn.js';
import * as test from './views/test.js';
import * as match from './views/match.js';
import * as importview from './views/importview.js';
import * as settings from './views/settings.js';
import * as shared from './views/shared.js';

const mod = (m) => () => Promise.resolve(m);

function registerRoutes() {
  addRoute(/^\/$/, mod(library));
  addRoute(/^\/create$/, mod(editor));
  addRoute(/^\/import(?:\?.*)?$/, mod(importview));
  addRoute(/^\/settings$/, mod(settings));
  addRoute(/^\/s\/(.+)$/, mod(shared));
  addRoute(/^\/set\/([^/?]+)\/edit$/, mod(editor));
  addRoute(/^\/set\/([^/?]+)\/flashcards$/, mod(flashcards));
  addRoute(/^\/set\/([^/?]+)\/learn$/, mod(learn));
  addRoute(/^\/set\/([^/?]+)\/test$/, mod(test));
  addRoute(/^\/set\/([^/?]+)\/match$/, mod(match));
  addRoute(/^\/set\/([^/?]+)$/, mod(setview));
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
  const register = () => navigator.serviceWorker
    .register('sw.js')
    .catch(() => { /* offline support is a bonus, not a requirement */ });
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
    installServiceWorker();

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
