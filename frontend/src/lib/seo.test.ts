import { describe, expect, it } from 'vitest';
import { resolveSeoMetadata } from './seo';

const LOCALES = ['en', 'de', 'ja', 'zh-Hans', 'zh-Hant'] as const;

describe('Progress document metadata', () => {
  it('keeps a page-specific, noindex title in every locale', () => {
    for (const locale of LOCALES) {
      const metadata = resolveSeoMetadata('/morse/progress', locale);
      const siteDefault = resolveSeoMetadata(null, locale);

      expect(metadata.title).not.toBe(siteDefault.title);
      expect(metadata.title).toMatch(/OpenCW$/);
      expect(metadata.description).not.toBe(siteDefault.description);
      expect(metadata.robots).toContain('noindex');
    }
  });

  it('still matches the title the Progress page used to render directly', () => {
    expect(resolveSeoMetadata('/morse/progress', 'en').title).toBe('Progress · OpenCW');
    expect(resolveSeoMetadata('/morse/progress', 'de').title).toBe('Fortschritt · OpenCW');
  });
});
