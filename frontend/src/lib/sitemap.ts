import { buildSitemapUrlSet, normalizePathname } from './seo.ts';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * The sitemap deliberately omits `lastmod`: the static build has no reliable
 * per-page content date, and stamping every URL with the build date teaches
 * crawlers that the value is meaningless. Add `lastmod` only when a real
 * content-change timestamp is available for each URL.
 */
export function buildSitemapXml(origin: string, localeCodes: readonly string[]): string {
  const urls = buildSitemapUrlSet(origin, localeCodes);
  const body = urls
    .map((url) => {
      const path = normalizePathname(new URL(url).pathname);
      const isHome = localeCodes.some((locale) => path === `/${locale}`);
      const isLearnRoute = path.endsWith('/morse/learn');
      const changefreq = isLearnRoute ? 'monthly' : 'weekly';
      const priority = isHome ? '1.0' : isLearnRoute ? '0.9' : '0.8';

      return `  <url>\n    <loc>${escapeXml(url)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
