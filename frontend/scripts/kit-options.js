import adapter from '@sveltejs/adapter-static';
import { readFileSync } from 'node:fs';
import { ROUTE_PATHS } from '../src/lib/routes.js';

// Read committed locales without depending on generated Paraglide output.
const { locales } = /** @type {{ locales: string[] }} */ (
  JSON.parse(readFileSync(new URL('../project.inlang/settings.json', import.meta.url), 'utf8'))
);

/**
 * Mirrors `buildLocalizedPath` in src/lib/seo.ts.
 * @param {string} routePath
 * @param {string} locale
 * @returns {`/${string}`}
 */
function localizedPath(routePath, locale) {
  return routePath === '/' ? `/${locale}` : `/${locale}${routePath}`;
}

/** @type {import('@sveltejs/kit/vite').Config} */
export const kitOptions = {
  adapter: adapter({
    // nginx gives runtime forum threads this shell; other unknown URLs keep 404.
    fallback: '404.html'
  }),
  paths: {
    // Canonical, hreflang, Open Graph and sitemap origins are build-time values.
    origin: process.env.PRERENDER_ORIGIN ?? 'https://opencw.net'
  },
  prerender: {
    // The JavaScript language switcher cannot expose every locale to the crawler.
    entries: [
      '*',
      ...locales.flatMap((locale) =>
        ROUTE_PATHS.map((routePath) => localizedPath(routePath, locale))
      )
    ]
  }
};
