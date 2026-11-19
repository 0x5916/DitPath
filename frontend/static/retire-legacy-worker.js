// Served as /service-worker.js on the former origin. Waiting for activation
// lets open sessions finish under their existing worker. IndexedDB, browser
// preferences and offline caches remain available for recovery and rollback.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister());
});
