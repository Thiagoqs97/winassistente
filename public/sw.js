// Service Worker do painel WIN.
// Estratégia:
//  - App shell (HTML, JS, CSS, logo): cache-first com revalidação no fundo (stale-while-revalidate).
//  - APIs (/api/*): network-only — dados não devem servir do cache. Fallback offline só para GETs do shell.
//  - Bump CACHE_VERSION para invalidar caches antigos a cada deploy relevante.

const CACHE_VERSION = 'win-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = ['/', '/index.html', '/logowin.png', '/manifest.webmanifest', '/offline.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== APP_SHELL_CACHE && k !== RUNTIME_CACHE)
            .map(k => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isNavigationRequest(req) {
  return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isApiRequest(url)) return;

  if (isNavigationRequest(req)) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(APP_SHELL_CACHE).then(c => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then(r => r || caches.match('/offline.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
