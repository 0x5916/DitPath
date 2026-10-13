import type { LayoutLoad } from './$types';
import type { LocalePreference } from '$lib/locale';
import { baseLocale, deLocalizeHref, locales, localizeHref } from '$lib/paraglide/runtime';
import {
  buildAbsoluteUrl,
  DEFAULT_OG_IMAGE_PATH,
  GITHUB_URL,
  getOpenGraphLocale,
  normalizePathname,
  resolveSeoMetadata,
  SITE_NAME
} from '$lib/seo';

// The whole app is prerendered at build time; there is no server at runtime.
export const prerender = true;

export const load: LayoutLoad = ({ url, route }) => {
  const normalizedPath = normalizePathname(url.pathname);
  // The locale is derived from the URL prefix — a static build cannot read
  // request cookies. Bare paths (`/about`, legacy URLs) fall back to the base
  // locale; the client redirects them to the visitor's preference on hydration.
  const locale =
    locales.find(
      (candidate) =>
        normalizedPath === `/${candidate}` || normalizedPath.startsWith(`/${candidate}/`)
    ) ?? baseLocale;
  const basePath = normalizePathname(deLocalizeHref(normalizedPath));
  const metadata = resolveSeoMetadata(route.id, locale);
  // Always canonicalise to the locale-explicit URL (e.g. `/en/about`) so the
  // canonical is one of the `hreflang` alternates below instead of a
  // locale-ambiguous bare path that depends on the visitor's preference.
  const canonicalUrl = buildAbsoluteUrl(url.origin, localizeHref(basePath, { locale }));
  // An unmatched route (`route.id === null`) still renders the root layout, so
  // make sure the 404 it renders can never be indexed.
  const robots = route.id === null ? 'noindex,follow' : metadata.robots;

  const alternates = locales.map((alternateLocale) => {
    const localizedPath = localizeHref(basePath, { locale: alternateLocale });

    return {
      locale: alternateLocale,
      href: buildAbsoluteUrl(url.origin, localizedPath)
    };
  });

  const xDefaultHref =
    alternates.find((alternate) => alternate.locale === 'en')?.href ?? canonicalUrl;
  const isIndexable = !robots.toLowerCase().includes('noindex');
  const structuredData = isIndexable
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: SITE_NAME,
          url: buildAbsoluteUrl(url.origin, '/'),
          logo: buildAbsoluteUrl(url.origin, '/apple-touch-icon.png'),
          sameAs: [GITHUB_URL]
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: SITE_NAME,
          url: buildAbsoluteUrl(url.origin, '/'),
          inLanguage: locale,
          description: metadata.description
        },
        ...(route.id === '/morse/learn'
          ? [
              {
                '@context': 'https://schema.org',
                '@type': 'Course',
                name: metadata.title,
                description: metadata.description,
                inLanguage: locale,
                provider: {
                  '@type': 'Organization',
                  name: SITE_NAME,
                  url: buildAbsoluteUrl(url.origin, '/')
                },
                educationalLevel: 'Beginner to Intermediate',
                url: canonicalUrl
              }
            ]
          : [])
      ]
    : [];

  return {
    locale,
    // The stored preference only exists on the client; `initLang` refines this
    // from localStorage once the app hydrates.
    localePreference: 'auto' as LocalePreference,
    seo: {
      ...metadata,
      robots,
      siteName: SITE_NAME,
      canonicalUrl,
      alternates,
      xDefaultHref,
      openGraphLocale: getOpenGraphLocale(locale),
      openGraphImage: buildAbsoluteUrl(url.origin, metadata.ogImagePath ?? DEFAULT_OG_IMAGE_PATH),
      structuredData
    }
  };
};
