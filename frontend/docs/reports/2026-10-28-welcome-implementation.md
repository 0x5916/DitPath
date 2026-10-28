# Approved welcome redesign — 28 October 2026

## Scope

Implemented the user-approved [Penpot current Home design](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-db81dfc8c62d).
The page is now named `01 · Home · Current`; the directory is documented in
[file organization](2026-10-28-penpot-organization.md).
This supersedes the modest first-use Home refinement earlier in the same chat.
Existing uncommitted work was preserved. No backend, dependency, authentication,
or deployment changes were made.

The welcome now has the approved original radio/headphones SVG, focused header,
language selection, primary lesson action, practice alternative, sign-in, and
optional listening demo. Native disclosures support keyboard use. Closing the
demo unmounts its audio engine; reopening starts fresh. Existing Home activity
and owner logic still chooses the returning dashboard. The regular app navigation
returns on other pages. All five message catalogs were updated.

Visual comparison covered light/dark desktop and phone, short-screen 320px,
German reflow, the original illustration geometry and the Forest palette.
System fonts are retained rather than introducing a webfont dependency. Native
select/disclosure indicators and stronger control borders preserve accessibility.
The welcome footer retains More for access to the rest of the application.
Penpot handoff version: `Approved welcome · Local implementation handoff · 28 Oct`.

## Verification

Node 26.12.1. Commands ran in `frontend/`, with local `PUBLIC_API_BASE` supplied
for verification/build. No live API was required.

| Check                                 | Exit | Result                                                                                            |
| ------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `npm run verify` (final source)       | 0    | 768 tests across 62 files; Svelte check: 0 errors, 0 warnings                                     |
| `npm run lint`                        | 0    | Prettier and ESLint pass                                                                          |
| `npm run build`                       | 0    | Static build succeeds                                                                             |
| Svelte autofixer                      | 0    | HomeLanding and WelcomeIllustration: no issues or suggestions                                     |
| Responsive/interaction browser script | 0    | 46 checks; no page runtime errors                                                                 |
| Complete lesson on static preview     | 0    | 15 prompts, completed session and 13 answer records; Finish returns to Lessons; no runtime errors |
| `git diff --check`                    | 0    | Clean                                                                                             |

Browser: temporary Chromium 151 via the bundled Playwright client. The 40-layout
matrix uses en/de/ja/zh-Hans/zh-Hant, light/dark, and widths 320/390/768/1440.
At 320px, height is 568px and the English primary action remains in view.
Checks cover page overflow, 52px primary target, header variants, hidden welcome
tab bar, demo mount/unmount, and method disclosure. Six additional checks cover
keyboard demo activation and quiz feedback focus, demo reset, language switching,
practice/login navigation, lesson initialization, and a synthetic returning
learner restoring the dashboard and tab navigation.

Temporary reproducibility artifacts: `/tmp/welcome-qa.cjs`, `/tmp/welcome-qa/`,
`/tmp/welcome-lesson.cjs`; command logs are `/tmp/welcome-*-verify.log`,
`/tmp/welcome-lint.log`, and `/tmp/welcome-build.log`.
Initial QA retries corrected a native-toggle timing wait, a stale fixture store
name, the warm-up choice selector, automatic input submission, and the duplicate
Finish controls; these were test-script issues.

Physical mobile keyboards, assistive-technology journeys, audible sound quality,
and live account synchronization are not established by these automated checks.
Nothing was pushed, merged, or deployed.

Working tree: five catalogs, app.css, HomeLanding and the previously modified
HomePreview; new WelcomeIllustration and the two dated Home reports. No other
source files were changed.
