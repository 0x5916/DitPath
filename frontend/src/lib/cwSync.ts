import {
  getSettings,
  saveCWSettings,
  savePageSettings,
  type CWSettings,
  type PageSettings
} from '$lib/api';
import { isLocale } from '$lib/paraglide/runtime';
import {
  LOCALE_PREFERENCE_STORAGE_KEY,
  normalizeLocalePreference,
  type LocalePreference
} from '$lib/locale';
import { CW_STORAGE_KEYS } from '$lib/storageKeys';

export type { CWSettings, PageSettings };

const CW_SETTINGS_STORAGE_KEY = CW_STORAGE_KEYS.cwSettings;
const CW_SETTINGS_UPDATED_AT_STORAGE_KEY = CW_STORAGE_KEYS.cwSettingsUpdatedAt;
const PAGE_SETTINGS_UPDATED_AT_STORAGE_KEY = CW_STORAGE_KEYS.pageSettingsUpdatedAt;

const DEFAULT_CW_SETTINGS: CWSettings = {
  char_wpm: 20,
  eff_wpm: 12,
  freq: 600,
  start_delay: 0.5
};

export function normalizeLesson(lesson: number, maxLesson: number): number {
  if (!Number.isFinite(lesson)) return 1;
  return Math.min(Math.max(1, Math.trunc(lesson)), Math.max(1, maxLesson));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseUpdatedAt(value: string | null | undefined): number {
  if (!value || value.trim() === '') return 0;

  const normalized = value.trim();
  if (normalized === '0001-01-01T00:00:00Z') return 0;

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function readLocalUpdatedAt(storageKey: string): number {
  if (typeof localStorage === 'undefined') return 0;
  return parseUpdatedAt(localStorage.getItem(storageKey));
}

function writeLocalUpdatedAt(storageKey: string, isoTimestamp: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(storageKey, isoTimestamp);
}

export function touchLocalPageSettingsUpdatedAt(isoTimestamp: string = nowIso()): void {
  writeLocalUpdatedAt(PAGE_SETTINGS_UPDATED_AT_STORAGE_KEY, isoTimestamp);
}

/**
 * A language change is a synced page-settings change: apply it, then stamp the
 * local timestamp so the reconcile pass pushes it. Stamping stays at the
 * user-action call sites — the reconcile pass applies server values through
 * `onLocale` and must not mark them local. The theme is device-local and
 * deliberately does not stamp.
 */
export function applyPageLanguagePreference(
  preference: LocalePreference,
  onLocale: (preference: LocalePreference, options?: { navigate?: boolean }) => void
): void {
  onLocale(preference);
  touchLocalPageSettingsUpdatedAt();
}

function touchLocalCwSettingsUpdatedAt(isoTimestamp: string = nowIso()): void {
  writeLocalUpdatedAt(CW_SETTINGS_UPDATED_AT_STORAGE_KEY, isoTimestamp);
}

/** Read the locally stored lesson number, clamped to the available lessons. */
export function readStoredLesson(maxLesson: number): number {
  if (typeof localStorage === 'undefined') return 1;
  const storedLessonString = localStorage.getItem(CW_STORAGE_KEYS.lesson);
  const parsedLesson = Number.parseInt(storedLessonString ?? '1', 10);
  return normalizeLesson(parsedLesson, maxLesson);
}

function normalizeClientCwSettings(raw: Partial<CWSettings> | null | undefined): CWSettings {
  return {
    char_wpm: clampNumber(raw?.char_wpm ?? DEFAULT_CW_SETTINGS.char_wpm, 5, 50),
    eff_wpm: clampNumber(raw?.eff_wpm ?? DEFAULT_CW_SETTINGS.eff_wpm, 5, 50),
    freq: clampNumber(raw?.freq ?? DEFAULT_CW_SETTINGS.freq, 300, 2000),
    start_delay: clampNumber(raw?.start_delay ?? DEFAULT_CW_SETTINGS.start_delay, 0, 10)
  };
}

export function readClientCwSettings(): CWSettings {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_CW_SETTINGS };
  }

  const raw = localStorage.getItem(CW_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_CW_SETTINGS };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CWSettings>;
    return normalizeClientCwSettings(parsed);
  } catch {
    return { ...DEFAULT_CW_SETTINGS };
  }
}

export function saveClientCwSettings(settings: CWSettings): CWSettings {
  const normalized = normalizeClientCwSettings(settings);

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CW_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  }

  touchLocalCwSettingsUpdatedAt();

  return normalized;
}

/**
 * Build the page-settings payload from this device's state.
 *
 * Page settings cover what syncs across devices (interface language and the
 * current lesson). The theme is deliberately absent: it is a device-local
 * preference owned by `$lib/theme.ts`.
 */
export function readClientPageSettings(
  currentLesson: number,
  maxLesson: number,
  fallbackLanguagePreference: LocalePreference
): PageSettings {
  const localLang =
    typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY);
  const language = normalizeLocalePreference(localLang ?? fallbackLanguagePreference);

  return {
    language,
    cur_lesson: normalizeLesson(currentLesson, maxLesson)
  };
}

export function applyClientPageSettings(
  page: PageSettings,
  maxLesson: number,
  onLocale: (preference: LocalePreference, options?: { navigate?: boolean }) => void,
  options: { applyLanguage?: boolean; navigate?: boolean } = {}
): number {
  const lesson = normalizeLesson(page.cur_lesson, maxLesson);
  const language = normalizeLocalePreference(page.language);
  const applyLanguage = options.applyLanguage ?? true;

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CW_STORAGE_KEYS.lesson, String(lesson));
    if (applyLanguage) {
      localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, language);
    }
  }

  if (applyLanguage && (language === 'auto' || isLocale(language))) {
    onLocale(language, { navigate: options.navigate });
  }

  touchLocalPageSettingsUpdatedAt();

  return lesson;
}

export async function syncSettingsToServer(cw: CWSettings, page: PageSettings): Promise<void> {
  await Promise.all([saveCWSettings(cw), savePageSettings(page)]);
}

export async function restoreSettingsFromServer(): Promise<{ cw: CWSettings; page: PageSettings }> {
  const settings = await getSettings();
  return { cw: settings.cw_settings, page: settings.page_settings };
}

export async function reconcileSettingsWithServer(args: {
  maxLesson: number;
  fallbackLanguagePreference: LocalePreference;
  onLocale: (preference: LocalePreference, options?: { navigate?: boolean }) => void;
}): Promise<void> {
  if (typeof localStorage === 'undefined') return;

  const settings = await getSettings();

  const serverCw = normalizeClientCwSettings(settings.cw_settings);
  const serverPage: PageSettings = {
    language: normalizeLocalePreference(settings.page_settings.language),
    cur_lesson: normalizeLesson(settings.page_settings.cur_lesson, args.maxLesson)
  };

  const localCw = readClientCwSettings();
  const localPage = readClientPageSettings(
    readStoredLesson(args.maxLesson),
    args.maxLesson,
    args.fallbackLanguagePreference
  );

  const serverCwUpdatedAt = parseUpdatedAt(settings.cw_settings.updated_at);
  const localCwUpdatedAt = readLocalUpdatedAt(CW_SETTINGS_UPDATED_AT_STORAGE_KEY);
  const serverPageUpdatedAt = parseUpdatedAt(settings.page_settings.updated_at);
  const localPageUpdatedAt = readLocalUpdatedAt(PAGE_SETTINGS_UPDATED_AT_STORAGE_KEY);

  if (localCwUpdatedAt > serverCwUpdatedAt) {
    await saveCWSettings(localCw);
  } else if (serverCwUpdatedAt > localCwUpdatedAt) {
    saveClientCwSettings(serverCw);
    if (settings.cw_settings.updated_at && serverCwUpdatedAt > 0) {
      touchLocalCwSettingsUpdatedAt(settings.cw_settings.updated_at);
    }
  }

  if (localPageUpdatedAt > serverPageUpdatedAt) {
    await savePageSettings(localPage);
  } else if (serverPageUpdatedAt > localPageUpdatedAt) {
    applyClientPageSettings(serverPage, args.maxLesson, args.onLocale, { navigate: false });
    if (settings.page_settings.updated_at && serverPageUpdatedAt > 0) {
      touchLocalPageSettingsUpdatedAt(settings.page_settings.updated_at);
    }
  }
}
