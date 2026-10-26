# DitPath frontend

The frontend uses SvelteKit 3, Svelte 5, TypeScript 6, Tailwind CSS 4, and Paraglide for English, German, Japanese, Simplified Chinese, and Traditional Chinese. Production uses `adapter-static` and nginx, with no SvelteKit server runtime. Shared framework configuration lives in [kit-options.js](scripts/kit-options.js), consumed by Vite, Vitest, and ESLint.

Known pages are prerendered in five locale variants. Forum thread IDs exist only at runtime: [`/forum/[id]`](src/routes/forum/[id]/+page.ts) renders client-side through the HTTP 200 fallback in [nginx.conf](nginx.conf). Other unknown URLs retain HTTP 404.

The [service worker](src/service-worker/index.ts) uses the shared route/locale inventory and
[offline cache policy](src/lib/offline-cache.ts). Build/static assets are cache-first;
known page navigations are network-first with their own cached shell as fallback.
Home, Lessons, Practice, and Progress shells are precached in all five locales;
other known pages become available offline after an online visit.
API, authenticated, and cross-origin requests bypass caching. On activation, the
worker removes older DitPath caches, including legacy private entries, while
preserving unrelated caches. Existing tabs finish before the new worker activates.

## Development

Use Node 26.12.1 or newer within Node 26. From this directory:

```sh
export PATH="/opt/homebrew/opt/node/bin:$PATH"
npm ci
cp example.env .env
npm run dev
```

Sound training saves guided attempts and checked practice passages locally, then synchronizes signed-in accounts through V1. Account history, pending uploads, and download checkpoints use separate immutable-account-ID partitions; guest and migrated history remain unclaimed until explicitly imported. Lessons, Progress, and Profile read the same local partition and remain usable offline. API access is needed for synchronization, accounts, the forum, and server-backed settings; follow the [backend setup](../backend/README.md) to start it. [example.env](example.env) defaults `PUBLIC_API_BASE` to `http://localhost:8080/v1`; `PRERENDER_ORIGIN` controls canonical and sitemap origins. Both are build-time values.

For optional Google sign-in, set `PUBLIC_GOOGLE_CLIENT_ID` to the same web client ID as backend `GOOGLE_CLIENT_ID`, then rebuild. Empty values omit the Google button and SDK. The backend must explicitly allow the frontend origin even in development; see [backend configuration](../backend/README.md#google-sign-in). Login and Register use Google's official button and ask new users only for an OpenCW username. Existing password accounts require a separately implemented linking flow to add Google to that same account.

## Checks and builds

For real-device validation, use the [Android Chrome / TalkBack walkthrough](docs/android-acceptance.md)
with the private USB preview and disposable API.

For repeatable synthetic UI states, run `npm run acceptance` and open
`http://127.0.0.1:4174/__acceptance`. The chooser replaces only the dedicated
`ditpath_ui_acceptance` database and test-origin auth/training preferences; close
other acceptance tabs first. It covers empty/returning/interrupted/completed
learning, ten-second loading, a Practice save that fails once, unavailable account
settings, and pending uploads. Finish and check a Practice passage to trigger the
save failure, then use **Retry save**. Return to the chooser to reset a scenario.

The launcher forces a local mock API (every request returns 503), disables Google
sign-in, and binds only to loopback. Never enter real credentials here. These
fixtures verify presentation and recovery, not successful server synchronization.
The separate [acceptance config](scripts/acceptance/config.ts) refuses builds;
normal builds do not import its fixtures or fault hooks. The
[fixture tests](scripts/acceptance/fixtures.test.ts) check actual repository and
guidance outcomes and fail when a source injection seam changes.

[package.json](package.json) is the command inventory. `npm run verify` runs message validation, SEO validation, Svelte/TypeScript checking, script checking, and Vitest. Run `npm run lint` for Prettier/ESLint and `npm run build` for the static output in `build/`. `npm run preview` serves that build locally.

`npm run check` compiles Paraglide before Svelte checking and runs `check:worker` against the separate [service-worker TypeScript config](src/service-worker/tsconfig.json); `npm run build` compiles Paraglide through the Vite plugin. Tests run in Node via [vitest.config.ts](vitest.config.ts), including domain, controller, audio, sync, and repository tests. IndexedDB tests use the `fake-indexeddb` development dependency declared in [package.json](package.json).

For targeted Svelte reviews, use the pinned `@sveltejs/mcp` development dependency:

```sh
npx --no-install @sveltejs/mcp svelte-autofixer ./src/lib/components/learning/AudioPrompt.svelte --svelte-version 5
```

The autofixer reports issues and suggestions without editing source. Review both lists and rerun after fixes; exit code 0 alone does not mean the analysis is clean. The installed CLI fetches official documentation from `svelte.dev` at startup, so it still requires network access. This manual review runs separately from `npm run verify`.

[Dockerfile](Dockerfile) runs verification before building. To build and serve the image:

```sh
docker build --build-arg PUBLIC_API_BASE=https://api.example.com/v1 --build-arg PRERENDER_ORIGIN=https://opencw.net -t opencw-frontend .
docker run -p 3000:80 opencw-frontend
```

## Documentation and source ownership

- [AGENTS.md](AGENTS.md): implementation boundaries and required verification evidence.
- [Learning architecture](docs/learning.md): routes, domain/controller boundaries, storage, and UI acceptance.
- [UI/UX backlog](docs/ui-ux-audit.md): remaining source findings and required browser validation.
- [Frontend remediation report](docs/reports/2026-10-16-frontend-remediation.md): completed fixes, verification evidence, and remaining limits from the October review.
- [messages/](messages/): translation source catalogs; all five must contain matching keys and placeholders.
- [project.inlang/settings.json](project.inlang/settings.json) and [Paraglide options](scripts/paraglide-options.ts): locale/compiler configuration. SDK-generated inlang notes/cache and `src/lib/paraglide/` are not maintained documentation.
- [src/app.css](src/app.css) and [layout styles](src/lib/styles/layout.css): tokens, shared controls, and page/navigation layout.

The root [repository instructions](../AGENTS.md) also apply. Keep current architecture here and actionable gaps in the backlog; record command results and one-time working-tree snapshots with the change rather than appending them to these docs.
