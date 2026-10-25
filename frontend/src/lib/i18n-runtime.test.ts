import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_PREFERENCE_STORAGE_KEY } from './locale';

const navigation = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: navigation.goto }));
vi.mock('#lib/cookies.ts', () => ({ migrateLegacyPreferences: vi.fn() }));

let i18n: typeof import('./i18n.svelte');
let storage: Map<string, string>;
let assign: ReturnType<typeof vi.fn>;
function setUrl(path: string) {
  const url = new URL(path, 'https://opencw.net');
  vi.stubGlobal('window', { location: Object.assign(url, { assign }) });
}

beforeEach(async () => {
  vi.resetModules();
  navigation.goto.mockReset().mockResolvedValue(undefined);
  assign = vi.fn();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value)
  });
  vi.stubGlobal('navigator', { languages: ['en-US'] });
  vi.stubGlobal('document', { documentElement: { lang: '' } });
  setUrl('/zh-Hant');
  i18n = await import('./i18n.svelte');
});
afterEach(() => vi.unstubAllGlobals());

describe('locale startup', () => {
  it.each(['auto', 'de'])(
    'keeps an explicit URL locale despite the %s preference and English browser',
    async (preference) => {
      storage.set(LOCALE_PREFERENCE_STORAGE_KEY, preference);
      i18n.initLang('zh-Hant');
      expect(i18n.lang.value).toBe('zh-Hant');
      expect(i18n.langPreference.value).toBe(preference);
      expect(document.documentElement.lang).toBe('zh-Hant');
      await i18n.initializeBrowserLanguage();
      expect(i18n.lang.value).toBe('zh-Hant');
      expect(navigation.goto).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['auto', 'en'],
    ['de', 'de']
  ])(
    'canonicalizes bare URLs after hydration using %s without a document reload',
    async (pref, locale) => {
      setUrl('/morse/learn?step=2#lesson');
      storage.set(LOCALE_PREFERENCE_STORAGE_KEY, pref);
      i18n.initLang('en');
      expect(i18n.lang.value).toBe('en');
      expect(navigation.goto).not.toHaveBeenCalled();
      await i18n.initializeBrowserLanguage();
      expect(navigation.goto).toHaveBeenCalledExactlyOnceWith(
        new URL(`https://opencw.net/${locale}/morse/learn?step=2#lesson`),
        { replace: true }
      );
      expect(i18n.lang.value).toBe(locale);
      expect(assign).not.toHaveBeenCalled();
    }
  );

  it('keeps the prerendered locale without browser globals', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', undefined);
    i18n.initLang('ja');
    expect(i18n.lang.value).toBe('ja');
    expect(navigation.goto).not.toHaveBeenCalled();
  });

  it('switches language on explicit user action and preserves query and fragment', () => {
    setUrl('/zh-Hant/morse/learn?step=2#lesson');
    i18n.initLang('zh-Hant');
    i18n.setLangPreference('de');
    expect(i18n.lang.value).toBe('de');
    expect(storage.get(LOCALE_PREFERENCE_STORAGE_KEY)).toBe('de');
    expect(navigation.goto).toHaveBeenCalledExactlyOnceWith(
      new URL('https://opencw.net/de/morse/learn?step=2#lesson'),
      { replace: false }
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('follows the URL when browser history returns to another locale', async () => {
    i18n.initLang('zh-Hant');
    i18n.setLangPreference('de');
    setUrl('/zh-Hant');
    await i18n.initializeBrowserLanguage();
    expect(i18n.lang.value).toBe('zh-Hant');
    expect(i18n.langPreference.value).toBe('de');
    expect(navigation.goto).toHaveBeenCalledOnce();
  });

  it('updates passive account preferences without changing the current URL language', () => {
    i18n.initLang('zh-Hant');
    i18n.setLangPreference('de', { navigate: false });
    expect(i18n.langPreference.value).toBe('de');
    expect(storage.get(LOCALE_PREFERENCE_STORAGE_KEY)).toBe('de');
    expect(i18n.lang.value).toBe('zh-Hant');
    expect(navigation.goto).not.toHaveBeenCalled();
  });
});
