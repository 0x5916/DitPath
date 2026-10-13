# DitPath frontend

The frontend uses SvelteKit 5, TypeScript, Tailwind CSS 4, and Paraglide for English, German, Japanese, Simplified Chinese, and Traditional Chinese. Production uses `adapter-static` and nginx, with no SvelteKit server runtime.

Known pages are prerendered in five locale variants. Forum thread IDs exist only at runtime: [`/forum/[id]`](src/routes/forum/[id]/+page.ts) renders client-side through the HTTP 200 fallback in [nginx.conf](nginx.conf). Other unknown URLs retain HTTP 404.

## Development

Use Node 26. From this directory:

```sh
export PATH="/opt/homebrew/opt/node/bin:$PATH"
npm ci
cp example.env .env
npm run dev
```

Sound training stores guided attempts on the device. API access is needed for accounts, the forum, and server-backed settings/progress; follow the [backend setup](../backend/README.md) to start it. [example.env](example.env) defaults `PUBLIC_API_BASE` to `http://localhost:8080/v1`; `PRERENDER_ORIGIN` controls canonical and sitemap origins. Both are build-time values.

## Checks and builds

[package.json](package.json) is the command inventory. `npm run verify` runs message validation, SEO validation, Svelte/TypeScript checking, script checking, and Vitest. Run `npm run lint` for Prettier/ESLint and `npm run build` for the static output in `build/`. `npm run preview` serves that build locally.

`npm run check` compiles Paraglide before Svelte checking; `npm run build` compiles it through the Vite plugin. Tests run in Node via [vitest.config.ts](vitest.config.ts), including domain, controller, audio, sync, and repository tests. IndexedDB tests use the `fake-indexeddb` development dependency declared in [package.json](package.json).

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
- [messages/](messages/): translation source catalogs; all five must contain matching keys and placeholders.
- [project.inlang/settings.json](project.inlang/settings.json) and [Paraglide options](scripts/paraglide-options.ts): locale/compiler configuration. SDK-generated inlang notes/cache and `src/lib/paraglide/` are not maintained documentation.
- [src/app.css](src/app.css) and [layout styles](src/lib/styles/layout.css): tokens, shared controls, and page/navigation layout.

The root [repository instructions](../AGENTS.md) also apply. Keep current architecture here and actionable gaps in the backlog; record command results and one-time working-tree snapshots with the change rather than appending them to these docs.
