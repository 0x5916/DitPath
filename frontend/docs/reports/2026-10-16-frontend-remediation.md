# Frontend remediation report 16 October 2026

The confirmed frontend defects covered by this review have been fixed. Final verification passed **424 tests across 36 files**, zero Svelte errors or warnings, clean lint, and a static production build. Browser verification recorded **53 passing assertions** covering account races, storage failures, navigation, lesson completion, audio replacement, keyboard behavior, and translated Progress screens.

This remediation stayed in the frontend. Existing backend, framework, configuration, and documentation changes in the shared working tree were preserved. It added no dependencies and changed no deployment configuration, database schema, or API contract.

## Fixes and resulting behavior

### Account requests and synchronization

[Authentication](../../src/lib/auth.ts) identifies each committed session with a generation. Account changes invalidate earlier requests, including responses still parsing JSON. Refresh preserves the current session, overlapping logins honor the latest attempt, and logout clears the local identity before awaiting server revocation. [API request sharing](../../src/lib/api.ts) is scoped to the session; caller and session cancellation both reach the request.

[Profile](../../src/routes/profile/+page.svelte) and [Settings](../../src/routes/settings/+page.svelte) fence loads, saves, errors, and loading indicators by session and component lifetime. Saved baselines use submitted values, preserving edits made while a save is pending. Private fields and password inputs reset when the account changes. Settings also reloads when the stored identity becomes a hydrated user; browser testing caught and corrected a case where the header showed an account while the form remained in guest state.

Credential storage rolls back partial token writes. A quota failure produces a localized error and releases the login button. If rollback itself fails, residual credentials cannot silently reactivate a mixed session.

The legacy progress queue (removed; see the [current learning architecture](../learning.md)) assigned stable local IDs, enqueued before uploading, and acknowledged against the latest stored queue. Separate Web Locks serialize queue mutations and uploading across tabs. Enqueueing remains possible during a pending network request. Settings reconciliation and upload loops stop applying work after a session change.

### Durable guided sessions

[IndexedDB transactions](../../src/lib/data/training-db.ts) resolve after the transaction completes. A successful request followed by an abort is a failed save. Callback errors retain their identity, rollback settles before return, and a late connection from a rejected blocked open is closed.

[The guided controller](../../src/lib/training/v2/session-controller.svelte.ts) serializes writes with captured values and retains failed work for retry. Retry uses the same answer/session identities. The session starts only after its initial record commits.

[The session route](../../src/routes/morse/learn/session/+page.svelte) exposes initialization failure, saving, saved, and failed states. Finish, Repeat, Next, and internal navigation wait for pending writes. Failure keeps **Retry saving** and an explicit **Leave without saving** choice available. [Navigation recovery](../../src/routes/morse/learn/session/navigation.ts) preserves the original Back/Forward operation after retry. Connections close after owned persistence work settles; audio stops immediately during cleanup.

Local data deletion waits through a blocked native request. Settings explains that other tabs must close, prevents duplicate confirmation, reports errors visibly, and announces success only after completion. Its localized description accurately limits deletion to guided attempts and session history.

### Practice and audio

- [Playback orchestration](../../src/lib/practice/playback.ts) stops and resets transport synchronously when text/settings change. Old completion callbacks cannot unlock a replacement passage. Playback, pause, and resume failures leave a usable transport with a localized error.
- Player settings bind back to practice state. Finite values are normalized, effective speed stays within character speed, and committed settings agree with the passage and scoring snapshot.
- [Practice shortcuts](../../src/lib/practice/keyboard.ts) implement Space while respecting native controls, text entry, held keys, composition, and modifiers. Textarea spaces and Shift Enter remain editable.
- Changing a familiarization character stops its old audio. Inspection adds no scored guided attempt. Browser testing also caught and corrected a drill effect that read its player before initialization.
- [Passage generation](../../src/lib/training/exercise.ts) rejects malformed targets, rates, lessons, and group sizes, checks finite progress, and skips groups that cannot fit. Valid timing/scoring formulas remain unchanged.
- [Copy review](../../src/lib/practice/copy-attempt.ts) limits input to twice the passage length. The textarea, binding, and pure review boundary enforce the limit, bounding quadratic scoring work by the current passage size.

### Progress and course guidance

[Progress summaries](../../src/lib/training/v2/progress-summary.ts) use actual completed-session duration and explicit unmeasured values. The [session repository](../../src/lib/data/session-repository.ts) queries the required range through the existing index rather than limiting results to 50 sessions. Progress distinguishes empty history from storage failure, offers retry, closes storage on all lifecycle paths, and ignores stale results after unmount.

Confusions remain directional and use valid single-character evidence. Mastery cells are labeled evidence displays; diagnostics offer an honest practice link. [Learn guidance](../../src/lib/training/v2/course-guidance.ts) distinguishes lifetime newcomers from returning learners without recent answers. Completion requires stable evidence for every curriculum character, and bounds come from the curriculum rather than a hard-coded lesson 40.

### Presentation and localization

Session, practice, result, progress, and accessible-label copy is supplied in all five catalogs. Validation checks **563 referenced keys** with matching locale keys and placeholders. Result differences carry text/symbols as well as color; free-practice results state their course-mastery limit. The result dialog contains reverse Tab from initial panel focus, suppresses background shortcuts, closes with Escape, and restores focus.

Duplicate Practice/Progress wrappers and repeated homepage desktop spacing were removed. Input sizing, progress bounds, native disclosure activation, and reduced-motion handling were tightened. More uses the shared 800px desktop boundary and listens for viewport changes. Dates follow the selected locale. Chinese regions choose the appropriate supported script, including Simplified Chinese for `zh-CN` and `zh-SG`.

### Earlier security fixes retained

The [offline cache policy](../../src/lib/offline-cache.ts) allows eligible same-origin static/page requests, bypasses authenticated/API requests, and removes older DitPath caches without deleting unrelated caches. The [forum reply reducer](../../src/lib/forum-replies.ts) replaces recursive rendering with bounded iterative traversal and bounded display depth. Both remain covered by the final test suite. Concurrent server cursor pagination changes already present in the forum were preserved.

## Modularity

Playback, copy-attempt state, keyboard intent, course guidance, and progress summaries now have focused TypeScript helpers. A shared session scope centralizes lifetime/account checks, and dialog focus behavior has a shared helper. Routes retain browser-resource ownership; presentation components receive state and callbacks. The reactive guided controller remains the documented Svelte orchestration exception. Domain calculations stay separate from DOM, storage, and audio resources.

## Verification

Commands ran from `frontend/` with Node **26.10.0** on `PATH`.

| Check                        | Exit | Result                                                                                                                               |
| ---------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run verify`             | 0    | 563 keys / 5 locales; 25 sitemap URLs; zero Svelte errors/warnings; worker/script TypeScript checks; **424 tests / 36 files passed** |
| `npm run lint`               | 0    | Prettier and ESLint passed                                                                                                           |
| `npm run build`              | 0    | Static production site and service worker built                                                                                      |
| Mock API browser build       | 0    | Static build for isolated loopback verification                                                                                      |
| Production fixture isolation | 0    | **163 JS/HTML/JSON files** checked; no mock API address or injected test hooks                                                       |
| Browser assertions           | pass | **53 passed**, no unresolved failures in valid setups                                                                                |
| Documentation validation     | 0    | 107 local links/anchors checked across the guides and report; formatting passed                                                      |
| `git diff --check`           | 0    | No whitespace errors                                                                                                                 |
| `git status --short`         | 0    | Full shared-tree status captured                                                                                                     |

Focused tests passed for session isolation, cross-tab locking, commit completion, progress, guided persistence/navigation, playback, shortcuts, dialog focus, generator boundaries, and Chinese locale matching. The final suite includes existing and concurrently added tests; its total is not a count of newly written tests.

The Svelte autofixer was attempted on affected components and exited **1** because startup documentation fetching failed with `ENOTFOUND svelte.dev`. Local compilation, checking, ESLint, tests, and builds passed independently. Builds emitted the existing `NO_COLOR`/`FORCE_COLOR` environment warning and exited successfully.

[Verify log](assets/2026-10-16/verify.log) · [Lint log](assets/2026-10-16/lint.log) · [Production build log](assets/2026-10-16/build.log) · [Working-tree status](assets/2026-10-16/git-status.txt)

## Browser evidence

Tests used disposable synthetic Alice/Bob/guest identities and a loopback mock API. IndexedDB, Web Audio, and Web Locks were native implementations. Temporary fault hooks were injected by the test server before bootstrap; production source and output contain none of them.

Complete paths verified:

1. Held Alice responses followed by a Bob switch; stale responses did not replace Bob's data or loading state.
2. Partial credential-write quota failure, rollback, a usable error, and successful login retry.
3. Two tabs competing for one held upload, a second item appended during it, exactly two successful uploads, and an empty acknowledged queue.
4. Blocked deletion, waiting status, release of the blocking connection, and success after completion.
5. Guided initialization retry; late abort; duplicate-free retry; exit/discard; internal Back recovery with Forward preserved.
6. A complete 15-prompt lesson with a failed final save. Next waited for retry; lesson two then opened at prompt one. The completed lesson had exactly 13 answer records and committed completion status.
7. Actual progress duration, storage-error retry, empty history, newcomer guidance, and noninteractive mastery evidence.
8. Practice Space, textarea guards, active playback replacement, bounded copy input, result focus, and drill replacement.
9. All five Progress language preferences without horizontal overflow at the measured desktop width, plus light/dark screenshots.

[Assertions and setup corrections](assets/2026-10-16/browser-checks.json) distinguish valid checks from corrected setup mistakes. Hard document history was replaced by in-app navigation, native number-input changes were used for commit checks, and deterministic randomness was corrected to preserve distinct prompt IDs.

[Unsaved recovery](assets/2026-10-16/guided-unsaved-recovery.png) · [Next lesson initialized](assets/2026-10-16/next-lesson-initialized.png) · [Blocked deletion](assets/2026-10-16/blocked-deletion.png) · [Practice result](assets/2026-10-16/practice-result.png) · [Progress light](assets/2026-10-16/progress-light.png) · [Progress dark](assets/2026-10-16/progress-dark.png)

## Remaining limits and future work

- **Narrow and real-device acceptance remains open.** Viewport override requests were ignored; measured width stayed at 1280px. The exact 799/800px transition, 320/390px wrapping, mobile text scaling, native IME, screen readers, and first-tap iOS audio need a controllable viewport/device. The source breakpoint and resize listener are implemented.
- **Legacy delivery remains at least once.** Web Locks prevent competing uploads in supporting browsers. Without them, cross-tab queue races remain possible. A server success followed by a lost HTTP response can still be retried because V1 has no client idempotency identifier. Eliminating that case needs an approved backend/API change.
- **Uncommitted writes cannot survive every hard exit.** Unsaved reload/tab close triggers a browser warning. Choosing to leave, a crash, or an operating-system kill can still lose work held only in memory. Retry and explicit discard work while the page stays open.
- **Exact saved-session resume and guided server sync remain separate features.** Restart retains committed evidence and starts a fresh plan. An outbox repository and SyncStatus component do not establish a wired guided-sync integration. This review did not persist resumable prompt plans or add an API.
- Product/design and device acceptance remain in the [UI backlog](../ui-ux-audit.md), including analytics design, broader navigation design, PWA/Lighthouse acceptance, and real-device accessibility.

The working tree remains uncommitted for review. Its broad pre-existing changes mean the complete diff contains work outside this remediation; review the focused frontend groups above rather than attributing the entire tree to this report.
