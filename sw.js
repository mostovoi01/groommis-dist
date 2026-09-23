const CACHE_NAME = 'groommis-v1';
const RUNTIME_CACHE = 'groommis-runtime-v1';

// Что кэшируем при установке (обязательное)
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install
self.addEventListener('install', (event) => {
  console.log('[sw] install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[sw] precache failed:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate — чистим старые кэши
self.addEventListener('activate', (event) => {
  console.log('[sw] activate');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Fetch — стратегия:
//   API Supabase, Яндекс.Карты — только сеть (не кэшируем)
//   Шрифты, картинки — cache-first
//   HTML/JS/CSS — network-first с fallback на кэш
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Supabase, Яндекс, 2GIS — только сеть
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('yandex') ||
    url.hostname.includes('2gis') ||
    url.hostname.includes('api-maps')
  ) {
    return;
  }

  // Только GET
  if (request.method !== 'GET') return;

  // Шрифты и картинки — cache-first
  if (
    request.destination === 'font' ||
    request.destination === 'image'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // HTML / JS / CSS — network-first
  if (
    request.destination === 'document' ||
    request.destination === 'script' ||
    request.destination === 'style'
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            // Fallback: index.html для SPA-роутов
            if (request.destination === 'document') {
              return caches.match('/');
            }
          });
        })
    );
  }
});
