# Home first-use refinement — 28 October 2026

## Scope and acceptance

One presentation packet on first-use Home: stronger heading hierarchy, compact
desktop lesson action, mobile lesson entry before listening, and warm flat surfaces
with a Forest accent edge. DOM order follows mobile reading and keyboard order.
Audio, quiz, translations, accounts, and training logic are unchanged. This is not
an application-wide redesign or full acceptance closure.

Acceptance: save editable Penpot targets before implementation; compare phone and
desktop screenshots; check both themes, five locales, narrow reflow, target sizes,
disclosure, keyboard order, listening, quiz feedback, and lesson navigation.

## Design handoff

[Penpot Home page](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=910435ec-86a9-80a6-8008-d94209810cc2)
is now named `90 · Archive · Original Home and refinements`. Original designs
start at y=320; the three superseded refinement frames start at y=1520 and their
handoff is at y=2560. The `00 · Start here` directory links to this archive and
the current welcome design separately. Existing page/frame IDs are preserved.
See [file organization](2026-10-28-penpot-organization.md) for the final directory.

- Phone light: `fd9f7595-460b-8009-8008-db1d5ae3e8f7`
- Phone dark: `fd9f7595-460b-8009-8008-db1d5c11ab64`
- Desktop dark: `fd9f7595-460b-8009-8008-db1d5d3cc156`

Named versions saved successfully:

- `28 Oct · Home hierarchy and listening surfaces · before implementation`
- `28 Oct · Home refinement · browser verified handoff`

Targets are editable static shapes; inherited prototype links were removed.
Penpot uses its existing Roboto fallback; the frontend retains system/Avenir fonts.
Browser comparison confirmed hierarchy, surfaces, button proportions and order;
font metrics are not pixel-identical. A final redundant Penpot inspection was
blocked by an automatic-approval usage limit after both successful version saves.

Source baseline: `ac51dcf8e3518ffb982df3fc82ed4b63cf087688`, plus this uncommitted packet.

## Verification

Node 26.12.1; local API base `http://127.0.0.1:8080/v1` for build configuration.
No backend was started or changed.

| Check                                    | Exit | Result                                                                                    |
| ---------------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| `npm run verify`                         | 0    | 768 tests, 62 files; messages, SEO, Svelte and TypeScript gates pass                      |
| `npm run lint`                           | 0    | Prettier and ESLint pass                                                                  |
| `npm run build`                          | 0    | Static build succeeds                                                                     |
| Svelte autofixer, both edited components | 0    | No issues; existing HomePreview `bind:this` suggestion retained for quiz focus management |
| Temporary Playwright checks              | 0    | 43 checks; no page runtime errors                                                         |
| `git diff --check`                       | 0    | Clean                                                                                     |

Matrix: 320/390/768/1280px × light/dark × en/de/ja/zh-Hans/zh-Hant.
All 40 combinations passed horizontal-overflow, minimum 48px primary target,
DOM-order, mobile entry-before-panel, and open/close disclosure checks. Three
additional checks covered keyboard focus order, K/M playback completion with quiz
feedback, and navigation into Lesson 1. Screenshots were inspected for English
phone/desktop, German 320px, dark desktop, and quiz feedback.
Temporary script/captures: `/tmp/opencw-home-qa.cjs`, `/tmp/opencw-home-qa/`.

Firefox supported initial inspection but its viewport resize remained at 500px;
responsive assertions use Chromium 151 through the bundled Playwright client.
The temporary browser lives outside the repository. Preview setup required locked
dependencies and the configured Paraglide plugin fetch; no manifest or lock changed.

Native keyboards, screen readers, audible output quality, complete lesson
persistence, and live account/sync were not retested by this visual packet.
No push, merge, or deployment occurred.

Working-tree handoff: modified `HomeLanding.svelte` and `HomePreview.svelte`, with
this report added; no other source changes.
