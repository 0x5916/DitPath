import { baseLocale, locales, localizeHref, overwriteGetLocale } from '$lib/paraglide/runtime';
import { migrateLegacyPreferences } from '$lib/cookies';
import {
  LOCALE_PREFERENCE_STORAGE_KEY,
  matchLocaleCandidate,
  normalizeLocalePreference,
  detectLocaleFromAcceptedLanguages,
  type Locale,
  type LocalePreference
} from '$lib/locale';

export const lang = $state<{ value: Locale }>({ value: baseLocale as Locale });
export const langPreference = $state<{ value: LocalePreference }>({ value: 'auto' });

export type { Locale, LocalePreference };

/**
 * Locale-aware href builder for in-app links. Reads `lang.value` so links
 * re-render when the active language changes.
 */
export function localizedHref(path: string): string {
  return localizeHref(path, { locale: lang.value });
}

function applyDocumentLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

function applyPreference(preference: LocalePreference): void {
  langPreference.value = preference;
  lang.value =
    preference === 'auto' ? detectLocaleFromAcceptedLanguages(browserLanguages()) : preference;
  overwriteGetLocale(() => lang.value);
  applyDocumentLocale(lang.value);
}

function navigateToLocalizedPathIfNeeded(): void {
  if (typeof window === 'undefined') return;

  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = localizeHref(current, { locale: lang.value });

  const currentUrl = new URL(window.location.href);
  const nextUrl = new URL(next, window.location.origin);

  if (currentUrl.href !== nextUrl.href) {
    window.location.assign(nextUrl.href);
  }
}

/** The preference the visitor stored on this device, if any. */
function readStoredPreference(): LocalePreference {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY);
    if (stored) return normalizeLocalePreference(stored);
  }

  return 'auto';
}

/**
 * A static build cannot read the stored preference while prerendering, so the
 * client resolves it from localStorage before falling back to the value
 * supplied by the server-rendered data.
 */
function resolveInitialPreference(initialPreference: string): LocalePreference {
  if (typeof window === 'undefined') return normalizeLocalePreference(initialPreference);

  const stored = readStoredPreference();
  return stored === 'auto' ? normalizeLocalePreference(initialPreference) : stored;
}

/** Whether a pathname carries an explicit locale prefix (e.g. `/de/about`). */
function hasLocalePrefix(pathname: string): boolean {
  return locales.some((locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`));
}

export function initLang(initialLocale: string, initialPreference: string = 'auto') {
  migrateLegacyPreferences();
  const preference = resolveInitialPreference(initialPreference);
  const initial = matchLocaleCandidate(initialLocale) ?? (baseLocale as Locale);

  if (preference === 'auto') {
    if (typeof window === 'undefined') {
      // Keep the prerendered locale for hydration consistency; browser detection is client-only.
      langPreference.value = 'auto';
      lang.value = initial;
      overwriteGetLocale(() => lang.value);
      applyDocumentLocale(lang.value);
      return;
    }

    applyPreference('auto');
    navigateToLocalizedPathIfNeeded();
    return;
  }

  applyPreference(preference);

  // Bare paths (e.g. `/about`, the legacy `/morse` target) only exist in the
  // base locale; send the visitor to their preferred locale's URL instead.
  if (typeof window !== 'undefined' && !hasLocalePrefix(window.location.pathname)) {
    navigateToLocalizedPathIfNeeded();
  }
}

export function setLangPreference(
  preference: LocalePreference,
  options: { navigate?: boolean } = {}
) {
  applyPreference(preference);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, preference);
  }
  if (options.navigate !== false) {
    navigateToLocalizedPathIfNeeded();
  }
}

export function setLang(locale: Locale) {
  setLangPreference(locale);
}
