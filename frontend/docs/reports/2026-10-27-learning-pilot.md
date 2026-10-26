# OpenCW learning pilot implementation

Implemented on `dev` from `1e8e4d4`, 27 October 2026. The user authorized multiple implementation phases and explicitly approved the additive learning-evidence API RFC during this run. No commit, push, merge, rebase, deployment or external dependency change was made. The original `main` checkout and its pre-existing deletions were untouched.

## Delivered phases

| Phase                | Implemented behavior                                                                                                                                                                                                           | Boundary                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 acceptance        | Existing Practice save failure/retry saves exactly once; focused session keyboard, exit-cancel focus, local persistence and responsive review checks; reproduced setup gutters and contradictory history empty state corrected | Native hardware, assistive-technology and genuine second-profile service checks remain open                                                            |
| P1 policy foundation | Frozen `learning-policy-1.0`; admissibility, proficiency, retention, current evidence, review ladder, readiness, recommendation and confusion projections                                                                      | Pure prospective-evidence modules; runtime awards remain disabled until capture and parity gates pass                                                  |
| P1 targeted review   | Progress pair action opens a validated setup, then 12 unscored typed prompts with immediate feedback; result distinguishes correct without replay, correct after replay and incorrect; bounded repetition                      | Separate owner-scoped local records, no old lesson advancement or fabricated practice upload                                                           |
| P1 return experience | After at least 14 days without recorded activity, Home can offer eight prompts from recorded characters; unfinished guided work retains priority; completed local reviews suppress repeated absence invitations                | Interim invitation uses historical activity, not a new claim of proficiency; users retain lesson browsing and free practice                            |
| P1 data/API          | Approved separate ledger, authenticated batch and signed revision feed, additive tables, canonical immutable retries, dependency/chronology validation and exposure open/close records                                         | Coaching/screening ledger is implemented; mixed-check returns `FEATURE_NOT_ENABLED`; frontend transport and server milestone projection are not active |

The existing session route accepts `?review=KR` and `?review=return`; invalid or unrecorded character requests produce an explained recovery path. Setup creates no record. Prompt order is regenerated for a new round, first responses remain immutable, retry preserves IDs, owner switches never retarget pending writes, and old history/outbox counts are unchanged. Partial local responses remain visible as **Unfinished**. Exact continuation after reload is still a separate P2 feature.

Home, Progress, Settings and the session screens distinguish local review storage from the existing account sync. Local review notifications refresh the view without invalidating cloud status or creating old-contract uploads. All new copy is present in English, German, Japanese, Simplified Chinese and Traditional Chinese.

## Design evidence

Refined the existing Penpot proposal before affected UI changes. Final handoff: **Implementation handoff · local review trust and unfinished history · 27 Oct 2026**, revision 163. Original board IDs preserved; 13 boards and 25 navigation links. File, containment and 48 px target audits reported zero errors. Warm-neutral/Forest tokens and shared controls remain unchanged.

[Penpot proposal](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=70d88234-9fff-8034-8008-d95463eb50ba).

## Verification

Node 26.12.1 and Go 1.27.3 were used. Frontend commands set `PUBLIC_API_BASE=http://localhost:8080/v1`; backend database tests used only the temporary loopback PostgreSQL 18 container, with process `TZ=UTC`.

| Gate                                                           | Result                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run verify`                                               | Exit 0; 680 tests in 52 files; Svelte 0 errors/0 warnings; locale, SEO, script and worker checks pass |
| `npm run lint`                                                 | Exit 0; Prettier and ESLint pass                                                                      |
| `npm run build`                                                | Exit 0; static output generated                                                                       |
| Installed Svelte autofixer                                     | 10 changed Svelte files, each exit 0; no issues or suggestions                                        |
| `TZ=UTC OPENCW_TEST_DATABASE_DSN=... go test -json -p 1 ./...` | Exit 0; 1,257 test/subtest passes across 13 passing packages; 0 test skips; one package has no tests  |
| `go vet ./...`                                                 | Exit 0                                                                                                |
| Safari 27.0.1 / macOS                                          | Three completed synthetic rounds: 28 answers; 8/8 final workflow checks; 24/24 setup layouts          |
| Penpot                                                         | Revision 163; 13 boards/25 links; no validation/containment/target-size errors                        |
| `git diff --check`                                             | Exit 0                                                                                                |

The 680 frontend tests include 62 policy cases plus controller, repository, owner, notification and fixture regressions. PostgreSQL coverage includes immutable retries, dependency ordering, account isolation, rollback, concurrent identical/conflicting uploads, fixed pagination ceilings, late-occurrence commits and checkpoint refresh. The temporary database was stopped and removed after testing; no existing database or deployment was used.

Safari exercised the 12-prompt coaching result (10 correct without replay, 1 after replay, 1 incorrect), an 8-prompt return result, and an 8-prompt terminal-save failure/retry. Retry saved exactly one terminal record and 8 unique answers under the same ID. The existing fixture's 24 attempts/2 sessions and old outbox stayed unchanged. Exit cancellation restored focus to the enabled answer field. Invalid review targets, setup navigation without record creation, unfinished history, retained local history with empty legacy cache, loading and Settings 503 recovery were checked.

Layout coverage is five locales × two themes × actual 336/390 px, plus 768/1280 px in both themes. Safari clamps requested 320 px to 336 px; exact 320 px is not claimed. Theme-attribute checks do not establish preference persistence. Browser playback states do not establish audible quality or empirical learning gains. Repetition limits were source-reviewed and are not a separate browser pass.

Changes remain uncommitted in the existing dev worktree. Final `git status --short` and per-file source hashes are captured in the task's `implementation-evidence.json`, together with command logs and screenshots. No main or other branch was edited.

Initial non-passing commands are retained in the evidence: missing `PUBLIC_API_BASE` prevented the first Vitest startup; providing the documented local value resolved it. One integration type check caught a derived-value declaration order error, which was corrected. The Svelte analyzer initially could not resolve `svelte.dev`; inspection established that it fetched public documentation while analyzing code locally, and the network-enabled rerun passed for all changed Svelte files. A domain test fixture accidentally represented a valid retention check; the fixture was corrected to represent incomplete rehearsal.

The initial PostgreSQL baseline under `Asia/Singapore` had 1222 test/subtest passes and 3 failures: `TestCombinedSettingsPostgresAssociations`, `TestForumThreadPostgresLiveCountAndSoftDeletion`, and `TestTrainingBatchDuplicatesPreserveAcknowledgementsAndActivity`. Each compared `+08:00` and `Z` representations of the same instant. They also failed with the DSN's `TimeZone=UTC`; the final broad suite runs with process `TZ=UTC`, matching the previous container baseline. No unrelated API timestamp behavior was changed. These host-timezone-sensitive assertions remain a test-portability follow-up.

## Remaining roadmap

1. Complete P0 native Practice keyboard/IME, TalkBack or VoiceOver journey, rotation/native text scaling, Firefox physical-keyboard focus reproduction, and genuine second-profile/device synchronization. `adb devices -l` found no attached device. Responsive Safari does not establish native acceptance.
2. Capture prospective plan, first-response, audio-validity and exposure-open/close metadata on every relevant playback path. Preserve owner boundaries and unknown timing; do not enrich immutable legacy records with invented context. Add client ledger transport with retry, terminal dependencies and checkpoint reconciliation.
3. Add mixed-check generation and delayed feedback. Prove frontend/backend policy parity, complete exposure coverage, offline clock conservatism, concurrent due-cycle handling and late-data corrections before activating proficiency/retention milestones or replacing existing recommendations across Lessons, Home, Results and Progress.
4. Validate the pilot with learners and delayed tests before tuning thresholds or adding a fitted retention model. Then continue P2 exact same-device continuation and contextual words/callsigns/contact practice.

The accepted [policy guide](../learning-policy.md) owns learning semantics; the approved [API specification](../../../backend/docs/learning-evidence-v1-rfc.md) owns the additive contract. Runtime architecture remains in [learning.md](../learning.md).
