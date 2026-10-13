/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

const CACHE_NAME = `morsestep-cache-${version}`;

const PRECACHE_ASSETS = [
  ...build,
  ...files,
  '/',
  '/morse/learn',
  '/morse/practice',
  '/morse/progress'
];

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => {
        // Do not force immediate skipWaiting during active audio training
      })
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      for (const key of keys) {
        if (key !== CACHE_NAME) {
          await caches.delete(key);
        }
      }
    })
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Never cache authentication requests or API mutations
  if (url.pathname.startsWith('/v1/auth') || event.request.method !== 'GET') {
    return;
  }

  // Cache-first for static build artifacts, network-first with cache fallback for routes
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in background for non-hashed routes
        if (!url.pathname.startsWith('/_app/immutable/')) {
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
              }
            })
            .catch(() => {});
        }
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline and request is an HTML page, return root or cached learn route
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/morse/learn') as Promise<Response>;
          }
          return new Response('Network unavailable', { status: 503, statusText: 'Offline' });
        });
    })
  );
});
