// The one route list and locale-prefix rule. Prerender entries, SEO/sitemap,
// and the service worker read them from here, so adding a route cannot leave
// one of them behind.

/**
 * Every static route, without a locale prefix.
 * @type {readonly string[]}
 */
export const ROUTE_PATHS = [
  '/',
  '/about',
  '/forum',
  '/morse',
  '/morse/learn',
  '/morse/learn/session',
  '/morse/practice',
  '/morse/progress',
  '/login',
  '/more',
  '/profile',
  '/register',
  '/settings'
];

/**
 * Locale-prefixed URL path for a static route.
 * @param {string} routePath
 * @param {string} locale
 * @returns {`/${string}`}
 */
export function localizedRoutePath(routePath, locale) {
  return routePath === '/' ? `/${locale}` : `/${locale}${routePath}`;
}

/**
 * Signed-in and redirect-only surfaces: prerendered, never indexed.
 * `/more` is the phone-only "More" screen: a redirect target on desktop, never
 * a landing page.
 * @type {readonly string[]}
 */
export const NOINDEX_ROUTE_PATHS = [
  '/login',
  '/register',
  '/profile',
  '/settings',
  '/more',
  '/morse/learn/session',
  '/morse/practice',
  '/morse/progress'
];
