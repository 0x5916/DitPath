import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mockDocument() {
  const script = {
    src: '',
    async: false,
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    remove: vi.fn()
  };
  const appendChild = vi.fn();
  vi.stubGlobal('document', { createElement: vi.fn(() => script), head: { appendChild } });
  return { script, appendChild };
}

it('shares the hosted SDK load and resolves only once the Google API is available', async () => {
  const { script, appendChild } = mockDocument();
  const { loadGoogleIdentity } = await import('#lib/google-sign-in.ts');
  const first = loadGoogleIdentity();
  expect(loadGoogleIdentity()).toBe(first);
  expect(appendChild).toHaveBeenCalledTimes(1);
  expect(script.src).toBe('https://accounts.google.com/gsi/client');
  const api = { initialize: vi.fn(), renderButton: vi.fn() };
  vi.stubGlobal('window', { google: { accounts: { id: api } } });
  script.onload!();
  await expect(first).resolves.toBe(api);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['error', 'timeout', 'missing-api'])(
  'cleans up an SDK %s and permits a fresh retry',
  async (mode) => {
    const { script, appendChild } = mockDocument();
    const { loadGoogleIdentity } = await import('#lib/google-sign-in.ts');
    const first = loadGoogleIdentity();
    const rejected = expect(first).rejects.toThrow('GOOGLE_SIGN_IN_UNAVAILABLE');
    if (mode === 'error') script.onerror!();
    else if (mode === 'missing-api') script.onload!();
    else await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(script.remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const retry = loadGoogleIdentity();
    const retryRejected = expect(retry).rejects.toThrow('GOOGLE_SIGN_IN_UNAVAILABLE');
    expect(appendChild).toHaveBeenCalledTimes(2);
    script.onerror!();
    await retryRejected;
  }
);
