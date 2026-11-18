import { UI_STORAGE_KEYS } from '#lib/storageKeys.ts';

export type Theme = 'auto' | 'light' | 'dark';
export const themePreference = $state<{ value: Theme }>({ value: 'auto' });

/** Narrow an arbitrary stored value to a known theme. */
function normalizeTheme(value: string | null | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** Read the persisted theme preference (defaults to `auto`). */
export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'auto';
  try {
    return normalizeTheme(window.localStorage.getItem(UI_STORAGE_KEYS.theme));
  } catch {
    return 'auto';
  }
}

/**
 * Apply a theme to the document root. `auto` removes the override so the
 * `prefers-color-scheme` rules in `app.css` take over again.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;

  themePreference.value = theme;
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/** Persist and apply a theme preference. */
export function setTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeTheme(theme);

  try {
    window.localStorage.setItem(UI_STORAGE_KEYS.theme, normalized);
  } catch {
    // The choice can still apply to this page when storage is unavailable.
  }

  applyTheme(normalized);
}
