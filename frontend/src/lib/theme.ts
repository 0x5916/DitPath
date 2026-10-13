import { UI_STORAGE_KEYS } from '$lib/storageKeys';

export type Theme = 'auto' | 'light' | 'dark';

/** Order cycled by the navbar theme toggle. */
export const THEME_CYCLE: Record<Theme, Theme> = {
  auto: 'light',
  light: 'dark',
  dark: 'auto'
};

/** Narrow an arbitrary stored value to a known theme. */
function normalizeTheme(value: string | null | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** Read the persisted theme preference (defaults to `auto`). */
export function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'auto';
  return normalizeTheme(localStorage.getItem(UI_STORAGE_KEYS.theme));
}

/**
 * Apply a theme to the document root. `auto` removes the override so the
 * `prefers-color-scheme` rules in `app.css` take over again.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;

  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/** Persist and apply a theme preference; returns the normalized value. */
export function setTheme(theme: Theme): Theme {
  const normalized = normalizeTheme(theme);

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(UI_STORAGE_KEYS.theme, normalized);
  }

  applyTheme(normalized);
  return normalized;
}
