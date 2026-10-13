import type { Handle } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getLocale } from '$lib/paraglide/runtime';

/**
 * These hooks only run in `vite dev` and while prerendering — the production
 * build is a set of static files with no server.
 *
 * The middleware resolves each request's locale from its URL (using
 * AsyncLocalStorage, so concurrent prerenders cannot bleed into each other)
 * and still performs its document redirect in dev. Redirects that used to live
 * here (bare paths, legacy `/morse` URLs) are handled statically instead — see
 * src/lib/i18n.svelte.ts and src/routes/morse/.
 */
export const handle: Handle = async ({ event, resolve }) => {
  return paraglideMiddleware(event.request, () =>
    resolve(event, {
      // Resolve `%paraglide.lang%` in app.html so each prerendered page carries
      // its own locale instead of a hard-coded `lang="en"`.
      transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', getLocale())
    })
  );
};
