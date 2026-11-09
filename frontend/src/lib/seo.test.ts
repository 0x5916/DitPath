import { describe, expect, it } from 'vitest';
import {
  buildCanonicalPath,
  buildLocalizedAlternates,
  buildSitemapUrlSet,
  hasLocaleIndependentContent,
  resolveSeoMetadata
} from './seo';
import { buildSitemapXml } from './sitemap';

const LOCALES = ['en', 'de', 'ja', 'zh-Hans', 'zh-Hant'] as const;
const ORIGIN = 'https://opencw.net';

describe('Progress document metadata', () => {
  it('keeps a page-specific, noindex title in every locale', () => {
    for (const locale of LOCALES) {
      const metadata = resolveSeoMetadata('/morse/progress', locale);
      const siteDefault = resolveSeoMetadata(null, locale);

      expect(metadata.title).not.toBe(siteDefault.title);
      expect(metadata.title).toMatch(/DitPath$/);
      expect(metadata.description).not.toBe(siteDefault.description);
      expect(metadata.robots).toContain('noindex');
    }
  });

  it('still matches the title the Progress page used to render directly', () => {
    expect(resolveSeoMetadata('/morse/progress', 'en').title).toBe('Progress · DitPath');
    expect(resolveSeoMetadata('/morse/progress', 'de').title).toBe('Fortschritt · DitPath');
  });
});

describe('localized canonical and alternate paths', () => {
  it('keeps a distinct self-canonical for genuinely translated routes', () => {
    for (const locale of LOCALES) {
      expect(buildCanonicalPath('/about', locale, '/about')).toBe(`/${locale}/about`);
    }

    expect(buildLocalizedAlternates(ORIGIN, '/about', '/about', LOCALES)).toEqual(
      LOCALES.map((locale) => ({
        locale,
        href: `${ORIGIN}/${locale}/about`
      }))
    );
  });

  it('canonicalizes shared forum threads to English without false translations', () => {
    expect(hasLocaleIndependentContent('/forum/[id]')).toBe(true);
    expect(hasLocaleIndependentContent('/forum')).toBe(false);
    expect(hasLocaleIndependentContent(null)).toBe(false);

    expect(buildCanonicalPath('/forum/abc', 'zh-Hant', '/forum/[id]')).toBe('/en/forum/abc');
    expect(buildCanonicalPath('/forum/abc', 'de', '/forum/[id]')).toBe('/en/forum/abc');
    expect(buildLocalizedAlternates(ORIGIN, '/forum/abc', '/forum/[id]', LOCALES)).toEqual([]);
  });
});

describe('sitemap', () => {
  const urls = buildSitemapUrlSet(ORIGIN, LOCALES);
  const xml = buildSitemapXml(ORIGIN, LOCALES);

  it('contains one slashless HTTPS URL for every public locale route', () => {
    expect(urls).toHaveLength(25);
    expect(new Set(urls).size).toBe(25);

    for (const url of urls) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.host).toBe('opencw.net');
      expect(parsed.pathname).not.toMatch(/\/$/);
    }

    expect(urls).toContain(`${ORIGIN}/en`);
    expect(urls).toContain(`${ORIGIN}/ja/morse/learn`);
    expect(urls).toContain(`${ORIGIN}/zh-Hans/morse`);
    expect(urls).toContain(`${ORIGIN}/zh-Hant/forum`);
  });

  it('never lists noindex application routes', () => {
    for (const routePath of [
      '/login',
      '/register',
      '/profile',
      '/settings',
      '/more',
      '/morse/learn/session',
      '/morse/practice',
      '/morse/progress'
    ]) {
      expect(urls.some((url) => new URL(url).pathname.endsWith(routePath))).toBe(false);
    }
  });

  it('omits build-date lastmod values but retains valid XML entries', () => {
    expect(xml).not.toContain('<lastmod>');
    expect(xml.match(/<loc>/g)).toHaveLength(25);
    expect(xml).toContain('<loc>https://opencw.net/en/morse/learn</loc>');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});
