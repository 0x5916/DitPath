# Frontend instructions for coding agents

The root [AGENTS.md](../AGENTS.md) also applies. This file retains frontend implementation requirements; see [README.md](README.md) for setup and [learning.md](docs/learning.md) for the current architecture.

## Architecture and browser isolation

- Preserve SvelteKit 5 and `adapter-static`. Known pages are prerendered for five locales; `/forum/[id]` is the client-rendered fallback exception. Production has no SvelteKit server runtime.
- Guard `window`, `document`, `localStorage`, `indexedDB`, and Web Audio access with `browser` checks or `onMount`. Never execute browser APIs at module top-level or during prerender.
- `src/lib/training/` contains pure TypeScript curriculum, timing, lesson building, scoring, mastery, scheduling, and state machines. These domain modules must not depend on Svelte, DOM, or storage.
- The existing `training/v2/session-controller.svelte.ts` is an explicit orchestration exception: it uses Svelte runes and injected audio/repository ports. Keep domain calculations in the pure modules and browser resource creation in the route/audio/data layers.
- `src/lib/audio/` schedules `AudioPlan` on the native timeline; `src/lib/data/` owns IndexedDB, repositories, and migrations.
- `src/lib/components/` receives display state and emits user intent. Components must never calculate mastery, schedule audio nodes, or query IndexedDB directly.

## Svelte 5

- Use `$state`, `$derived`, `$effect`, and `$props` runes.
- Never add Svelte 4 legacy syntax: `let:` slots, `<slot />`, `export let`, or writable-store syntax where runes apply.
- Use `untrack` inside effects for reactive reads that must not trigger reruns.
- Prefer explicit function callbacks/rune properties over deprecated `createEventDispatcher`.

## Localization

- Translation source is `messages/{en,de,ja,zh-Hans,zh-Hant}.json`. Never edit generated `src/lib/paraglide/` files.
- Update all five catalogs for message changes; run `npm run messages:validate` and `npm run check`.
- Preserve full sentence context for translators; never concatenate localized sentence fragments.

## Visual system

- Use warm neutral surfaces, amber `--accent`/`--accent-cta`, semantic `--status-good`/`--status-ok`/`--status-bad`/`--status-extra`, flat surfaces, 2–6px `--radius-*`, and the 4px `--space-*` rhythm.
- All color literals belong in `src/app.css`. Never hard-code hex colors or arbitrary utility colors in Svelte components; read `var(--token)`.
- Cards must stay flat without hover/lift unless the whole element is an interactive link or button.
- Use the installed Lucide icons (`@lucide/svelte`), never emoji UI icons.

## Sound-first accessibility requirements

- Assessed recognition must never show dot/dash notation, Morse spelling, or animated equalizers that decode the answer during recall.
- Success/error feedback must include text and icons; color alone is insufficient.
- Primary training targets must be at least 44 × 44 CSS px, preferably 48 × 48, with at least 8px between targets.
- Space replays the active prompt, guarded against scrolling and text composition; Enter submits or continues from feedback.
- Keep every control keyboard-focusable with visible `--focus-ring` and no keyboard traps.
- Suppress animations with `prefers-reduced-motion: reduce`; use static transitions.

## Verification

Run with Node 26 (`export PATH="/opt/homebrew/opt/node/bin:$PATH"`):

```sh
npm run test
npm run verify
npm run lint
npm run build
```

`verify` includes Vitest; use a separate `test` run for focused iteration or when an earlier gate blocks the full run, without repeating already-passed tests unnecessarily.

Capture exit codes, test counts, and `git status --short` before declaring completion. Document blocked gates accurately; browser interaction is required to verify complete session behavior.
