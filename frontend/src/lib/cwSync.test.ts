import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STORAGE_KEYS, CW_STORAGE_KEYS } from '#lib/storageKeys.ts';

vi.mock('#lib/api.ts', () => ({
  getSettings: vi.fn(),
  saveCWSettings: vi.fn(),
  savePageSettings: vi.fn()
}));

import { getSettings, saveCWSettings, savePageSettings } from '#lib/api.ts';
import { reconcileSettingsWithServer, restoreSettingsFromServer } from '#lib/cwSync.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setAccount(username: string): void {
  localStorage.setItem(AUTH_STORAGE_KEYS.username, username);
  localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, `token-${username}`);
}

const settings = {
  cw_settings: {
    char_wpm: 25,
    eff_wpm: 15,
    freq: 650,
    start_delay: 1,
    updated_at: '2025-01-01T00:00:00Z'
  },
  page_settings: { language: 'ja', cur_lesson: 3, updated_at: '2025-01-01T00:00:00Z' }
};

beforeEach(() => {
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  });
  setAccount('alice');
  vi.mocked(getSettings).mockResolvedValue(settings);
  vi.mocked(saveCWSettings).mockResolvedValue(undefined);
  vi.mocked(savePageSettings).mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe('settings synchronization session boundaries', () => {
  it('does not apply settings returned for an earlier account', async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(getSettings).mockReturnValueOnce(pending.promise);
    const onLocale = vi.fn();
    const reconcile = reconcileSettingsWithServer({
      maxLesson: 40,
      fallbackLanguagePreference: 'en',
      onLocale
    });
    const rejected = expect(reconcile).rejects.toMatchObject({ name: 'AbortError' });
    setAccount('bob');
    pending.resolve(settings);
    await rejected;
    expect(localStorage.getItem(CW_STORAGE_KEYS.cwSettings)).toBeNull();
    expect(localStorage.getItem(CW_STORAGE_KEYS.lesson)).toBeNull();
    expect(onLocale).not.toHaveBeenCalled();
    expect(saveCWSettings).not.toHaveBeenCalled();
    expect(savePageSettings).not.toHaveBeenCalled();
  });

  it('does not continue reconciliation after an account changes during CW upload', async () => {
    localStorage.setItem(CW_STORAGE_KEYS.cwSettingsUpdatedAt, '2026-01-01T00:00:00Z');
    const pending = deferred<void>();
    vi.mocked(saveCWSettings).mockReturnValueOnce(pending.promise);
    const onLocale = vi.fn();
    const reconcile = reconcileSettingsWithServer({
      maxLesson: 40,
      fallbackLanguagePreference: 'en',
      onLocale
    });
    const rejected = expect(reconcile).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(saveCWSettings).toHaveBeenCalledTimes(1));
    setAccount('bob');
    pending.resolve(undefined);
    await rejected;
    expect(savePageSettings).not.toHaveBeenCalled();
    expect(onLocale).not.toHaveBeenCalled();
    expect(localStorage.getItem(CW_STORAGE_KEYS.lesson)).toBeNull();
  });

  it('uses page edits made while a CW upload is pending', async () => {
    localStorage.setItem(CW_STORAGE_KEYS.cwSettingsUpdatedAt, '2026-01-01T00:00:00Z');
    const pending = deferred<void>();
    vi.mocked(saveCWSettings).mockReturnValueOnce(pending.promise);
    const onLocale = vi.fn();
    const reconcile = reconcileSettingsWithServer({
      maxLesson: 40,
      fallbackLanguagePreference: 'en',
      onLocale
    });
    await vi.waitFor(() => expect(saveCWSettings).toHaveBeenCalledTimes(1));
    localStorage.setItem(CW_STORAGE_KEYS.lesson, '7');
    localStorage.setItem(CW_STORAGE_KEYS.pageSettingsUpdatedAt, '2026-02-01T00:00:00Z');
    pending.resolve(undefined);
    await reconcile;
    expect(savePageSettings).toHaveBeenCalledWith({ language: 'en', cur_lesson: 7 });
    expect(onLocale).not.toHaveBeenCalled();
  });

  it('applies newer server settings for the current account', async () => {
    const onLocale = vi.fn();
    await reconcileSettingsWithServer({
      maxLesson: 40,
      fallbackLanguagePreference: 'en',
      onLocale
    });
    expect(JSON.parse(localStorage.getItem(CW_STORAGE_KEYS.cwSettings)!)).toMatchObject({
      char_wpm: 25,
      freq: 650
    });
    expect(localStorage.getItem(CW_STORAGE_KEYS.lesson)).toBe('3');
    expect(onLocale).toHaveBeenCalledWith('ja', { navigate: false });
  });

  it('fences restore results after switching accounts', async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(getSettings).mockReturnValueOnce(pending.promise);
    const restore = restoreSettingsFromServer();
    const rejected = expect(restore).rejects.toMatchObject({ name: 'AbortError' });
    setAccount('bob');
    pending.resolve(settings);
    await rejected;
  });
});
