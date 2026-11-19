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

it('routes the selected Google proof only to its mounted consumer', async () => {
  const api = { initialize: vi.fn(), renderButton: vi.fn() };
  vi.stubGlobal('window', { google: { accounts: { id: api } } });
  const { renderGoogleButton } = await import('#lib/google-sign-in.ts');
  const controller = new AbortController();
  const receive = vi.fn();
  const begin = vi.fn();
  await renderGoogleButton({} as HTMLElement, {
    clientId: 'client',
    nonce: 'issued-nonce',
    locale: 'en',
    signal: controller.signal,
    begin,
    receive
  });
  const [configuration] = api.initialize.mock.calls[0];
  const [, button] = api.renderButton.mock.calls[0];
  expect(configuration).toMatchObject({
    nonce: 'issued-nonce',
    auto_select: false,
    ux_mode: 'popup'
  });
  expect(button.width).toBeUndefined();
  button.click_listener();
  configuration.callback({ credential: 'first' });
  controller.abort();
  button.click_listener();
  configuration.callback({ credential: 'late' });
  expect(begin).toHaveBeenCalledOnce();
  expect(receive.mock.calls).toEqual([['first']]);
});

it('fits the Google button to the form as it resizes without restarting sign-in', async () => {
  const api = { initialize: vi.fn(), renderButton: vi.fn() };
  vi.stubGlobal('window', { google: { accounts: { id: api } } });
  const host = { clientWidth: 400, replaceChildren: vi.fn() };
  const observe = vi.fn();
  const disconnect = vi.fn();
  let resized!: () => void;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = observe;
      disconnect = disconnect;
    }
  );

  const { renderGoogleButton } = await import('#lib/google-sign-in.ts');
  const controller = new AbortController();
  await renderGoogleButton(host as unknown as HTMLElement, {
    clientId: 'client',
    nonce: 'issued-nonce',
    locale: 'en',
    signal: controller.signal,
    fullWidth: true,
    begin: vi.fn(),
    receive: vi.fn()
  });

  expect(api.renderButton).toHaveBeenCalledWith(host, expect.objectContaining({ width: '400' }));
  expect(observe).toHaveBeenCalledWith(host);
  for (const width of [400, 0, 320, 320, 420]) {
    host.clientWidth = width;
    resized();
  }
  controller.abort();
  host.clientWidth = 280;
  resized();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(api.initialize).toHaveBeenCalledOnce();
  expect(api.renderButton.mock.calls.map(([, button]) => Number(button.width))).toEqual([
    400, 320, 400
  ]);
});

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
