# SEO Indexing Remediation Report

**Repository:** DitPath / OpenCW (`https://opencw.net`)
**Worktree:** `/Users/alan/Desktop/Morse-seo-indexing`
**Branch:** `fix/seo-indexing` (from `origin/main` at `512bafe`)
**Investigation date:** 9 November 2026
**Source evidence:** `GSC_Indexing_Diagnostic_Report.md` (read from the original working tree) plus live production requests and browser-rendered checks
**Production changes deployed:** none

---

## 1. Executive summary and severity

The Search Console findings separate into four current or recent defects and several historical classifications:

| Finding | Status | Severity |
| --- | --- | --- |
| `https://opencw.net/{locale}/` returns HTTP 404 while the browser still renders the locale homepage | **Confirmed current defect** | **High** for the five locale entry points |
| HTTP and `www` HTTP URLs return 200 instead of redirecting to HTTPS apex | **Confirmed current defect** | **Medium** (duplicate/insecure aliases; historical soft 404s) |
| Every sitemap URL carries the build date as `lastmod` | **Confirmed current defect** | **Low–medium** (false freshness signal) |
| Localized forum-thread URLs declare themselves canonical while serving one shared post body | **Confirmed current defect** | **Medium** (Google selected the English URL) |
| Sitemap URLs previously classified as redirects (`/ja/morse/learn`, `/zh-Hans/morse`) | No longer redirect; both return 200 | Resolved/historical |
| Public pages not indexed (`/ja`, `/en/forum`, etc.) | No technical block found | Content/quality, not a routing defect |
| 66 noindex app/account/training URLs | Intentional exclusions preserved | No change |

The highest-impact defect is the trailing-slash 404. It affects public locale home pages, is invisible to a normal browser because the 404 document hydrates into the homepage, and matches Google's reported failed 404 fetches exactly. The forum canonical disagreement is also real: forum posts are stored once without a locale field, so the `zh-Hant` and `en` URLs contain the same post body.

No site-wide deindexing or server error was found. The readiness review identified a Host-header reflection in the trailing-slash redirect; it is fixed in this packet by using the fixed canonical origin. No remaining security issue was found in the reviewed changes. The changes are locally verified but **not deployed**.

---

## 2. Confirmed root causes and supporting evidence

### 2.1 Trailing-slash locale URLs fall through to the SPA 404 shell

**Cause:** The static build writes `/en.html` plus an `en/` directory for nested pages, but no `en/index.html`. nginx's fallback rule is:

```nginx
location / {
    try_files $uri.html $uri/index.html $uri =404;
}
```

For `/en/`, none of those candidates is a file. nginx serves `error_page 404 /404.html` with HTTP 404. That 404 document is the SvelteKit application shell; after JavaScript starts, the client router resolves `/en/` to the English homepage and replaces the address with `/en`. A browser therefore appears to show a working page while crawlers receive 404.

**Production evidence (9 November 2026):**

| URL | HTTP status | Observed behavior |
| --- | ---: | --- |
| `https://opencw.net/en` | 200 | English homepage |
| `https://opencw.net/en/` | **404** | 404 document; browser hydrates homepage and URL becomes `/en` |
| `https://opencw.net/ja/` | **404** | Same |
| `https://opencw.net/de/` | **404** | Same |
| `https://opencw.net/zh-Hans/` | **404** | Same |
| `https://opencw.net/zh-Hant/` | **404** | Same |
| `https://opencw.net/en/about/` | **404** | Same class of alias failure |
| `https://opencw.net/` | 200 | Root document with `/en` canonical |

Browser check with Playwright against production:

```text
path=/en/  status=404  url=https://opencw.net/en
title=DitPath - Learn Morse Code at Real Speed
h1=Learn Morse by listening.
canonical=https://opencw.net/en
```

This reproduces both the Search Console 404 and the independent Chrome observation.

**Files:** `frontend/nginx.conf`, `frontend/scripts/kit-options.js` (`fallback: '404.html'`), SvelteKit build output.

### 2.2 HTTP and `www` HTTP aliases return 200

**Cause:** The origin nginx configuration had no scheme or host normalization. Cloudflare currently redirects `https://www.opencw.net/` to the apex, but does not redirect plain HTTP before it reaches the origin.

**Production evidence:**

| Request | Status | Location |
| --- | ---: | --- |
| `http://opencw.net/de/forum` | 200 | none |
| `http://opencw.net/de/morse` | 200 | none |
| `http://opencw.net/en/forum?category=feedback` | 200 | none |
| `http://opencw.net/en/forum?category=showcase` | 200 | none |
| `http://www.opencw.net/` | 200 | none |
| `https://www.opencw.net/` | 301 | `https://opencw.net/` |

The four historical soft-404 examples are therefore still available as HTTP 200 duplicates with HTTPS canonicals. Their current HTTP responses are **not empty**; the historical soft-404 labels do not reproduce as empty content. The remaining defect is the non-canonical HTTP alias. No `Strict-Transport-Security` header was observed.

### 2.3 Sitemap `lastmod` is the build date for every URL

**Cause:** `frontend/src/routes/sitemap.xml/+server.ts` computed:

```ts
const now = new Date().toISOString().slice(0, 10);
```

and wrote the same `lastmod` for all 25 URLs. A rebuild with no content change therefore changes every `lastmod`, which is not a meaningful content-change signal.

**Production evidence:** All 25 sitemap entries displayed `lastmod` `2026-11-09`, matching the current build date. The sitemap contained 25 URLs across `de`, `en`, `ja`, `zh-Hans`, and `zh-Hant`.

### 2.4 Localized forum threads are duplicate content, not translations

**Cause:** `backend/internal/models/forum.go` stores `ForumThread` with `Title`, `Body`, `Category`, and `UserID`; there is no locale column. The public API returns the same thread for every locale prefix. The frontend nevertheless generated a self-canonical URL and five `hreflang` alternates per localized thread.

**Evidence:**

- `https://api.opencw.net/v1/forum/threads/01a163b8-d418-70ab-9d26-61f1bddc42bd` returned one English post body: “Welcome to training!”.
- Production `https://opencw.net/zh-Hant/forum/01a163b8-...` rendered that same English post body. Only the interface chrome was Traditional Chinese.
- Its declared canonical was the `zh-Hant` URL, with six `hreflang` links.
- Search Console selected `https://opencw.net/en/forum/01a163b8-...` instead.
- The English thread `/en/forum/01a17684-2b98-73e8-a222-fbbf88342fb1` likewise rendered the post body client-side; its initial response was the 5,178-byte fallback shell.

This is genuine duplicate content, not a localization difference. Static pages such as `/about` remain genuinely translated and were not changed.

### 2.5 Sitemap URLs reported as redirects are currently valid

| URL | Current production status |
| --- | ---: |
| `https://opencw.net/ja/morse/learn` | 200 |
| `https://opencw.net/zh-Hans/morse` | 200 |

All 25 sitemap URLs currently return 200 with a self-referencing canonical and an indexable robots directive. No sitemap URL removal was justified. Search Console's redirect classifications are historical.

### 2.6 Public pages not indexed

`/en/forum`, `/ja`, `/ja/about`, `/de/about`, `/de/morse/learn`, `/de/forum`, and `/zh-Hans/morse/learn` were checked in production and in a browser-rendered pass. All returned 200, exposed localized content, correct `lang`, self-canonical URLs, and indexable robots directives. The forum list and thread bodies are fetched client-side, but Google's recorded inspections reported successful fetches, allowed crawling, and allowed indexing. No technical block was found, so no speculative content or noindex change was made.

### 2.7 Noindex exclusions

`/settings`, `/profile`, `/login`, `/register`, `/more`, `/morse/progress`, `/morse/practice`, and `/morse/learn/session` render `noindex,nofollow` in all locales and are absent from the sitemap. This is consistent with their signed-in, stateful, or redirect-only purpose. They were left unchanged.

---

## 3. Affected URLs and code/configuration locations

| Affected URL or surface | Relevant location |
| --- | --- |
| `/en/`, `/ja/`, `/de/`, `/zh-Hans/`, `/zh-Hant/` and nested trailing-slash aliases | `frontend/nginx.conf` (`location /` and new slash redirect) |
| HTTP and `www` variants of all pages | `frontend/nginx.conf` (new scheme/host normalization) |
| `http://opencw.net/de/forum`, `/en/forum?category=feedback`, `/en/forum?category=showcase`, `/de/morse` | Same nginx redirect layer; destinations remain the existing HTTPS pages |
| `sitemap.xml` `lastmod` | `frontend/src/routes/sitemap.xml/+server.ts`, new `frontend/src/lib/sitemap.ts` |
| Localized forum thread canonical/hreflang | `frontend/src/routes/+layout.ts`, helpers in `frontend/src/lib/seo.ts` |
| Forum data has no locale field | `backend/internal/models/forum.go` (read-only investigation; no backend change) |
| Sitemap URL inventory and public/noindex route policy | `frontend/src/lib/routes.js`, `frontend/src/lib/seo.ts` |
| Deployment edge behavior | Cloudflare Tunnel in `docker-compose.yaml`; Cloudflare dashboard settings are external to the repository |

---

## 4. Changes made and why

### 4.1 nginx: permanent trailing-slash redirects

Added, before the forum SPA fallback:

```nginx
location ~ ^(.+)/$ {
    return 301 https://opencw.net$1$is_args$args;
}
```

This redirects valid trailing-slash aliases to their slashless canonical URL, preserves query strings, and prevents `/en/` from reaching the 404 shell. The destination is the fixed canonical origin, so an arbitrary `Host` header can never become a redirect target. The rule is ordered before the forum deep-link fallback so `/en/forum/<id>/` is also normalized.

### 4.2 nginx: HTTP-to-HTTPS and www-to-apex normalization

Added server-level redirects with fixed public destinations:

- `X-Forwarded-Proto: http` or `CF-Visitor` with `"scheme":"http"` → 301 to `https://opencw.net...`.
- `Host: www.opencw.net` → 301 to `https://opencw.net...`.
- Trailing slashes are stripped in the same redirect (for example, HTTP `/en/?x=1` → `https://opencw.net/en?x=1`).
- Redirect destinations never use `$http_host` or another request-controlled host value.
- Requests without forwarding headers, including the container health check, keep returning 200.

The `CF-Visitor` fallback covers Cloudflare Tunnel deployments that preserve that header even if `X-Forwarded-Proto` is absent.

### 4.3 Sitemap: remove build-date `lastmod`

Moved sitemap XML construction into `frontend/src/lib/sitemap.ts` and removed `<lastmod>`. The 25 canonical URLs, changefreq, and priority values are unchanged. The sitemap now avoids claiming that every page changed on every build; `lastmod` should only return when a real per-page content timestamp exists.

### 4.4 Forum threads: canonicalize shared content to English

Added route-aware canonical helpers:

- `buildCanonicalPath()` canonicalizes `/forum/[id]` to `/en/forum/<id>` for every locale prefix.
- `buildLocalizedAlternates()` returns no translation alternates for that route.
- `x-default` continues to point at the English canonical.
- The document `lang` remains the visitor's locale, so the translated interface is preserved.
- Static localized routes (`/about`, `/morse`, `/morse/learn`, etc.) keep their own locale canonical and five `hreflang` alternates.

This is a content-driven decision, not a blanket canonical collapse. If forum posts gain real per-locale content later, this policy should be revisited.

### 4.5 Regression coverage

Added or extended:

- `frontend/src/lib/seo.test.ts`: canonical/alternate policy, 25-URL sitemap, noindex exclusions, no `lastmod`.
- `frontend/e2e/seo.preview.spec.ts`: browser-level canonical and hreflang checks for a translated page and a shared forum thread.
- `frontend/scripts/check-seo-routing.mjs`: 215 HTTP assertions for localized pages, slash aliases, HTTP/www redirects, unrecognized Host headers, query preservation, redirect-loop prevention, direct health checks, 404s, noindex routes, and every sitemap URL. It is exposed as `npm run seo:routing -- <base-url>`.
- `frontend/scripts/validate-seo.ts`: now fails if the slash, scheme, or host redirects are missing or ordered after the forum fallback, or if nginx uses `$http_host` in a redirect.
- `.github/workflows/ci.yml`: builds the production frontend image, runs `nginx -t`, and runs the routing verifier against that image.

No backend, database, authentication, branding, or product-content changes were made.

---

## 5. Test and build results

All commands were run in the worktree. Frontend commands used Node 26 on `PATH` and `PUBLIC_API_BASE=https://api.opencw.net/v1`; the production build also used `PRERENDER_ORIGIN=https://opencw.net`.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run verify` | **exit 0** | 720 message keys / 5 locales; SEO validation passed; svelte-check 0 errors / 0 warnings; worker and script TypeScript checks passed; **80 test files / 1000 tests passed** |
| `npm run lint` | **exit 0** | Prettier clean; ESLint clean |
| `npm run seo:validate` | **exit 0** | 25 sitemap URLs; locale list, slash redirect, scheme redirect, host redirect checks passed |
| `npm run build` | **exit 0** | Static output written to `frontend/build` |
| `npm run seo:routing -- http://127.0.0.1:8089` | **exit 0** | **215 assertions passed** against local nginx |
| `npx playwright test e2e/seo.preview.spec.ts` (Chromium + WebKit) | **exit 0** | 4 tests passed |
| Playwright Firefox engine | **not executed** | Local Firefox build failed to launch with “Could not find profile folder”; Chromium and WebKit passed the same SEO assertions |
| `docker build ...` | **exit 0** | Production image built with the same build arguments |
| `docker exec ... nginx -t` | **exit 0** | Configuration syntax and test successful |
| Routing check against the built image | **exit 0** | **215 assertions passed** |
| Remote GitHub Actions run of `nginx-routing` | **not executed** | Workflow added; its exact build/`nginx -t`/routing sequence was run locally against the production image |
| `go test ./...` | **exit 0** | All backend packages passed (backend unchanged) |
| `go vet ./...` | **exit 0** | No findings |

### Local post-fix behavior

| Request | Result |
| --- | --- |
| `GET /en`, `/ja`, `/de`, `/zh-Hans`, `/zh-Hant` | 200 |
| `GET /en/` | 301 → `https://opencw.net/en` |
| `GET /ja/`, `/de/`, `/zh-Hans/`, `/zh-Hant/` | 301 → slashless equivalent |
| `GET /en/about/`, `/de/forum/`, `/ja/morse/learn/`, `/zh-Hans/morse/` | 301 → slashless equivalent |
| `GET /en/forum/?category=feedback` | 301 → `https://opencw.net/en/forum?category=feedback` |
| `GET /de/forum` with forwarded HTTP | 301 → `https://opencw.net/de/forum` |
| `GET /en/forum?category=feedback` with forwarded HTTP | 301 → `https://opencw.net/en/forum?category=feedback` |
| `GET /` with forwarded HTTP | 301 → `https://opencw.net/` |
| `GET /en?a=1` with `Host: www.opencw.net` | 301 → `https://opencw.net/en?a=1` |
| `GET /en/does-not-exist` | 404 |
| `GET /en/does-not-exist/` | 301 → `/en/does-not-exist`, then 404 |
| All 25 sitemap URLs | 200, self-canonical, indexable |
| `/en/settings` | 200, `noindex,nofollow` |
| `GET /sitemap.xml` | 200, 25 URLs, zero `<lastmod>` values |

Live production was **not** modified during this work. The production checks in this report are pre-deployment observations; the post-fix status results are from a local nginx container serving the rebuilt static output and from the built production image.

---

## 6. Unresolved issues and uncertainties

1. **Invalid forum thread IDs still return HTTP 200.** nginx intentionally serves the SPA fallback for every `/forum/<id>` path because it cannot query the API. `/en/forum/not-a-thread` returns 200 and the client renders a not-found state. Returning a true 404 requires a runtime lookup or a different hosting architecture; this was not changed because it would affect the valid deep-link fallback. This is a soft-404 risk, but no invalid thread URL appears in the supplied Search Console evidence.

2. **Forum thread initial HTML contains no post content or canonical.** The fallback shell is 5,178 bytes and gets canonical/content only after JavaScript runs. Google rendered the pages in the reported inspections, but crawlers or unfurlers that do not execute JavaScript will not see the thread body. Fixing this requires server-side rendering or build-time thread generation, which is a larger architectural/product decision.

3. **Cloudflare edge configuration was not inspected directly.** The repository contains the Tunnel service, but the zone's “Always Use HTTPS”, www redirect rule, HSTS, and cache rules live in the Cloudflare dashboard. The origin now handles HTTP/www normalization using forwarded headers, but the edge should also enforce HTTPS as the primary control.

4. **Search Console's stale sitemap read date is unexplained.** The live sitemap returns 200 and contains 25 valid URLs, but Search Console reports the last successful read as 15 April 2026 with 21 discovered pages. This may be reporting lag, a stale submission, or an edge/cache issue. It cannot be resolved from repository code alone.

5. **The site root is still submitted as a sitemap.** `https://opencw.net/` is an HTML page, not a sitemap, and Search Console lists one error for that submission. Removing it is a manual Search Console action, not a code change.

6. **Noindex intent for every private route was not re-litigated.** The route list is consistent with signed-in/stateful surfaces, and the sampled session inspection showed the intended noindex. If `/more` or another route is intended as a public landing page, that is a product decision.

7. **The forum canonical policy assumes posts have no per-locale content.** That is true today. If translations or a locale field are added, the canonical rule must be revisited.

---

## 7. Deployment considerations

- **Required:** rebuild and redeploy the frontend image. The nginx configuration and static build are both inside that image; there is no backend or database migration.
- **Cloudflare:** enable “Always Use HTTPS” for `opencw.net` and confirm the www-to-apex redirect applies to both HTTP and HTTPS. The origin now provides a fallback, but edge enforcement is preferable and avoids relying on forwarded headers.
- **Header dependency:** verify that the Tunnel forwards `X-Forwarded-Proto` or `CF-Visitor` to nginx. The local image test exercised both. If both are stripped, enable HTTPS enforcement at Cloudflare instead.
- **Cache:** production HTML is currently `cf-cache-status: DYNAMIC`; `robots.txt` was observed cached. After deployment, purge cached `robots.txt`, `sitemap.xml`, and affected HTML only if the edge serves stale content. Do not purge unrelated assets.
- **HSTS:** no HSTS header was observed. Consider adding it at Cloudflare after HTTPS normalization is confirmed stable; this is an operations/security decision, not part of this packet.
- **Health check:** the container probe requests `http://127.0.0.1/` without forwarding headers and still receives 200. This was preserved deliberately.
- **Rollback:** revert the frontend image to the previous build. No data rollback is needed.
- **Do not** merge, push, deploy, or change Cloudflare/GSC settings without explicit authorization.

---

## 8. Manual Google Search Console actions after deployment

Do these only after the new image is live and the URLs have been rechecked with `curl` or URL Inspection:

1. **Confirm the fixes live:** `https://opencw.net/en/` should return `301` to `https://opencw.net/en`, then `200`. Repeat for `ja`, `de`, `zh-Hans`, and `zh-Hant`. Confirm HTTP and `www` variants redirect once to HTTPS apex.
2. **Sitemap:** resubmit `https://opencw.net/sitemap.xml`. Confirm it is read successfully, contains 25 URLs, and reports no `lastmod` values. Remove the separate `https://opencw.net/` sitemap submission and review its one error.
3. **404 validation:** after the redirects are live, use the Page indexing report's 404 validation for the locale-root URLs. Do not request indexing or start validation before deployment.
4. **Soft 404 validation:** recheck the four historical HTTP examples in URL Inspection. They should now resolve through a single 301 to the HTTPS page. Start validation only if the current live test confirms the redirect and the destination content.
5. **Canonical disagreement:** inspect the `zh-Hant` forum thread after deployment. The declared canonical should now be `https://opencw.net/en/forum/01a163b8-d418-70ab-9d26-61f1bddc42bd`, with no false `hreflang` alternates. Do not force-index the localized duplicate.
6. **Crawled, not indexed:** leave `/ja`, `/ja/about`, `/de/about`, `/de/morse/learn`, `/de/forum`, `/zh-Hans/morse/learn`, `/en/forum`, and the English post alone unless a live inspection shows a new technical error. These pages had no confirmed technical block.
7. **Noindex:** do not remove noindex from account, settings, training-session, progress, or practice routes. The current exclusions match the route policy.

---

## 9. Recommended monitoring and follow-up

- Re-run `npm run seo:routing -- https://opencw.net` against production only after confirming the verifier is safe for public checks; by default it is intended for a local/staging nginx instance.
- Monitor weekly for new 404, soft 404, and redirect classifications in Search Console, especially the five locale roots.
- Watch whether Google reselects the English forum-thread canonical and whether the `zh-Hant` duplicate disappears from the “Duplicate, Google chose different canonical” bucket.
- Confirm the sitemap is re-read and discovered-page count rises from 21 toward 25. A stale read date that persists after resubmission is an operational issue, not a reason to add more URLs.
- Keep `lastmod` absent until the build can supply real per-page content timestamps. Do not reintroduce a build-date value.
- If forum translations or locale-specific posts are added later, revisit the thread canonical policy and add locale-aware hreflang.
- The CI `nginx-routing` job runs the routing verifier against the production image. Keep that job required for merge so nginx behavior cannot regress silently.
- Address invalid-thread 200 responses only if product requirements justify a runtime lookup or a server-rendered forum. Do not add speculative noindex rules to valid threads.

---

## Modified files

| File | Change |
| --- | --- |
| `frontend/nginx.conf` | Slashless 301 aliases, HTTP→HTTPS and www→apex normalization, forwarded-scheme handling |
| `frontend/src/routes/+layout.ts` | Route-aware canonical and hreflang generation using shared-content policy |
| `frontend/src/lib/seo.ts` | `hasLocaleIndependentContent`, `buildCanonicalPath`, `buildLocalizedAlternates` |
| `frontend/src/lib/sitemap.ts` | New sitemap XML builder without build-date `lastmod` |
| `frontend/src/routes/sitemap.xml/+server.ts` | Uses the shared sitemap builder |
| `frontend/src/lib/seo.test.ts` | Canonical, hreflang, sitemap, and noindex regression tests |
| `frontend/scripts/validate-seo.ts` | Fails when nginx redirect rules are missing or misordered, or when `$http_host` is used |
| `frontend/scripts/check-seo-routing.mjs` | New 215-assertion HTTP routing verifier |
| `frontend/e2e/seo.preview.spec.ts` | Browser checks for localized and forum-thread metadata |
| `frontend/package.json` | Adds `seo:routing` script |
| `.github/workflows/ci.yml` | Builds the production image, validates nginx, and runs the routing verifier |

**Backend files changed:** none.
**Production data changed:** none.
**Deployment performed:** no.
**Push/merge performed:** no.

The changes are consistent with the existing SvelteKit static architecture, pass the full frontend and backend test suites, and are **ready for deployment review** after the Cloudflare/header and GSC manual steps in sections 7–9 are acknowledged.
