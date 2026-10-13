// The one route list. The prerender entries in `svelte.config.js` and the
// SEO/sitemap code both read it from here, so adding a route cannot leave one
// of them behind.

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
