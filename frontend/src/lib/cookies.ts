import { browser } from '$app/environment';
import { normalizeLocalePreference, LOCALE_PREFERENCE_STORAGE_KEY } from '$lib/locale';
import { CW_STORAGE_KEYS } from '$lib/storageKeys';

const LEGACY_LOCALE_COOKIE = 'PARAGLIDE_LOCALE';
const LEGACY_LESSON_COOKIE = CW_STORAGE_KEYS.lesson;

/** Read a legacy cookie value by name. Returns `null` on the server or absent. */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const target = `${name}=`;
  const item = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(target));

  if (!item) return null;

  try {
    return decodeURIComponent(item.slice(target.length));
  } catch {
    return item.slice(target.length);
  }
}

function expireCookie(name: string): void {
  if (typeof document === 'undefined') return;

  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Move preferences written by older builds into localStorage once. Existing
 * localStorage values win, and the legacy cookies are removed either way.
 */
export function migrateLegacyPreferences(): void {
  if (!browser || typeof localStorage === 'undefined' || typeof document === 'undefined') return;

  const legacyLocale = readCookie(LEGACY_LOCALE_COOKIE);
  if (!localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY) && legacyLocale) {
    const preference = normalizeLocalePreference(legacyLocale);
    if (preference !== 'auto') {
      localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, preference);
    }
  }

  const legacyLesson = readCookie(LEGACY_LESSON_COOKIE);
  if (!localStorage.getItem(CW_STORAGE_KEYS.lesson) && legacyLesson) {
    localStorage.setItem(CW_STORAGE_KEYS.lesson, legacyLesson);
  }

  expireCookie(LEGACY_LOCALE_COOKIE);
  expireCookie(LEGACY_LESSON_COOKIE);
}
