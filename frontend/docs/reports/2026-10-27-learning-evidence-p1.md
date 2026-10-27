# P1 learning evidence integration — 27 October 2026

Finalized 28 October 2026. This packet implements the accepted policy-1.0 assessment path on `dev`. It follows the [approved additive API](../../../backend/docs/learning-evidence-v1-rfc.md) and the existing Penpot learning-evidence designs. It does not establish completion of all P0 native acceptance or all P1 rollout gates. No push, merge or deployment was performed.

## Baseline and implementation boundaries

The prior pilot was reviewed against its recorded per-file hashes, verified, and committed as `1a751be` (`Add local learning pilot and approved evidence ledger`). Its 56 files matched the reviewed state. The separate Desktop checkout's unrelated work was preserved. All subsequent implementation uses the existing dev worktree.

The packet adds prospective capture, a separate account outbox/feed checkpoint, canonical exposure reconstruction, mixed-check runtime integration, server milestone/correction projection, and shared learning recommendations. Historical training events and old pilot records are retained without invented evidence. Guest evidence remains owner-isolated; transferring it into an account is a remaining explicit-import workflow.

## Delivered behavior

- Every supported Morse playback path persists an exposure guard before sound. Successful closure commits before an answer becomes ready. Pauses, replacement, asynchronous audio/storage failure, ownership changes and uncertain clocks preserve the first presentation's validity honestly. Dead local documents can be recovered under Web Locks without closing another live document or remote device.
- New coaching, return screening and mixed checks use truthful prospective purposes. Frozen observations and exact terminal manifests retry with the same IDs. An interrupted first delivery cannot be repaired into a qualifying trial by replay; the block stays incomplete. Existing genuine lessons/practice keep their old contracts.
- Mixed checks use open recall, ten planned opportunities per target and familiar anchors. Answers advance immediately; correctness feedback waits until completion. Replay and skips remain in the valid-opportunity denominator. Latency does not gate the new criteria.
- Frontend and backend implement the same versioned assessment, proficiency, retention and review policy. Shared fixtures cover 13 evidence/review scenarios. Server claims include their witnesses and revision; retries/concurrent uploads award once. Late warm exposure can invalidate retention explicitly, and earlier qualifying history can supersede a later attainment without deleting either record. Projection failure rolls back input, claim and revision together.
- Home, Lessons, mixed Results and Progress read one scoped snapshot and recommendation. Progress distinguishes historical milestones, current recall and review readiness, with earlier lesson estimates in a labelled disclosure. Complete/signed-in, incomplete/offline and device-only coverage are distinct. Settings keeps prospective learning synchronization separate from legacy history synchronization.

## Design source of truth

The existing Penpot file is organized into eight labelled pages: implemented snapshots, current/upcoming learning evidence, reusable UI, historical explorations, and a source-of-truth index. The organization manifest records preservation of all 162 original boards, 9,218 original shapes and 407 interaction-bearing shapes, with no missing original shapes or altered prototype destinations. Existing page and board IDs were preserved. Seven focused boards were added for the index, reusable patterns and P1 handoff rather than duplicating whole interfaces.

The saved organization version is `Organized source of truth · P1 mixed checks and shared decisions · 27 Oct 2026` (revision 172). Its source index links the owning architecture, policy, RFC and acceptance reports. Firefox Computer Use verified the saved structure. A later edit of the existing status annotation to say that P1 integration is in acceptance was attempted, but its save could not be confirmed; treat that annotation as pending. The saved revision 172 remains the verified design reference. The Penpot MCP connection was unavailable on the resumed run; no replacement file or duplicate design tree was created. The original mixed-check setup/recall/result boards and the three P1 handoff boards remain the design targets while outstanding acceptance is recorded below.

## Verification

Command exit codes, counts, source hashes and bounded browser results are retained with the task's `p1-implementation-evidence.json`. Use [frontend gates](../../README.md) and the source tests rather than treating prototype screens as evidence of implemented behavior.

| Check                | Final result                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`     | Exit 0; 749 tests in 60 files; Svelte 0 errors/0 warnings; 629 message keys across five locales                                                                           |
| `npm run lint`       | Exit 0; formatting and ESLint                                                                                                                                             |
| `npm run build`      | Exit 0; static adapter build                                                                                                                                              |
| Svelte analyzer      | Exit 0 on all 18 changed components/modules; no issues; existing advisory suggestions retained. Final Home adjustment separately rechecked, with no issues or suggestions |
| `go test ./...`      | Exit 0; 1,275 test/subtest passes across 13 packages; zero skipped/failed tests                                                                                           |
| Learning race checks | Exit 0; 34 test/subtest passes across two packages                                                                                                                        |
| `go vet ./...`       | Exit 0                                                                                                                                                                    |
| `git diff --check`   | Exit 0                                                                                                                                                                    |

Safari exercised two 20-prompt UI rounds. The first completed with replay and skip recorded in the denominator (K 9/10, M 9/10); one check did not award proficiency. The second suffered a paused/failed first delivery and finished as incomplete (K 10/10, M 8/8 eligible); it did not award a milestone. Starting another check from Results then produced a fresh session ID and prompt 1 while retaining the incomplete terminal. Native Space replay, delayed feedback, save/exit and audio-error recovery were exercised. Existing fixture history remained 24 owned attempts and two sessions, with no legacy outbox additions from these checks.

These answers were scripted from synthetic plans and establish UI/data behavior, not human recognition or audible-quality validation. Further automated rounds were abandoned after Safari visibility changes interrupted playback. A genuine uninterrupted second qualifying browser round remains open; pure policy and backend tests cover the corresponding qualification rules.

A separate render-only fixture contained 124 prospective records for two fully correct K/M checks, with no legacy history seeded. It verified provisional proficiency, no retention claim, due dates and the same Lesson 2 recommendation on Home, Lessons and Progress. It also reproduced the Home empty-legacy-history visibility bug before the fix. Progress was checked at 390 CSS px in all five languages and both themes: no horizontal overflow, no raw translation keys, and 48px-high new learning actions. English desktop rendering at 1280px and German narrow dark rendering were visually inspected. Synthetic timestamps and outcomes are layout evidence only.

The full frontend gates cover messages, SEO, Svelte/worker/scripts checks, Vitest, lint and static build. Backend checks use the named disposable PostgreSQL container only, with `TZ=UTC`, including the earlier migration test, all normal tests, Go vet and race-enabled learning-evidence/concurrency tests. No existing application database was used.

Initial non-passing checks are retained honestly: missing `PUBLIC_API_BASE` blocked the first frontend test startup; the documented local value fixed it. The first database run used an empty disposable database; its migration acceptance test initialized it before the successful suites. Type/lint iteration found a nullable captured database and unused imports. Message validation caught an unused legacy heading key; its existing key was retained with the clarified label. Safari found old mastery copy in the first mixed prompt, duplicate saved-state text, and a same-URL recommendation that did not start another check. These were corrected. Final integration review also caught screening plans whose legacy target list was empty: the prospective adapter now records the actual sampled characters with target roles, covered by coaching/screening wire-shape regressions. An interruption during asynchronous audio preparation now retains its first guard/closure dependencies. Running compilation against an active dev preview caused a Vite hot-reload timeout; final compilation and browser walkthroughs use separate preview lifetimes.

## Remaining roadmap

1. **P0 acceptance:** physical-device Practice keyboard/IME, VoiceOver or TalkBack, rotation/native text scaling, the Firefox physical-keyboard focus reproduction, and genuine second-profile/device synchronization. Responsive Safari and synthetic request ports do not close these gates.
2. **P1 rollout acceptance:** run the complete client-to-service roundtrip in two genuine browser profiles, including offline reconciliation and late exposure. PostgreSQL API tests and client protocol tests establish the respective contracts, not this complete real-service journey. Exercise large histories and device clock/suspension behavior before broad release.
3. **P1 follow-through:** explicit prospective guest-evidence transfer with a durable cross-account import journal; richer purpose-aware historical review/check browsing; measured long-history projection performance. Preserve the accepted policy and immutable source records.
4. **Pilot validation:** conduct actual delayed learner checks before changing thresholds or fitting a retention model. Passing software tests does not establish learning gains.
5. **P2 after P1 acceptance:** exact same-device continuation and the contextual words/callsigns/contact-practice roadmap. These were not started.
