import { readFileSync } from 'node:fs';
import type { Locale } from '../src/lib/locale.ts';
import { NOINDEX_ROUTE_PATHS } from '../src/lib/routes.js';
import {
  buildAbsoluteUrl,
  buildSitemapUrlSet,
  buildLocalizedPath,
  getIndexablePublicRoutePaths,
  isRouteIndexable,
  resolveSeoMetadata
} from '../src/lib/seo.ts';

type CheckResult = { ok: true; message: string } | { ok: false; message: string };

// Read from the committed inlang project rather than the generated paraglide
// runtime, so the check also runs on a clean checkout.
const { locales } = JSON.parse(
  readFileSync(new URL('../project.inlang/settings.json', import.meta.url), 'utf8')
) as { locales: Locale[] };

const INDEXABLE_ROUTES = getIndexablePublicRoutePaths();

function validateMetadata(): CheckResult[] {
  const checks: CheckResult[] = [];

  for (const locale of locales) {
    const seenTitles = new Map<string, string>();

    for (const routePath of INDEXABLE_ROUTES) {
      const metadata = resolveSeoMetadata(routePath, locale);
      const titleLen = metadata.title.trim().length;
      const descriptionLen = metadata.description.trim().length;

      if (!metadata.title.trim()) {
        checks.push({ ok: false, message: `[${locale}] ${routePath}: missing title` });
      }

      if (!metadata.description.trim()) {
        checks.push({ ok: false, message: `[${locale}] ${routePath}: missing description` });
      }

      if (titleLen < 20 || titleLen > 70) {
        checks.push({
          ok: false,
          message: `[${locale}] ${routePath}: title length ${titleLen} outside recommended range (20-70)`
        });
      }

      if (descriptionLen < 80 || descriptionLen > 180) {
        checks.push({
          ok: false,
          message: `[${locale}] ${routePath}: description length ${descriptionLen} outside recommended range (80-180)`
        });
      }

      const duplicateRoute = seenTitles.get(metadata.title);
      if (duplicateRoute) {
        checks.push({
          ok: false,
          message: `[${locale}] duplicate title shared by ${duplicateRoute} and ${routePath}`
        });
      } else {
        seenTitles.set(metadata.title, routePath);
      }
    }
  }

  // The noindex directive the page renders must come from the same route list
  // the sitemap uses; a noindex route that resolves to an indexable directive
  // would ship an indexable private page.
  for (const routePath of NOINDEX_ROUTE_PATHS) {
    const robots = resolveSeoMetadata(routePath, 'en').robots.toLowerCase();
    if (!robots.includes('noindex')) {
      checks.push({
        ok: false,
        message: `${routePath}: resolved metadata is missing the noindex directive`
      });
    }
  }

  return checks;
}

async function validateSitemap(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  // The sitemap is built for the configured origin (PRERENDER_ORIGIN, matching
  // svelte.config.js) rather than a hard-coded production host.
  const origin = process.env.PRERENDER_ORIGIN ?? 'https://opencw.net';
  const generatedUrls = buildSitemapUrlSet(origin, locales);
  const urlSet = new Set(generatedUrls);

  // Every indexable URL carries an explicit locale prefix, including the base
  // locale — the sitemap never publishes a bare `/`.
  const expectedUrls = new Set<string>();
  for (const locale of locales) {
    for (const routePath of INDEXABLE_ROUTES) {
      expectedUrls.add(buildAbsoluteUrl(origin, buildLocalizedPath(routePath, locale)));
    }
  }

  for (const expected of expectedUrls) {
    if (!urlSet.has(expected)) {
      checks.push({ ok: false, message: `sitemap missing expected URL: ${expected}` });
    }
  }

  for (const routePath of NOINDEX_ROUTE_PATHS) {
    if (isRouteIndexable(routePath)) {
      checks.push({
        ok: false,
        message: `route marked noindex expected but currently indexable: ${routePath}`
      });
    }

    for (const locale of locales) {
      const localized = buildAbsoluteUrl(origin, buildLocalizedPath(routePath, locale));
      if (urlSet.has(localized)) {
        checks.push({ ok: false, message: `sitemap should not include noindex URL: ${localized}` });
      }
    }
  }

  if (checks.length === 0) {
    checks.push({ ok: true, message: `sitemap URL set validated (${urlSet.size} URLs)` });
  }

  return checks;
}

function validateInfra(): CheckResult[] {
  const checks: CheckResult[] = [];
  const nginxConfig = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');

  // The forum deep-link location carries the locale prefix, so nginx has to
  // know the same locale list the app does.
  const alternation = nginxConfig.match(/location ~ \^\/\(\?:\(\?:([^)]+)\)\/\)\?forum/);

  if (!alternation) {
    checks.push({ ok: false, message: 'nginx.conf: forum locale location not found' });
    return checks;
  }

  const nginxLocales = alternation[1].split('|');
  const localeCodes: readonly string[] = locales;
  const missing = locales.filter((locale) => !nginxLocales.includes(locale));
  const extra = nginxLocales.filter((locale) => !localeCodes.includes(locale));

  if (missing.length > 0) {
    checks.push({ ok: false, message: `nginx.conf is missing locales: ${missing.join(', ')}` });
  }
  if (extra.length > 0) {
    checks.push({ ok: false, message: `nginx.conf has unknown locales: ${extra.join(', ')}` });
  }
  if (missing.length === 0 && extra.length === 0) {
    checks.push({ ok: true, message: 'nginx.conf locale list matches the inlang project' });
  }

  return checks;
}

async function main() {
  const results: CheckResult[] = [];

  results.push(...validateMetadata());
  results.push(...(await validateSitemap()));
  results.push(...validateInfra());

  const failures = results.filter((result) => !result.ok);
  const successes = results.filter((result) => result.ok);

  for (const success of successes) {
    console.log(`OK: ${success.message}`);
  }

  for (const failure of failures) {
    console.error(`FAIL: ${failure.message}`);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log('SEO validation passed.');
}

await main();
