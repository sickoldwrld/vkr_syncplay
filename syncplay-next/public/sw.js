// SyncPlay Service Worker
// Bump CACHE_VERSION whenever client-side JS changes shape (e.g., WebSocket URL).
// On version bump all old caches are wiped on activate.
const CACHE_VERSION = 'v4-strict-off';
const STATIC_CACHE = `syncplay-static-${CACHE_VERSION}`;
const API_CACHE = `syncplay-api-${CACHE_VERSION}`;
const AUDIO_CACHE = `syncplay-audio-${CACHE_VERSION}`;

// Что кешировать заранее
const STATIC_ASSETS = [
  '/',
  '/login',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => !k.endsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // WebSocket — пропустить
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  // Не-GET — пропустить
  if (request.method !== 'GET') return;

  // Аудио стрим — Cache First с fallback на сеть, чтобы оффлайн играли последние треки
  if (url.pathname.startsWith('/api/stream/') && !url.pathname.includes('/cover')) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const resp = await fetch(request);
          if (resp.ok && resp.status === 200) {
            // Не кешируем 206 partial content — только полные ответы
            cache.put(request, resp.clone());
          }
          return resp;
        } catch (e) {
          if (cached) return cached;
          throw e;
        }
      })
    );
    return;
  }

  // Обложки и API GET — Network First с фолбэком на кэш
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(request).then((r) => r || new Response('{"error":"offline"}', {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })))
    );
    return;
  }

  // Статика (страницы Next.js, _next/static) — Cache First
  if (url.pathname.startsWith('/_next/') || STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return resp;
        });
      })
    );
  }
});
