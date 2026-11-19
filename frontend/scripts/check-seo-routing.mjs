#!/usr/bin/env node
/**
 * Verify the deployed static-routing contract against a running nginx instance.
 *
 * Start the built image (or the local build) first, then:
 *   node scripts/check-seo-routing.mjs http://127.0.0.1:8089
 *
 * The requests send the forwarding headers Cloudflare supplies in production,
 * so redirect destinations can be asserted without a public deployment.
 */
import assert from 'node:assert/strict';
import http from 'node:http';

const base = new URL(process.argv[2] ?? process.env.SEO_BASE_URL ?? 'http://127.0.0.1:8089');
const publicOrigin = 'https://morsewell.com';

function request(path, headers = {}, forwarded = true) {
  return new Promise((resolve, reject) => {
    const requestHeaders = forwarded
      ? { Host: 'morsewell.com', 'X-Forwarded-Proto': 'https', ...headers }
      : { ...headers };
    const req = http.request(
      {
        hostname: base.hostname,
        port: base.port,
        method: 'GET',
        path,
        headers: requestHeaders
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function canonical(html) {
  return html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
}

function robots(html) {
  return html.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? null;
}

function alternates(html) {
  return [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(
    (match) => [match[1], match[2]]
  );
}

let checks = 0;

async function expectStatus(path, status, headers, forwarded = true) {
  const response = await request(path, headers, forwarded);
  assert.equal(response.status, status, `${path} expected ${status}, got ${response.status}`);
  checks += 1;
  return response;
}

/**
 * Assert the redirect destination, then fetch that destination locally with
 * canonical headers. This proves the alias reaches a serving URL rather than
 * bouncing through another redirect.
 */
async function expectRedirect(path, location, headers, forwarded = true, targetStatus = 200) {
  const response = await expectStatus(path, 301, headers, forwarded);
  assert.equal(response.headers.location, location, `${path} redirect destination`);
  checks += 1;

  const target = new URL(location);
  const targetResponse = await expectStatus(
    `${target.pathname}${target.search}`,
    targetStatus,
    { Host: target.host },
    true
  );
  assert.equal(targetResponse.headers.location, undefined, `${location} must not redirect again`);
  checks += 1;
  return response;
}

const pages = [
  '/en',
  '/ja',
  '/de',
  '/zh-Hans',
  '/zh-Hant',
  '/en/about',
  '/ja/about',
  '/de/about',
  '/en/forum',
  '/de/forum',
  '/ja/morse/learn',
  '/zh-Hans/morse/learn',
  '/zh-Hant/morse'
];

for (const path of pages) {
  const response = await expectStatus(path, 200);
  assert.equal(canonical(response.body), `${publicOrigin}${path}`, `${path} canonical`);
  assert.ok(robots(response.body)?.includes('index'), `${path} should be indexable`);
  assert.ok(response.body.includes('<html lang="'), `${path} should expose a document language`);
  checks += 2;
}

for (const [path, location] of [
  ['/en/', `${publicOrigin}/en`],
  ['/ja/', `${publicOrigin}/ja`],
  ['/de/', `${publicOrigin}/de`],
  ['/zh-Hans/', `${publicOrigin}/zh-Hans`],
  ['/zh-Hant/', `${publicOrigin}/zh-Hant`],
  ['/en/about/', `${publicOrigin}/en/about`],
  ['/de/forum/', `${publicOrigin}/de/forum`],
  ['/ja/morse/learn/', `${publicOrigin}/ja/morse/learn`],
  ['/zh-Hans/morse/', `${publicOrigin}/zh-Hans/morse`],
  ['/en/forum/?category=feedback', `${publicOrigin}/en/forum?category=feedback`]
]) {
  await expectRedirect(path, location);
}

// Cloudflare forwards the visitor scheme; these are the historical soft-404
// HTTP aliases and their query-string equivalents.
await expectRedirect('/de/forum', `${publicOrigin}/de/forum`, {
  'X-Forwarded-Proto': 'http'
});
await expectRedirect('/en/forum?category=feedback', `${publicOrigin}/en/forum?category=feedback`, {
  'X-Forwarded-Proto': 'http'
});
await expectRedirect('/de/morse', `${publicOrigin}/de/morse`, {
  'X-Forwarded-Proto': 'http'
});
await expectRedirect('/en/?category=feedback', `${publicOrigin}/en?category=feedback`, {
  'X-Forwarded-Proto': 'http'
});

await expectRedirect(
  '/de/forum?x=1',
  `${publicOrigin}/de/forum?x=1`,
  {
    'CF-Visitor': '{"scheme":"http"}'
  },
  false
);

for (const host of ['www.morsewell.com', 'opencw.net', 'www.opencw.net']) {
  await expectRedirect('/en?a=1', `${publicOrigin}/en?a=1`, { Host: host });
  await expectRedirect(
    '/de/forum/?category=feedback',
    `${publicOrigin}/de/forum?category=feedback`,
    {
      Host: host,
      'X-Forwarded-Proto': 'http'
    }
  );
  await expectRedirect('/sitemap.xml', `${publicOrigin}/sitemap.xml`, { Host: host });
}

for (const path of ['/recover-device.html?from=settings', '/service-worker.js']) {
  for (const headers of [{ 'X-Forwarded-Proto': 'http' }, { 'CF-Visitor': '{"scheme":"http"}' }]) {
    await expectRedirect(path, `https://opencw.net${path}`, { Host: 'opencw.net', ...headers });
  }
}
const retirementWorker = await expectStatus('/service-worker.js', 200, { Host: 'opencw.net' });
assert.match(retirementWorker.headers['content-type'], /javascript/);
assert.match(retirementWorker.body, /registration\.unregister\(/);
assert.equal(retirementWorker.headers['cache-control'], 'no-store');
checks += 3;
const legacyRecovery = await expectStatus('/recover-device.html', 200, { Host: 'opencw.net' });
assert.ok(robots(legacyRecovery.body)?.includes('noindex'), 'keep browser recovery out of search');
checks += 1;

// Unknown Host headers must never become the redirect destination.
await expectRedirect('/en/', `${publicOrigin}/en`, { Host: 'evil.example' });
await expectRedirect('/en/?x=1', `${publicOrigin}/en?x=1`, {
  Host: 'evil.example',
  'X-Forwarded-Proto': 'http'
});
await expectRedirect('/en/', `${publicOrigin}/en`, { Host: 'www.morsewell.com.evil.example' });

// A direct container health check sends no forwarding headers and must stay 200.
await expectStatus('/', 200, {}, false);
await expectStatus('/en', 200, {}, false);

await expectStatus('/en/does-not-exist', 404);
await expectRedirect('/en/does-not-exist/', `${publicOrigin}/en/does-not-exist`, {}, true, 404);

const filtered = await expectStatus('/en/forum?category=feedback', 200);
assert.equal(canonical(filtered.body), `${publicOrigin}/en/forum`, 'filtered forum canonical');
checks += 1;

const settings = await expectStatus('/en/settings', 200);
assert.equal(canonical(settings.body), `${publicOrigin}/en/settings`, 'settings canonical');
assert.ok(robots(settings.body)?.includes('noindex'), 'settings should stay noindex');
checks += 2;

const aboutAlternates = alternates((await request('/de/about')).body);
assert.deepEqual(
  aboutAlternates.map(([locale]) => locale),
  ['en', 'zh-Hant', 'zh-Hans', 'ja', 'de', 'x-default'],
  'localized pages keep hreflang alternates'
);
checks += 1;

const robotsFile = await expectStatus('/robots.txt', 200);
assert.ok(robotsFile.body.split(/\r?\n/).includes(`Sitemap: ${publicOrigin}/sitemap.xml`));
checks += 1;

const sitemap = await expectStatus('/sitemap.xml', 200);
const locations = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.equal(locations.length, 30, 'sitemap URL count');
assert.equal(new Set(locations).size, 30, 'sitemap URLs are unique');
assert.ok(!sitemap.body.includes('<lastmod>'), 'sitemap must not stamp build-date lastmod');
checks += 3;

for (const location of locations) {
  const path = new URL(location).pathname;
  const response = await expectStatus(path, 200);
  assert.equal(canonical(response.body), location, `${location} sitemap canonical`);
  assert.ok(!robots(response.body)?.includes('noindex'), `${location} must be indexable`);
  checks += 2;
}

console.log(`SEO routing checks passed (${checks} assertions) against ${base.origin}.`);
