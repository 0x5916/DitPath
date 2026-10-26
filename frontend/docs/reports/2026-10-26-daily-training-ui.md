# Daily training UI delivery — 26 October 2026

This implements the approved [daily-training packet](../ui-ux-audit.md#daily-training-experience--26-october-2026). Current architecture belongs in [learning.md](../learning.md). Backend contracts, scoring, mastery, curriculum, dependencies, and deployment were not changed.

## Delivered behavior

- Consistent desktop/mobile navigation and a shared More hub; theme and language now live in Settings.
- A stronger recommended lesson on Home, direct lesson selection in Practice, contextual instructions, and the existing lesson roadmap.
- Copying during audio, explicit replacement/departure dialogs, preserved Back/Forward history, readable results, retryable saves, and Finish/Another passage actions.
- Needs attention before activity, three initial findings, counted unmeasured-character disclosure, and five initial history rows with expansion to the existing limit of 20.
- Local preferences and sync status remain available during account-settings failure. Saved sound/starting-lesson preferences apply to fresh Practice. Guest copy accurately distinguishes device storage and optional sync.
- Shared flat authentication/reference surfaces, semantic error icons, 48px form controls, enlarged-text result reflow, wrapping mobile navigation labels, and a direct Lesson 1 link from About.

## Browser evidence

The built application ran on `127.0.0.1:5173`. A separate local Vite configuration on port 5174 supplied fake account/Forum responses, controlled failed practice writes, and optional doubled root text. The fixture configuration remained outside the repository and its server was stopped after testing. No real accounts, account changes, Forum posts, imports, or cache deletions were submitted.

| Path                 | Observed result                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Practice             | Selected lessons 10 and 18 directly; typed during playback; paused; changed lesson and cancelled; changed sound speed with keyboard input and cancelled; original copy/settings remained. Confirmed replacement cleared the copy and returned to Ready.                                                                                                                                            |
| Departure            | Back opened the unchecked-copy dialog and stopped playback. Cancel retained text and focus. Confirmed departure returned to Settings, and Forward still returned to Practice. Internal-link departure and modal Tab/Shift+Tab/Escape were also exercised.                                                                                                                                          |
| Results and storage  | Check produced a saved result. Closing/reopening review did not rescore. Another passage reset the copy; Finish returned Home. An injected first-write failure retried successfully into exactly one matching practice row; repeated failure allowed Keep result or explicit unsaved departure without adding another row.                                                                         |
| Guided regression    | A complete 15-prompt Lesson 1 passed through introductions, warm-up, scored recall, completion, Finish, and a completed history row. Earlier guided-packet evidence covers next-lesson/course-complete and guided failure variants; those algorithms were unchanged here.                                                                                                                          |
| Progress             | Three initial confusion rows expanded to six; five history rows expanded to 20. Unmeasured characters remained collapsed initially. Populated guest history and empty fixture-account history stayed distinct.                                                                                                                                                                                     |
| Settings/account     | Changed local character speed to 22 WPM and starting lesson to 18; fresh Practice used both. Restored 20 WPM/Lesson 1 afterwards. Invalid fixture login showed an inline error; successful fixture login showed Profile and account controls. A failed account-settings fetch retained theme/language, sync attention, and retry. Owner switching did not expose guest records as account history. |
| Supporting pages     | More remained usable on desktop. Forum fixture list/detail and empty replies loaded with More selected. Reference exposed all 40 characters and supported keyboard playback/navigation. Profile showed account identity and empty habit measurements. About's Lesson 1 action opened the introduction directly.                                                                                    |
| Responsive/localized | Settings, Practice, Progress, and More were checked in all five locales, both themes, at 320px and 1280px: 80 combinations without page overflow. German Practice was also checked at 390px, 768px, 799px, 800px, and a short 320px viewport. Representative screenshots were inspected separately from the DOM checks.                                                                            |
| Enlarged text        | A local fixture doubled root text to 32px at 320px width. Results initially overflowed; wrapping the score/header/actions fixed the panel to equal client/scroll widths. Retry and unsaved-departure actions remained reachable. Settings, Progress, and More also retained page-width reflow. Mobile labels now wrap rather than ellipsize. This is emulation, not native text-scaling evidence.  |

## Penpot synchronization

The existing file is `41725af0-a889-809a-8008-d8302a5aefb6`. The new page, **Daily training · UI implementation**, is `d872815a-6d19-807b-8008-d863a4c86b59`.

Sixteen representative editable screens plus a specification board were prepared before implementation. After browser acceptance, those screens were updated from measured visible text, surfaces, and Lucide icons in the implemented app. Six neutral browser-reference frames accompany the editable layouts. Activity, scores, and transcription examples use newly authored synthetic values; detailed activity captures remain local. Browser font metrics and native controls remain authoritative in the application. Existing guided-flow designs were retained. Named Penpot versions preserve the initial design and final synchronization. The [delivery manifest](2026-10-26-daily-training-design.json) records board IDs, the verified Penpot link, and source commit `017656a`.

## Command evidence

Commands ran from `frontend/` with Node 26 on `PATH` and the existing API environment. Final results are recorded after the combined implementation, including browser-discovered corrections.

| Check                    | Exit code | Result                                                                                                                                                                                                                                 |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused Vitest iteration | 0         | 57 tests across 5 files passed.                                                                                                                                                                                                        |
| `npm run verify`         | 0         | 583 tests across 48 files; 567 message keys in five locales; Svelte 0 errors/0 warnings; worker/script type checks and SEO 25-URL validation passed.                                                                                   |
| `npm run lint`           | 0         | Formatting and lint passed.                                                                                                                                                                                                            |
| `npm run build`          | 0         | Static production build passed.                                                                                                                                                                                                        |
| Svelte analyzer          | 0         | No reported issues across changed components. Existing DOM/audio lifecycle and `bind:this` advisory suggestions were reviewed; unrelated rewrites were avoided. Home, About, and ResultOverlay were rechecked after final corrections. |
| `git diff --check`       | 0         | No whitespace errors.                                                                                                                                                                                                                  |

Initial checks exposed a declaration-order error and unused translation keys; both were fixed before the successful gates. One final-check invocation omitted `PUBLIC_API_BASE` and failed at startup; rerunning with the required variable passed. Local server startup required sandbox escalation. A development hot-reload module-cache failure was resolved by restarting and testing the production build. These are not unresolved production failures.

## Limits and handoff

Native phone keyboard/IME, iOS first-tap audio, native text scaling, and actual screen-reader announcements remain unverified. Responsive desktop emulation and DOM/focus checks do not substitute for those tests. Mock account/sync/Forum responses establish frontend behavior, not real authenticated-service compatibility. The isolated tests did not exercise every backend error or the destructive account/import/cache actions.

The pre-existing guided work and approved plan were preserved in commit `0ce0eb6`. Implementation is committed as `017656a` on `codex/daily-training-ui`. This report and the design manifest are committed separately; `git status --short` was empty after the documentation commit (exit 0). No deployment or push was performed.

Automatic approval review rejected the final activity-bearing Penpot exports because they could disclose personal training metrics. The affected reference boards created during this task were removed from the active design page, and editable activity frames were replaced with labeled synthetic examples. Six neutral references remain. No approval is needed for the completed synthetic-data alternative.
