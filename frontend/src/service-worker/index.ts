import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { asset } from '$app/paths';
import { self } from '$app/service-worker';
import { locales } from '../../project.inlang/settings.json';
import { createOfflineCache } from '../lib/offline-cache.ts';
import { ROUTE_PATHS } from '../lib/routes.js';

const CACHE_PREFIX = 'morsestep-cache-';
// A new namespace prevents reads from earlier caches containing private APIs.
const CACHE_NAME = `${CACHE_PREFIX}public-v2-${version}`;

function localizedPaths(paths: readonly string[]): string[] {
  return locales.flatMap((locale) =>
    paths.map((path) => (path === '/' ? `/${locale}` : `/${locale}${path}`))
  );
}

const CORE_ROUTES = ['/', '/morse/learn', '/morse/practice', '/morse/progress'];
const BUILD_ASSETS = [
  // Generated files are relative to the worker's application scope.
  ...immutable.map(({ path }) => new URL(path, self.registration.scope).pathname),
  ...assets.map(({ path }) => asset(path))
];
const PRECACHE_ASSETS = [...BUILD_ASSETS, ...CORE_ROUTES, ...localizedPaths(CORE_ROUTES)];

const handleRequest = createOfflineCache({
  origin: self.location.origin,
  cacheName: CACHE_NAME,
  assets: BUILD_ASSETS,
  routes: [...ROUTE_PATHS, ...localizedPaths(ROUTE_PATHS)],
  storage: caches,
  fetch: (request) => fetch(request)
});

self.addEventListener('install', (event: ExtendableEvent) => {
  // Let existing clients finish their audio session before this worker activates.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)));
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      for (const key of keys) {
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) {
          await caches.delete(key);
        }
      }
    })
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const response = handleRequest(event.request);
  if (response) event.respondWith(response);
});
