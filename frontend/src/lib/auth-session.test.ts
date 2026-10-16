import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STORAGE_KEYS } from '#lib/storageKeys.ts';
import { get } from 'svelte/store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function token(username: string, expired = false): string {
  return `header.${btoa(JSON.stringify({ username, exp: expired ? 1 : Date.now() / 1000 + 3600 }))}.signature`;
}

function setSession(username: string, expired = false): void {
  localStorage.setItem(AUTH_STORAGE_KEYS.username, username);
  localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, token(username, expired));
  localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, `refresh-${username}`);
}

const credentials = (username: string) =>
  Response.json({
    access_token: token(username),
    refresh_token: `renewed-${username}`
  });

let auth: typeof import('#lib/auth.ts');
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  auth = await import('#lib/auth.ts');
});

afterEach(() => vi.unstubAllGlobals());

describe('auth session transitions', () => {
  it('fences an older login after a newer login commits', async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(credentials('bob'));
    const oldLogin = auth.login('alice', 'secret');
    const rejected = expect(oldLogin).rejects.toBeInstanceOf(auth.SessionChangedError);
    await auth.login('bob', 'secret');
    old.resolve(credentials('alice'));
    await rejected;
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.username)).toBe('bob');
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe('renewed-bob');
  });

  it('fences a username lookup completed after another login', async () => {
    const lookup = deferred<Response>();
    const tokenWithoutUsername = `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`;
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ access_token: tokenWithoutUsername, refresh_token: 'old-refresh' })
      )
      .mockReturnValueOnce(lookup.promise)
      .mockResolvedValueOnce(credentials('bob'));
    const old = auth.login('alice@example.com', 'secret');
    const rejected = expect(old).rejects.toBeInstanceOf(auth.SessionChangedError);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await auth.login('bob', 'secret');
    lookup.resolve(Response.json({ username: 'alice' }));
    await rejected;
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.username)).toBe('bob');
  });

  it('clears credentials immediately and keeps a later login after logout resolves', async () => {
    setSession('alice');
    const oldLogout = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldLogout.promise).mockResolvedValueOnce(credentials('bob'));
    const logout = auth.logout();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
    await auth.login('bob', 'secret');
    oldLogout.resolve(new Response(null, { status: 204 }));
    await logout;
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.username)).toBe('bob');
  });

  it('does not install a login completed after logout', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const login = auth.login('alice', 'secret');
    const rejected = expect(login).rejects.toBeInstanceOf(auth.SessionChangedError);
    await auth.logout();
    pending.resolve(credentials('alice'));
    await rejected;
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
  });

  it('shares one token refresh within a session and preserves the session snapshot', async () => {
    setSession('alice', true);
    const refresh = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(refresh.promise)
      .mockImplementation(async () => Response.json({ ok: true }));
    const session = auth.getAuthSession();
    const first = auth.apiFetch('/user/me');
    const second = auth.apiFetch('/settings/all');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const renewed = token('alice');
    refresh.resolve(Response.json({ access_token: renewed, refresh_token: 'renewed-alice' }));
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(auth.isAuthSessionCurrent(session)).toBe(true);
    for (const [, init] of fetchMock.mock.calls.slice(1)) {
      expect(init.headers.get('Authorization')).toBe(`Bearer ${renewed}`);
    }
  });

  it.each([200, 401])(
    'ignores an old refresh (%s) after another account logs in',
    async (status) => {
      setSession('alice', true);
      const refresh = deferred<Response>();
      fetchMock.mockReturnValueOnce(refresh.promise).mockResolvedValueOnce(credentials('bob'));
      const oldRequest = auth.apiFetch('/user/me');
      const rejected = expect(oldRequest).rejects.toBeInstanceOf(auth.SessionChangedError);
      await auth.login('bob', 'secret');
      refresh.resolve(status === 200 ? credentials('alice') : new Response(null, { status }));
      await rejected;
      expect(localStorage.getItem(AUTH_STORAGE_KEYS.username)).toBe('bob');
      expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe('renewed-bob');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );

  it('aborts an old request and never retries its 401 with another account credentials', async () => {
    setSession('alice');
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(credentials('bob'));
    const oldRequest = auth.apiFetch('/user/password', { method: 'PUT' });
    const rejected = expect(oldRequest).rejects.toBeInstanceOf(auth.SessionChangedError);
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await auth.login('bob', 'secret');
    expect(oldSignal.aborted).toBe(true);
    pending.resolve(new Response(null, { status: 401 }));
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps credentials on a transport refresh failure', async () => {
    setSession('alice', true);
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(auth.apiFetch('/user/me')).resolves.toMatchObject({ status: 503 });
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.username)).toBe('alice');
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe('refresh-alice');
  });

  it('respects a caller cancellation without clearing the session', async () => {
    setSession('alice');
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Canceled', 'AbortError')),
            { once: true }
          );
        })
    );
    const request = auth.apiFetch('/user/me', { signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.username)).toBe('alice');
  });

  it('detects external storage changes and is safe without browser storage', () => {
    setSession('alice');
    const old = auth.getAuthSession();
    setSession('bob');
    expect(auth.isAuthSessionCurrent(old)).toBe(false);
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('localStorage', undefined);
    expect(() => auth.initAuth()).not.toThrow();
    expect(auth.getAuthSession().username).toBeNull();
  });
});

describe('API request coalescing', () => {
  it('deduplicates GETs within a session and separates a later account', async () => {
    const api = await import('#lib/api.ts');
    setSession('alice');
    const old = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(Response.json({ username: 'bob' }));
    const first = api.getUserInfo();
    const same = api.getUserInfo();
    const rejected = Promise.all([
      expect(first).rejects.toBeInstanceOf(auth.SessionChangedError),
      expect(same).rejects.toBeInstanceOf(auth.SessionChangedError)
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setSession('bob');
    await expect(api.getUserInfo()).resolves.toEqual({ username: 'bob' });
    old.resolve(Response.json({ username: 'alice' }));
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a stale body parsed after the transport completed', async () => {
    const api = await import('#lib/api.ts');
    setSession('alice');
    const body = deferred<string>();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => body.promise
    });
    const request = api.getUserInfo();
    const rejected = expect(request).rejects.toBeInstanceOf(auth.SessionChangedError);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    setSession('bob');
    body.resolve('{"username":"alice"}');
    await rejected;
  });

  it('retains API status and error codes for a current session', async () => {
    const api = await import('#lib/api.ts');
    fetchMock.mockResolvedValueOnce(Response.json({ code: 'EMAIL_NOT_VERIFIED' }, { status: 403 }));
    await expect(api.getUserInfo()).rejects.toMatchObject({
      status: 403,
      code: 'EMAIL_NOT_VERIFIED'
    });
  });
});

describe('password change session revocation', () => {
  it('clears the caller session only after success without a logout request', async () => {
    const api = await import('#lib/api.ts');
    setSession('alice');
    auth.initAuth();
    const session = auth.getAuthSession();
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Password updated.' }));

    await api.updatePassword('old-password', 'new-password');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/user\/password$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      old_password: 'old-password',
      new_password: 'new-password'
    });
    for (const key of Object.values(AUTH_STORAGE_KEYS))
      expect(localStorage.getItem(key)).toBeNull();
    expect(get(auth.user)).toBeNull();
    expect(auth.isAuthSessionCurrent(session)).toBe(false);
  });

  it.each([401, 500])(
    'preserves the session on %s without refreshing or retrying',
    async (status) => {
      const api = await import('#lib/api.ts');
      setSession('alice');
      auth.initAuth();
      const session = auth.getAuthSession();
      const code = status === 401 ? 'INVALID_CREDENTIALS' : 'INTERNAL_SERVER_ERROR';
      fetchMock.mockResolvedValueOnce(Response.json({ code }, { status }));

      await expect(api.updatePassword('old-password', 'new-password')).rejects.toMatchObject({
        status,
        code
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(auth.isAuthSessionCurrent(session)).toBe(true);
      expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe('refresh-alice');
      expect(get(auth.user)).toEqual({ username: 'alice' });
    }
  );

  it('preserves credentials when a successful response body cannot be parsed', async () => {
    const api = await import('#lib/api.ts');
    setSession('alice');
    fetchMock.mockResolvedValueOnce(new Response('{invalid', { status: 200 }));
    await expect(api.updatePassword('old-password', 'new-password')).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR'
    });
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe('refresh-alice');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits for the success body before clearing the local session', async () => {
    const api = await import('#lib/api.ts');
    setSession('alice');
    const body = deferred<string>();
    const readBody = vi.fn(() => body.promise);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: readBody
    });
    const request = api.updatePassword('old-password', 'new-password');
    await vi.waitFor(() => expect(readBody).toHaveBeenCalledOnce());
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe('refresh-alice');
    body.resolve('{}');
    await request;
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBeNull();
  });

  it('never clears a new login when an older password response body arrives', async () => {
    const api = await import('#lib/api.ts');
    setSession('alice');
    const body = deferred<string>();
    const readBody = vi.fn(() => body.promise);
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: readBody })
      .mockResolvedValueOnce(credentials('bob'));
    const request = api.updatePassword('old-password', 'new-password');
    const rejected = expect(request).rejects.toBeInstanceOf(auth.SessionChangedError);
    await vi.waitFor(() => expect(readBody).toHaveBeenCalledOnce());
    await auth.login('bob', 'secret');
    body.resolve('{}');
    await rejected;
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe('renewed-bob');
    expect(get(auth.user)).toEqual({ username: 'bob' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('auth storage failures', () => {
  it.each(Object.values(AUTH_STORAGE_KEYS))(
    'rolls back a guest login when writing %s fails',
    async (failedKey) => {
      const { createSessionScope } = await import('#lib/session-scope.ts');
      const scope = createSessionScope();
      const current = scope.begin();
      const before = auth.getAuthSession();
      const quota = new DOMException('Storage full', 'QuotaExceededError');
      const originalSet = localStorage.setItem.bind(localStorage);
      vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
        if (key === failedKey) throw quota;
        originalSet(key, value);
      });
      fetchMock.mockResolvedValueOnce(credentials('bob'));
      await expect(auth.login('bob', 'secret')).rejects.toMatchObject({
        code: 'BROWSER_STORAGE_FAILED',
        cause: quota
      });
      expect(Object.values(AUTH_STORAGE_KEYS).map((key) => localStorage.getItem(key))).toEqual([
        null,
        null,
        null
      ]);
      expect(auth.isAuthSessionCurrent(before)).toBe(true);
      expect(current()).toBe(true); // The form may show its genuine error and clear loading.
      expect(get(auth.user)).toBeNull();
    }
  );

  it('restores the previous valid account after a partial write fails', async () => {
    setSession('alice');
    auth.initAuth();
    const before = auth.getAuthSession();
    const previous = Object.values(AUTH_STORAGE_KEYS).map((key) => localStorage.getItem(key));
    const quota = new DOMException('Storage full', 'QuotaExceededError');
    const originalSet = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === AUTH_STORAGE_KEYS.refreshToken && value === 'renewed-bob') throw quota;
      originalSet(key, value);
    });
    fetchMock.mockResolvedValueOnce(credentials('bob'));
    await expect(auth.login('bob', 'secret')).rejects.toMatchObject({
      code: 'BROWSER_STORAGE_FAILED',
      cause: quota
    });
    expect(Object.values(AUTH_STORAGE_KEYS).map((key) => localStorage.getItem(key))).toEqual(
      previous
    );
    expect(auth.isAuthSessionCurrent(before)).toBe(true);
    expect(get(auth.user)).toEqual({ username: 'alice' });
  });

  it('blocks residual credentials when rollback and cleanup fail, without hiding the storage error', async () => {
    const { createSessionScope } = await import('#lib/session-scope.ts');
    const scope = createSessionScope();
    const oldCurrent = scope.begin();
    const originalSet = localStorage.setItem.bind(localStorage);
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === AUTH_STORAGE_KEYS.refreshToken)
        throw new DOMException('Full', 'QuotaExceededError');
      originalSet(key, value);
    });
    const remove = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    fetchMock.mockResolvedValueOnce(credentials('bob'));
    const error = await auth.login('bob', 'secret').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(auth.AuthStorageError);
    const failure = error as InstanceType<typeof auth.AuthStorageError>;
    expect(oldCurrent()).toBe(false);
    expect(auth.isAuthSessionCurrent(failure.session!)).toBe(true);
    expect(scope.capture()()).toBe(true); // Only this current failure can reset the form.
    expect(get(auth.user)).toBeNull();
    auth.initAuth();
    expect(get(auth.user)).toBeNull();
    originalSet(AUTH_STORAGE_KEYS.refreshToken, 'unrelated-refresh');
    originalSet(AUTH_STORAGE_KEYS.username, 'alice');
    auth.initAuth();
    expect(get(auth.user)).toBeNull(); // A changed but mixed cross-tab identity stays blocked.
    fetchMock.mockResolvedValueOnce(Response.json({}));
    await auth.apiFetch('/forum/threads');
    expect(fetchMock.mock.calls.at(-1)![1].headers.has('Authorization')).toBe(false);
    set.mockRestore();
    remove.mockRestore();
    fetchMock.mockResolvedValueOnce(credentials('carol'));
    await auth.login('carol', 'secret');
    expect(auth.isAuthSessionCurrent(failure.session!)).toBe(false);
    scope.dispose();
    expect(scope.capture()()).toBe(false);
  });

  it('clears the user and aborts requests before trying every fallible removal', async () => {
    setSession('alice');
    auth.initAuth();
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const pending = auth.apiFetch('/user/me');
    const rejected = expect(pending).rejects.toBeInstanceOf(auth.SessionChangedError);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    const remove = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      expect(get(auth.user)).toBeNull();
      expect(signal.aborted).toBe(true);
      throw new Error('Storage blocked');
    });
    expect(() => auth.clearAuthSession(auth.getAuthSession())).not.toThrow();
    expect(remove).toHaveBeenCalledTimes(3);
    auth.initAuth();
    expect(auth.getAuthSession().username).toBeNull();
    expect(get(auth.user)).toBeNull();
    response.resolve(Response.json({ username: 'alice' }));
    await rejected;
  });
});
