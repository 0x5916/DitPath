import type { RequestHandler } from './$types';
import { deLocalizeHref, locales } from '$lib/paraglide/runtime';
import { buildSitemapUrlSet, normalizePathname } from '$lib/seo';

// Written to `build/sitemap.xml` during the build; `url.origin` is the
// configured `kit.prerender.origin`.
export const prerender = true;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** De-localize a sitemap URL so priorities don't need a hard-coded locale list. */
function routePathFor(url: string): string {
  return normalizePathname(deLocalizeHref(new URL(url).pathname));
}

function priorityFor(url: string): string {
  const path = routePathFor(url);
  if (path === '/') return '1.0';
  return path === '/morse/learn' ? '0.9' : '0.8';
}

function buildXml(urls: string[]): string {
  const now = new Date().toISOString().slice(0, 10);
  const body = urls
    .map((url) => {
      const changefreq = routePathFor(url) === '/morse/learn' ? 'monthly' : 'weekly';

      return `  <url>\n    <loc>${escapeXml(url)}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priorityFor(url)}</priority>\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export const GET: RequestHandler = ({ url }) => {
  const origin = `${url.protocol}//${url.host}`;
  const xml = buildXml(buildSitemapUrlSet(origin, locales));

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
    }
  });
};
