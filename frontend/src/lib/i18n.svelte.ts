import { baseLocale, locales, overwriteGetLocale } from '#lib/paraglide/runtime.js';
import { goto } from '$app/navigation';
import { migrateLegacyPreferences } from '#lib/cookies.ts';
import {
  LOCALE_PREFERENCE_STORAGE_KEY,
  matchLocaleCandidate,
  normalizeLocalePreference,
  detectLocaleFromAcceptedLanguages,
  localizeAppHref,
  type Locale,
  type LocalePreference
} from '#lib/locale.ts';

export const lang = $state<{ value: Locale }>({ value: baseLocale as Locale });
export const langPreference = $state<{ value: LocalePreference }>({ value: 'auto' });

export type { Locale, LocalePreference };

/**
 * Locale-aware href builder for in-app links. Reads `lang.value` so links
 * re-render when the active language changes.
 */
export function localizedHref(path: string): string {
  return localizeAppHref(path, lang.value);
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

async function navigateToLocalizedPathIfNeeded(replace = false): Promise<void> {
  if (typeof window === 'undefined') return;

  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = localizeAppHref(current, lang.value);

  const currentUrl = new URL(window.location.href);
  const nextUrl = new URL(next, window.location.origin);

  if (currentUrl.href !== nextUrl.href) {
    await goto(nextUrl, { replace });
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
  // The URL owns the displayed language. Keep the prerendered text through
  // hydration even when this device's saved preference or browser differs.
  langPreference.value = resolveInitialPreference(initialPreference);
  lang.value = matchLocaleCandidate(initialLocale) ?? (baseLocale as Locale);
  overwriteGetLocale(() => lang.value);
  applyDocumentLocale(lang.value);
}

/** Follow URL changes and canonicalize bare URLs after the router has mounted. */
export async function initializeBrowserLanguage(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (hasLocalePrefix(window.location.pathname)) {
    lang.value = matchLocaleCandidate(window.location.pathname.split('/')[1])!;
    overwriteGetLocale(() => lang.value);
    applyDocumentLocale(lang.value);
    return;
  }
  applyPreference(langPreference.value);
  await navigateToLocalizedPathIfNeeded(true);
}

export function setLangPreference(
  preference: LocalePreference,
  options: { navigate?: boolean } = {}
) {
  langPreference.value = preference;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, preference);
  }
  // Passive account reconciliation saves the preference without replacing the
  // language explicitly selected by the current URL.
  if (options.navigate === false) return;
  applyPreference(preference);
  void navigateToLocalizedPathIfNeeded().catch(() => {
    // Keep the current page usable if optional locale navigation fails.
  });
}
