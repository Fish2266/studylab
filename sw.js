/* sw.js — offline support.
 *
 * Strategy: the shell — the page itself, its CSS and its JS — is network-first
 * with a cache fallback, so a deploy is live the moment you reload and the app
 * still opens with no connection. Everything else is stale-while-revalidate.
 *
 * It used to be stale-while-revalidate throughout, which meant a fix took two
 * reloads to appear: the first served the old files and only then refreshed
 * the cache. Study data is NOT here — that lives in IndexedDB and is never
 * cached or uploaded.
 */
const VERSION = 'studylab-v5';
const SCOPE = new URL(self.registration.scope);

const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'css/modes.css',
  'css/mobile.css',
  'js/main.js',
  'js/utils.js',
  'js/ui.js',
  'js/data.js',
  'js/storage.js',
  'js/router.js',
  'js/theme.js',
  'js/grading.js',
  'js/scheduler.js',
  'js/speech.js',
  'js/importers.js',
  'js/share.js',
  'js/views/library.js',
  'js/views/setview.js',
  'js/views/editor.js',
  'js/views/flashcards.js',
  'js/views/learn.js',
  'js/views/test.js',
  'js/views/match.js',
  'js/views/importview.js',
  'js/views/settings.js',
  'js/views/shared.js',
  'js/views/dialogs.js',
  'js/views/options.js',
].map(p => new URL(p, SCOPE).href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Individually, so one 404 cannot fail the whole install.
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  // The shell is what a deploy changes, so it is never served stale while a
  // network is available.
  const isShell = req.mode === 'navigate' || /\.(?:html|css|js)$/.test(url.pathname);

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: false });

    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);

    if (isShell) {
      const fresh = await network;
      if (fresh) return fresh;
      if (cached) return cached;
    } else if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const fresh = await network;
    if (fresh) return fresh;

    // Offline and never cached: fall back to the shell for navigations.
    if (req.mode === 'navigate') {
      const shell = await cache.match(new URL('index.html', SCOPE).href);
      if (shell) return shell;
    }
    return new Response('Offline and this file is not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});
