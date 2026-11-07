import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GITHUB_URL, resolveSeoMetadata, SITE_NAME } from './seo';
import { ROUTE_PATHS } from './routes.js';

const LOCALES = ['en', 'de', 'ja', 'zh-Hans', 'zh-Hant'] as const;

const BRANDED_MESSAGE_KEYS = [
  'footer_text',
  'about_intro',
  'about_project_body',
  'lesson_page_title',
  'google_choose_username'
] as const;

// The migration banner intentionally names the old product to explain the
// transition. Every other public message must use DitPath.
const LEGACY_BRAND_ALLOWED_KEYS = new Set([
  'migration_eyebrow',
  'migration_empty_title',
  'migration_guest_history_title',
  'migration_signed_in_body',
  'migration_unknown_body'
]);

type Catalog = Record<string, string>;

function readCatalog(locale: (typeof LOCALES)[number]): Catalog {
  return JSON.parse(
    readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8')
  ) as Catalog;
}

describe('DitPath public branding', () => {
  it('uses the canonical public name and repository URL', () => {
    expect(SITE_NAME).toBe('DitPath');
    expect(GITHUB_URL).toBe('https://github.com/0x5916/DitPath');
  });

  it.each(LOCALES)('brands required messages in %s', (locale) => {
    const messages = readCatalog(locale);

    for (const key of BRANDED_MESSAGE_KEYS) {
      expect(messages[key], `${locale}.${key}`).toContain('DitPath');
      expect(messages[key], `${locale}.${key}`).not.toMatch(/OpenCW/i);
    }
  });

  it.each(LOCALES)('confines the legacy brand to the %s migration messages', (locale) => {
    const messages = readCatalog(locale);

    for (const [key, value] of Object.entries(messages)) {
      if (LEGACY_BRAND_ALLOWED_KEYS.has(key)) continue;
      expect(value, `${locale}.${key}`).not.toMatch(/OpenCW/i);
    }
  });

  it.each(LOCALES)('names both products only in the %s transition label', (locale) => {
    const messages = readCatalog(locale);
    expect(messages.migration_eyebrow).toContain('OpenCW');
    expect(messages.migration_eyebrow).toContain('DitPath');
  });

  it.each(LOCALES)('has no legacy brand in %s SEO metadata', (locale) => {
    for (const routePath of ROUTE_PATHS) {
      const metadata = resolveSeoMetadata(routePath, locale);
      const label = `${locale} ${routePath}`;

      expect(metadata.title, `${label} title`).toContain('DitPath');
      expect(metadata.title, `${label} title`).not.toMatch(/OpenCW/i);
      expect(metadata.description, `${label} description`).not.toMatch(/OpenCW/i);
    }
  });
});
