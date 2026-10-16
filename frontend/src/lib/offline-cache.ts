interface OfflineCacheOptions {
  origin: string;
  cacheName: string;
  assets: readonly string[];
  routes: readonly string[];
  storage: Pick<CacheStorage, 'open'>;
  fetch: (request: Request) => Promise<Response>;
}

/** Cache public build resources only; account/API traffic stays with the network. */
export function createOfflineCache(options: OfflineCacheOptions) {
  const assets = new Set(options.assets);
  const routes = new Set(options.routes);

  return (request: Request): Promise<Response> | null => {
    const url = new URL(request.url);
    if (
      request.method !== 'GET' ||
      request.headers.has('Authorization') ||
      request.headers.has('Range') ||
      request.cache === 'no-store' ||
      url.origin !== options.origin
    ) {
      return null;
    }

    const asset = assets.has(url.pathname) && !url.search;
    const document = request.mode === 'navigate' && routes.has(url.pathname);
    if (!asset && !document) return null;

    // Static route queries choose client state, not another document. Store a
    // header-free URL key so neither credentials nor query variants persist.
    const key = `${url.origin}${url.pathname}`;
    return respond();

    async function respond(): Promise<Response> {
      const cache = await options.storage.open(options.cacheName).catch(() => null);
      const read = () => cache?.match(key).catch(() => undefined);

      if (asset && request.cache !== 'reload' && request.cache !== 'no-cache') {
        const cached = await read();
        if (cached) return cached;
      }

      try {
        const response = await options.fetch(request);
        const publicResponse = !/\b(?:private|no-store)\b/i.test(
          response.headers.get('Cache-Control') ?? ''
        );
        const html = response.headers.get('Content-Type')?.split(';')[0].trim() === 'text/html';
        if (
          response.status === 200 &&
          !response.redirected &&
          publicResponse &&
          (!document || html)
        ) {
          // Await the one write path, but keep a usable response if storage fails.
          await cache?.put(key, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        return (
          (await read()) ??
          new Response('Network unavailable', { status: 503, statusText: 'Offline' })
        );
      }
    }
  };
}
