/* sw.js — offline support and instant repeat visits.
 *
 * Strategy: the shell (page, CSS, JS) is CACHE-FIRST from a cache named after
 * VERSION. Every file of one version is precached together, so a visit never
 * mixes old and new code, and opening the app never waits on the network —
 * on a slow connection it used to (network-first meant a repeat visit took as
 * long as a first one: 4.6s on a 600ms-latency link, vs ~0.3s now).
 *
 * Deploys still show up promptly: the browser re-checks sw.js on every visit
 * (registered with updateViaCache: 'none'); a changed VERSION installs, precaches
 * the new files with cache: 'reload' (bypassing GitHub Pages' 10-minute HTTP
 * cache, which could otherwise fill a new cache with old files), activates at
 * once, and the page swaps to it (main.js reloads if nothing is in progress,
 * otherwise offers a "Reload" toast).
 *
 * On localhost the shell stays network-first so local edits appear on reload.
 * Study data is NOT here — it lives in IndexedDB and is never cached or uploaded.
 */
const VERSION = 'studylab-v14';
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
  'js/qr.js',
  'js/celebrate.js',
  'js/mascot.js',
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
  'js/views/streak.js',
].map(p => new URL(p, SCOPE).href);

const DEV = SCOPE.hostname === 'localhost';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Individually, so one failure cannot fail the whole install (a miss is
    // fetched and cached on first use). cache: 'reload' skips the HTTP cache.
    await Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
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

  const isNav = req.mode === 'navigate';
  const isShell = isNav || /\.(?:html|css|js)$/.test(url.pathname);

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // A navigation is always the app shell, whatever query string it carries.
    const cached = isNav
      ? (await cache.match(req, { ignoreSearch: true })) || (await cache.match(new URL('./', SCOPE).href)) || (await cache.match(new URL('index.html', SCOPE).href))
      : await cache.match(req);

    const fromNetwork = () => fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    });

    try {
      if (isShell && DEV) return await fromNetwork().catch(() => cached || Promise.reject());
      if (cached) {
        if (!isShell) event.waitUntil(fromNetwork().catch(() => {}));   // refresh non-shell files quietly
        return cached;
      }
      return await fromNetwork();
    } catch {
      return new Response('Offline and this file is not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
