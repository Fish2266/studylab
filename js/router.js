/* router.js — hash routing (works on GitHub Pages with no server rewrites).
 * Views are plain modules exporting `render(mount, ctx)` and may return
 * `{ destroy() }` so timers, listeners and speech are torn down on navigation.
 */
import { $, el, icon } from './utils.js';
import { closeMenu } from './ui.js';

const routes = [];
let current = null;         // { destroy? }
let currentPath = null;
let pendingGuard = null;    // () => boolean|Promise<boolean> — lets the editor confirm unsaved work

export function addRoute(pattern, loader, opts = {}) {
  routes.push({ pattern, loader, ...opts });
}
/** A view can block navigation (unsaved changes). Cleared automatically on leave. */
export function setGuard(fn) { pendingGuard = fn; }

export function navigate(path, { replace = false } = {}) {
  const hash = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === hash) { handle(); return; }
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const path = raw.startsWith('/') ? raw : '/' + raw;
  return path;
}

function match(path) {
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) return { route: r, params: m.slice(1).map(decodeURIComponentSafe) };
  }
  return null;
}
function decodeURIComponentSafe(s) {
  if (s === undefined) return s;
  try { return decodeURIComponent(s); } catch { return s; }
}

let navToken = 0;
async function handle() {
  const path = parse();
  if (path === currentPath) return;

  if (pendingGuard) {
    const guard = pendingGuard;
    const ok = await guard(path);
    if (!ok) {                                   // stay put, restore the old hash
      if (currentPath) history.replaceState(null, '', '#' + currentPath);
      return;
    }
    pendingGuard = null;
  }

  const token = ++navToken;
  closeMenu();
  const hit = match(path);
  const mount = $('#main');

  if (current && current.destroy) { try { current.destroy(); } catch (err) { console.error('view teardown failed', err); } }
  current = null;
  mount.replaceChildren();
  mount.className = 'main';
  currentPath = path;
  syncNav(path);

  if (!hit) { renderNotFound(mount); return; }

  try {
    const mod = await hit.route.loader();
    if (token !== navToken) return;              // a newer navigation won
    current = mod.render(mount, { params: hit.params, path }) || null;
  } catch (err) {
    if (token !== navToken) return;
    console.error('route failed', err);
    renderError(mount, err);
    return;
  }

  // Start each view at the top; focus and title follow once the heading exists.
  window.scrollTo({ top: 0, behavior: 'auto' });
  whenHeadingReady(mount, token);
}

/** Views load data asynchronously, so the heading may not exist yet. Wait for
 *  it (briefly) before moving focus and naming the page. */
function whenHeadingReady(mount, token) {
  const apply = (h1) => {
    if (token !== navToken) return;
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    document.title = (h1 ? h1.textContent.trim() + ' · ' : '') + 'StudyLab';
  };
  const existing = mount.querySelector('h1');
  if (existing) { apply(existing); return; }

  let settled = false;
  const finish = (h1) => {
    if (settled) return;
    settled = true;
    observer.disconnect();
    clearTimeout(timer);
    apply(h1);
  };
  const observer = new MutationObserver(() => {
    if (token !== navToken) { finish(null); return; }
    const h1 = mount.querySelector('h1');
    if (h1) finish(h1);
  });
  observer.observe(mount, { childList: true, subtree: true });
  const timer = setTimeout(() => finish(mount.querySelector('h1')), 2500);
}

function syncNav(path) {
  for (const a of document.querySelectorAll('.topnav a')) {
    const key = a.dataset.nav;
    const active = (key === 'library' && path === '/') || (key !== 'library' && path.startsWith('/' + key));
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function renderNotFound(mount) {
  mount.appendChild(el('div', { class: 'empty' },
    el('div', { class: 'empty__icon' }, icon('search')),
    el('h1', {}, 'Page not found'),
    el('p', {}, 'That link does not point anywhere in StudyLab.'),
    el('a', { class: 'btn btn--primary', href: '#/' }, 'Back to your library')));
  document.title = 'Not found · StudyLab';
}
function renderError(mount, err) {
  mount.appendChild(el('div', { class: 'empty' },
    el('div', { class: 'empty__icon' }, icon('warn')),
    el('h1', {}, 'Something went wrong'),
    el('p', {}, String((err && err.message) || err || 'Unknown error')),
    el('div', { class: 'row', style: { justifyContent: 'center' } },
      el('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Reload'),
      el('a', { class: 'btn btn--primary', href: '#/' }, 'Back to library'))));
}

export function startRouter() {
  window.addEventListener('hashchange', handle);
  handle();
}
