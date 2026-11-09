import type { RequestHandler } from './$types';
import { locales } from '#lib/paraglide/runtime.js';
import { buildSitemapXml } from '#lib/sitemap.ts';

// Written to `build/sitemap.xml` during the build; `url.origin` is the
// configured `paths.origin`.
export const prerender = true;

export const GET: RequestHandler = ({ url }) => {
  const origin = `${url.protocol}//${url.host}`;
  const xml = buildSitemapXml(origin, locales);

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
    }
  });
};
