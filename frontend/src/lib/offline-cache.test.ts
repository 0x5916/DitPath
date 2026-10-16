import { describe, expect, it, vi } from 'vitest';
import { createOfflineCache } from './offline-cache';

const origin = 'https://ditpath.example';
const asset = `${origin}/_app/immutable/app.js`;
const route = `${origin}/en/morse/learn`;

function navigation(url = route, init: RequestInit = {}): Request {
  const request = new Request(url, init);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}

function html(body: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function fixture(network = html('network')) {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string) => entries.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      entries.set(key, response.clone());
      // Native storage reads the body; the caller must retain its own readable response.
      await response.text();
    })
  };
  const storage = { open: vi.fn(async () => cache as unknown as Cache) };
  const fetch = vi.fn<(request: Request) => Promise<Response>>().mockResolvedValue(network);
  const handle = createOfflineCache({
    origin,
    cacheName: 'ditpath-test',
    assets: ['/_app/immutable/app.js'],
    routes: ['/en/morse/learn'],
    storage,
    fetch
  });
  return { entries, cache, storage, fetch, handle, network };
}

describe('offline cache request boundaries', () => {
  it('bypasses two accounts at the same URL before accessing cache or network ports', () => {
    const f = fixture();
    f.entries.set(route, html('previous account'));
    for (const account of ['alice', 'bob']) {
      expect(
        f.handle(navigation(route, { headers: { Authorization: `Bearer ${account}` } }))
      ).toBeNull();
    }
    expect(f.storage.open).not.toHaveBeenCalled();
    expect(f.cache.match).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each([
    new Request('https://other.example/_app/immutable/app.js'),
    navigation('https://other.example/en/morse/learn'),
    new Request(asset, { method: 'POST' }),
    new Request(asset, { headers: { Range: 'bytes=0-10' } }),
    new Request(asset, { headers: { Authorization: '' } }),
    new Request(asset, { cache: 'no-store' }),
    new Request(`${asset}?variant=1`),
    navigation(`${origin}/unknown`),
    new Request(route)
  ])('bypasses an ineligible request without opening cache: %s', (request) => {
    const f = fixture();
    expect(f.handle(request)).toBeNull();
    expect(f.storage.open).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
});

describe('offline cache strategies', () => {
  it('serves an existing asset without fetching', async () => {
    const f = fixture();
    f.entries.set(asset, new Response('cached asset'));
    expect(await (await f.handle(new Request(asset)))?.text()).toBe('cached asset');
    expect(f.cache.match).toHaveBeenCalledWith(asset);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(['reload', 'no-cache'] as const)(
    'refreshes an asset requested with %s',
    async (cache) => {
      const f = fixture();
      f.entries.set(asset, new Response('old asset'));
      expect(await (await f.handle(new Request(asset, { cache })))?.text()).toBe('network');
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.cache.put).toHaveBeenCalledTimes(1);
    }
  );

  it('fetches documents first and writes a header-free key with query removed', async () => {
    const f = fixture();
    f.entries.set(route, html('old shell'));
    const request = navigation(`${route}?step=2`, { headers: { 'X-Test': 'transient' } });
    let finishWrite = () => {};
    const writing = new Promise<void>((resolve) => (finishWrite = resolve));
    const put = f.cache.put.getMockImplementation()!;
    f.cache.put.mockImplementationOnce(async (...args) => {
      await writing;
      await put(...args);
    });
    let settled = false;
    const pending = f.handle(request)!.then((response) => {
      settled = true;
      return response;
    });
    await vi.waitFor(() => expect(f.cache.put).toHaveBeenCalled());
    expect(settled).toBe(false);
    finishWrite();
    const response = await pending;
    expect(response).toBe(f.network);
    expect(response?.bodyUsed).toBe(false);
    expect(await response?.text()).toBe('network');
    expect(f.cache.match).not.toHaveBeenCalled();
    expect(f.cache.put).toHaveBeenCalledTimes(1);
    expect(f.cache.put.mock.calls[0][0]).toBe(route);
    expect(typeof f.cache.put.mock.calls[0][0]).toBe('string');
    expect(f.storage.open).toHaveBeenCalledWith('ditpath-test');
  });

  it('falls back to the same document shell across query changes', async () => {
    const f = fixture();
    f.entries.set(route, html('matching shell'));
    f.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await (await f.handle(navigation(`${route}?step=3`)))?.text()).toBe('matching shell');
    expect(f.cache.match).toHaveBeenCalledWith(route);
    expect(f.cache.put).not.toHaveBeenCalled();
  });

  it.each([new Request(asset), navigation()])(
    'returns 503 offline without an unrelated fallback',
    async (request) => {
      const f = fixture();
      f.entries.set(`${origin}/`, html('unrelated root'));
      f.fetch.mockRejectedValueOnce(new Error('offline'));
      expect((await f.handle(request))?.status).toBe(503);
      expect(f.cache.match).not.toHaveBeenCalledWith(`${origin}/`);
    }
  );
});

describe('offline cache response and storage boundaries', () => {
  it.each(['private, max-age=60', 'No-StOrE'])('does not save a %s response', async (policy) => {
    for (const request of [new Request(asset), navigation()]) {
      const network = html('private body');
      network.headers.set('Cache-Control', policy);
      const f = fixture(network);
      expect(await (await f.handle(request))?.text()).toBe('private body');
      expect(f.cache.put).not.toHaveBeenCalled();
    }
  });

  it.each([
    new Response('failed', { status: 500 }),
    new Response('{"private":"data"}', { headers: { 'Content-Type': 'application/json' } }),
    Object.defineProperty(html('redirected'), 'redirected', { value: true })
  ])('does not save an unsuitable document response: %s', async (network) => {
    const f = fixture(network);
    expect(await f.handle(navigation())).toBe(network);
    expect(network.bodyUsed).toBe(false);
    expect(f.cache.put).not.toHaveBeenCalled();
  });

  it.each(['open', 'match', 'put'] as const)(
    'preserves the network response when cache %s fails',
    async (method) => {
      const f = fixture();
      if (method === 'open') f.storage.open.mockRejectedValueOnce(new Error('storage denied'));
      else f.cache[method].mockRejectedValueOnce(new Error('storage failed'));
      const response = await f.handle(new Request(asset));
      expect(response).toBe(f.network);
      expect(response?.bodyUsed).toBe(false);
      expect(await response?.text()).toBe('network');
    }
  );

  it('returns 503 when both network and fallback cache read fail', async () => {
    const f = fixture();
    f.fetch.mockRejectedValueOnce(new Error('offline'));
    f.cache.match.mockRejectedValueOnce(new Error('storage denied'));
    expect((await f.handle(navigation()))?.status).toBe(503);
  });
});
