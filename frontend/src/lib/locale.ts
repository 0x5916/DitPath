import { baseLocale, isLocale, locales } from '$lib/paraglide/runtime';

export type Locale = (typeof locales)[number];
export type LocalePreference = Locale | 'auto';

export const LOCALE_PREFERENCE_STORAGE_KEY = 'PARAGLIDE_LOCALE_PREF';

const LOCALE_DISPLAY: Record<Locale, { short: string; native: string }> = {
  en: { short: 'EN', native: 'English' },
  de: { short: 'DE', native: 'Deutsch' },
  ja: { short: 'JA', native: '日本語' },
  'zh-Hans': { short: '简', native: '简体中文' },
  'zh-Hant': { short: '繁', native: '繁體中文' }
};

export function normalizeLocalePreference(value: string | null | undefined): LocalePreference {
  if (!value || value === 'auto') return 'auto';
  if (isLocale(value)) return value as Locale;

  const matched = matchLocaleCandidate(value);
  return matched ?? 'auto';
}

export function matchLocaleCandidate(input: string | null | undefined): Locale | null {
  if (!input) return null;

  const cleaned = input.trim();
  if (!cleaned) return null;

  if (isLocale(cleaned)) {
    return cleaned as Locale;
  }

  const lower = cleaned.toLowerCase();
  const exact = locales.find((locale) => locale.toLowerCase() === lower);
  if (exact) return exact as Locale;

  const base = lower.split('-')[0];
  const primaryMatch = locales.find((locale) => locale.toLowerCase().split('-')[0] === base);
  return primaryMatch ? (primaryMatch as Locale) : null;
}

export function detectLocaleFromAcceptedLanguages(candidates: readonly string[]): Locale {
  for (const candidate of candidates) {
    const matched = matchLocaleCandidate(candidate);
    if (matched) return matched;
  }

  return baseLocale as Locale;
}

export function getLocaleShortLabel(locale: Locale): string {
  return LOCALE_DISPLAY[locale]?.short ?? locale.toUpperCase();
}

export function getLocaleLongLabel(locale: Locale): string {
  return LOCALE_DISPLAY[locale]?.native ?? locale;
}
