import { describe, expect, it } from 'vitest';
import {
  detectLocaleFromAcceptedLanguages,
  localizeAppHref,
  matchLocaleCandidate,
  normalizeLocalePreference
} from './locale';
import { locales } from '#lib/paraglide/runtime.js';

describe('localized app hrefs', () => {
  it.each(locales)('uses the deployed Home path for %s without a trailing slash', (locale) => {
    for (const path of ['/', '/en', '/en/', '/de/']) {
      expect(localizeAppHref(path, locale)).toBe(`/${locale}`);
    }
  });

  it.each(locales)('retains Home query and fragment for %s', (locale) => {
    expect(localizeAppHref('/?from=profile&next=%2Fforum#activity', locale)).toBe(
      `/${locale}?from=profile&next=%2Fforum#activity`
    );
    expect(localizeAppHref('/de/#activity', locale)).toBe(`/${locale}#activity`);
  });

  it.each(locales)('preserves nested paths and their query and fragment for %s', (locale) => {
    expect(localizeAppHref('/morse/learn/session?step=12#answer', locale)).toBe(
      `/${locale}/morse/learn/session?step=12#answer`
    );
    expect(localizeAppHref('/settings#sync-storage', locale)).toBe(
      `/${locale}/settings#sync-storage`
    );
    expect(localizeAppHref('/forum/', locale)).toBe(`/${locale}/forum/`);
  });
});

describe('locale candidate matching', () => {
  it.each([
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['zh', 'zh-Hans']
  ])('matches Chinese region %s by its likely script', (input, expected) => {
    expect(matchLocaleCandidate(input)).toBe(expected);
  });

  it.each([
    ['zh-Hans-TW', 'zh-Hans'],
    ['zh-Hant-CN', 'zh-Hant'],
    ['ZH-hans-HK', 'zh-Hans'],
    ['zh-Hant-SG-u-nu-hanidec', 'zh-Hant']
  ])('gives the explicit Chinese script precedence over region: %s', (input, expected) => {
    expect(matchLocaleCandidate(input)).toBe(expected);
  });

  it.each([
    ['en', 'en'],
    [' DE ', 'de'],
    ['JA-jp', 'ja'],
    ['en-AU', 'en'],
    ['de-AT', 'de'],
    ['zh-hans', 'zh-Hans'],
    ['ZH-HANT', 'zh-Hant']
  ])('preserves exact, case-insensitive and other-language fallback: %s', (input, expected) => {
    expect(matchLocaleCandidate(input)).toBe(expected);
  });

  it.each([null, undefined, '', '  ', 'fr-FR', 'zh--CN', 'zh_invalid', 'zh-!'])(
    'safely rejects an empty, unsupported or malformed candidate: %s',
    (input) => {
      expect(matchLocaleCandidate(input)).toBeNull();
    }
  );

  it('uses corrected matching for saved preferences and the accepted-language order', () => {
    expect(normalizeLocalePreference('zh-SG')).toBe('zh-Hans');
    expect(normalizeLocalePreference('zh-HK')).toBe('zh-Hant');
    expect(normalizeLocalePreference('auto')).toBe('auto');
    expect(normalizeLocalePreference('zh--CN')).toBe('auto');
    expect(detectLocaleFromAcceptedLanguages(['fr-FR', 'zh-CN', 'de-DE'])).toBe('zh-Hans');
    expect(detectLocaleFromAcceptedLanguages(['zh--CN', 'ja-JP'])).toBe('ja');
    expect(detectLocaleFromAcceptedLanguages(['fr-FR'])).toBe('en');
  });
});
