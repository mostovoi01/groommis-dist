// ═══════════════════════════════════════════════
// Groommis Service Worker v2
// ═══════════════════════════════════════════════

const CACHE_VERSION = 'groommis-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// INSTALL
self.addEventListener('install', (event) => {
  console.log('[SW] install');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] skip precache:', url, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ACTIVATE
self.addEventListener('activate', (event) => {
  console.log('[SW] activate');
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => !n.startsWith(CACHE_VERSION))
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// ═══ FETCH — с fallback ═══
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Только GET
  if (request.method !== 'GET') return;

  // 2. Внешние API — пропускаем (не обрабатываем)
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('yandex') ||
    url.hostname.includes('2gis') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('fonts.')
  ) {
    return;
  }

  // 3. Только наш origin
  if (url.origin !== self.location.origin) {
    return;
  }

  // 4. HTML / навигация — network-first с fallback на index.html
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // Кэшируем успешные ответы
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, clone).catch(() => {});
            }).catch(() => {});
          }
          return response;
        } catch (err) {
          // Сеть недоступна — ищем в кэше
          const cached = await caches.match(request);
          if (cached) return cached;

          // Fallback — index.html (для SPA-роутинга)
          const fallback = await caches.match('/index.html');
          if (fallback) return fallback;

          // Совсем ничего нет — возвращаем пустой HTML
          return new Response(
            '<html><body style="font-family:system-ui;padding:40px;text-align:center;color:#0F1419;"><h1>Groommis</h1><p>Нет подключения к интернету</p></body></html>',
            {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }
          );
        }
      })()
    );
    return;
  }

  // 5. Статика (JS, CSS, изображения) — cache-first
  event.respondWith(
    (async () => {
      try {
        const cached = await caches.match(request);
        if (cached) return cached;

        const response = await fetch(request);

        // Кэшируем успешные ответы с нашего origin
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, clone).catch(() => {});
          }).catch(() => {});
        }

        return response;
      } catch (err) {
        // Не смогли загрузить — возвращаем пустой ответ
        return new Response('', {
          status: 408,
          statusText: 'Network error',
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })()
  );
});

// ═══ PUSH ═══
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Groommis', {
        body: data.body || 'Новое уведомление',
        icon: '/assets/icons/logo-192.png',
        badge: '/assets/icons/logo-192.png',
        vibrate: [200, 100, 200],
        data: data.data || {},
      })
    );
  } catch (e) {
    console.warn('[SW] push parse error:', e);
  }
});

// ═══ NOTIFICATION CLICK ═══
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});

console.log('[SW] v2 loaded');
