# OpenCW — executable handoff to OpenCode

Prepared 3 November 2026 (Asia/Singapore). Repository inspected: `/Users/alan/Desktop/Morse`.

**Your first task is to reproduce and diagnose UI flashing before changing application behavior.** Inspect broadly, measure the current checkout, publish a cause/evidence map, then fix one demonstrated cause at a time. Do not begin with cleanup or workflow redesign.

This is an implementation plan, not a claim that the remaining work is complete. The supplied `OPENCW_CODEX_HANDOFF.md` was treated as historical context; its embedded prompts were not executed. This plan follows the user's current priorities: flashing → maintainability → independent Guided Lessons and Recall & Review → remaining UX/accessibility and regression acceptance. Preparation changed only this document; it did not run browser acceptance, modify application code, commit, push, merge, or deploy.

## 0. Continuation closeout — 2026-11-04

The authorized continuation packets are implemented on `codex/opencw-continuation`, based on `0e81a76`, and prepared for integration on `codex/opencw-integration`, based on `origin/main` `4d28650` (PR #3 merge). Nothing was pushed, merged, or deployed. The original `integration/opencw-learning-reliability` checkout and its audio/timing/controller edits remain untouched.

### Delivered behavior

- Evidence record revisions now project with current coverage. Corrections, rejections, downloads, and local record changes cannot be certified under stale complete coverage while sync is pending. Duplicate appends, empty imports, acknowledgements, and retryable rejections no longer claim a record revision.
- Home separates Guided Lessons from Recall & Review. Guided Lessons derives its action only from historical course guidance; Recall & Review owns checks, due reviews, proficiency/retention, screening, and coverage uncertainty.
- `/morse/review` is localized, prerendered, noindexed, offline-precached, and discoverable from desktop navigation, mobile More, Home, Lessons, and Progress.
- A policy new-lesson recommendation opens Guided Lessons instead of a step; mixed checks wait for two known characters. Recall evidence cannot manufacture a guided unlock.
- Lessons keeps the guided hero and requirements, uses no recall substitution, and no longer creates a duplicate learning projection.
- Training-history and learning-evidence sync use distinct wording. The old `Refresh learning history` action is now `Open learning evidence settings` with a recovery hint.
- Non-expanded sync attention is no longer a live region; client-side navigation and Back/Forward focus the main landmark.

### Commits

| Commit    | Scope                                                              |
| --------- | ------------------------------------------------------------------ |
| `b007cf7` | Carried-forward learning reliability and pending-coverage fixes    |
| `e743e1b` | Evidence record revisions project with current coverage            |
| `474feee` | Distinct Recall & Review surface and route                         |
| `e714051` | Purpose-specific Home, Lessons, Progress, and owning docs          |
| `6781aee` | Evidence sync scope, recovery wording, live-region and focus fixes |

Documentation commits follow the code series. `codex/opencw-integration` merges the candidate into PR #3's merged mainline without conflicts. The pre-existing audio/timing/controller edits are excluded from the series.

### Verification provenance

Independently repeated: `npm run verify` exit 0 (72 files, 903 tests), `npm run lint` exit 0, `npm run build` exit 0, messages validation (740 keys, five locales), `go test ./...` exit 0, `go vet ./...` exit 0, `git diff --check` clean. Disposable PostgreSQL suites: 14 packages/1,292 pass lines with 0 skips, and 8 race packages/961 pass lines with no data races. Real authenticated browser acceptance covered login, training upload/download, two-profile sync, account isolation, concurrent practice updates, offline save/reconnect, learning-evidence upload, permanent rejection visibility, Home recall CTA audio activation, saved-session reload, visible Chrome active-check pause/resume, and Safari navigation focus. Integration branch `codex/opencw-integration` was independently verified with `npm run verify`, `npm run lint`, and `npm run build`.

Not completed: Penpot requires login and the MCP plugin was unavailable after one transient page read; no board was inspected, versioned, or edited, so Recall & Review design review remains pending. Headless audio produced an incomplete check rather than a valid milestone, so a real correction/revalidation run is still blocked. Physical-device audio/IME/screen-reader/native-zoom checks and the prior desktop-switch, active-playback, guided-introduction and screen-recording rows remain open. A same-owner auth renewal was not repeated in a browser; runtime tests cover owner fencing and late responses. Full evidence: `frontend/docs/reports/2026-11-04-opencw-continuation.md`, `frontend/docs/reports/2026-11-04-opencw-acceptance.md`, and `.playwright-mcp/opencw-continuation/`.

Section 1's historical inventory is superseded by this closeout.

## 1. Verified starting state and evidence limits

| Item            | Observed state                                                                                                              | Consequence                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch and HEAD | `integration/opencw-learning-reliability`, `0e81a7685723fb9dd9fa67451ed894cbfd8810b5`                                       | This is PR #3's final head, not its merge commit.                                                                                                                |
| PR #3           | GitHub metadata confirms merged, merge SHA `4d286506fcf3184fb6c0ead4c82a8380d8879430`, 11 commits                           | Completed integration. Do not recreate, cherry-pick, re-merge, or redeploy it. The old PR body still contains pre-merge wording; metadata controls merge status. |
| Local refs      | Local `main` and `origin/main` both point to `215a7c5`; merge SHA is absent locally                                         | Local refs are stale. Fetch and compare safely in implementation setup; do not infer the current remote mainline from these refs.                                |
| Working tree    | 16 modified tracked files, 574 insertions/66 deletions, plus one untracked test                                             | The supplied handoff's “four modified files” is obsolete. Existing changes include candidate flashing fixes.                                                     |
| Stack           | Manifest specifies SvelteKit `^3.0.1`, Svelte `^5.57.2`, static adapter `^4.0.0`, TypeScript 6; Go module declares `1.27.3` | Preserve architecture; use the lockfile for installed versions. Node observed: `v26.13.0`.                                                                       |
| CI              | `.github/workflows/ci.yml` contains frontend, backend, disposable PostgreSQL, and race jobs                                 | Existing test infrastructure; do not rebuild it as new work. No fresh CI run was performed here.                                                                 |
| Production      | Deployment and backup are reported in the supplied handoff                                                                  | Not independently inspected. No production access or deployment is needed for this plan.                                                                         |

[PR #3](https://github.com/0x5916/Morse/pull/3) already includes historical unlock preservation, early-review scheduling corrections, attained-only return screening, permanent rejection/dependency handling, delivery/terminal integrity, lock-free recovery, History visibility, shared target improvements, localization/metadata fixes, disposable PostgreSQL tests, and CI. Preserve these as regression controls. A new failure needs a reproducible regression report, not another implementation of the completed feature.

### Preserve this exact existing work

| Existing group           | Files (relative to repository root)                                                                                                                                                                                            | Source-observed intent; not acceptance evidence                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio/timing             | `frontend/src/lib/audio/engine.ts`, `frontend/src/lib/audio/engine.test.ts`, `frontend/src/lib/training/timing.test.ts`, `frontend/src/lib/training/v2/session-controller.test.ts`                                             | Retain/reuse an AudioContext briefly after natural completion and extend audio/timing/controller tests. Separate from flashing.             |
| Repository notifications | `frontend/src/lib/data/learning-evidence.ts`, `frontend/src/lib/data/learning-evidence-import.test.ts`, `frontend/src/lib/data/training-sync-repository.ts`, `frontend/src/lib/data/training-sync-repository.test.ts`          | Suppress notifications for unchanged downloads/acknowledgements.                                                                            |
| Sync wakeups             | `frontend/src/lib/learning-sync.svelte.ts`, `frontend/src/lib/learning-sync-runtime.test.ts`, `frontend/src/lib/training-sync.svelte.ts`, `frontend/src/lib/training-sync-runtime.test.ts`                                     | Coalesce focus/visibility wakeups; avoid incrementing evidence revision solely for a successful sync pass.                                  |
| Projection and pages     | `frontend/src/lib/learning-view.svelte.ts`, `frontend/src/lib/learning-view.test.ts` **(untracked)**, `frontend/src/routes/+layout.svelte`, `frontend/src/routes/+page.svelte`, `frontend/src/routes/morse/learn/+page.svelte` | Batch projection refreshes, wait for settled coverage, coalesce navigation sync, favor signed-in dashboard, retain same-owner Lessons data. |

These edits are neither approved final fixes nor disposable experiments. Do not reset, stash, reformat, stage, commit, or overwrite them wholesale. Preserve untracked files too. Measure the current dirty checkout as its own baseline; do not call committed HEAD an equivalent reproduction environment.

### Preparation checks actually run

- `git status --short`, branch/log/diff inventory: exit 0. The explicit lookup of the reported merge object failed with exit 128 (`bad object`); GitHub metadata subsequently confirmed the merge remotely.
- From `frontend/`, with Node 26: `npm run test -- src/lib/learning-view.test.ts src/lib/learning-sync-runtime.test.ts src/lib/training-sync-runtime.test.ts src/lib/data/learning-evidence-import.test.ts src/lib/data/training-sync-repository.test.ts`: **exit 0; 5 files, 39 tests passed** against the dirty checkout.
- `npx --no-install @sveltejs/mcp svelte-autofixer ./src/routes/morse/learn/+page.svelte --svelte-version 5`: **exit 1**, blocked by `ENOTFOUND svelte.dev` during documentation fetch. No analyzer verdict obtained.
- Full verify/lint/build, backend tests, browser measurements, physical devices, and screen-reader testing were **not run for this planning-only change**. Historical 861-test and release assertion counts are not current results.

## 2. Architecture and source-grounded findings

Read [root instructions](AGENTS.md), [frontend instructions](frontend/AGENTS.md), [frontend setup](frontend/README.md), [learning architecture](frontend/docs/learning.md), [policy](frontend/docs/learning-policy.md), [design handoff](frontend/docs/design-handoff.md), and [backend setup](backend/README.md) before implementation. Source symbols below are navigation anchors; line numbers will move.

| Responsibility                 | Current source and finding                                                                                                                                                                                          | Planning implication                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static shell/navigation        | `frontend/src/routes/+layout.ts` prerenders; `+layout.svelte` starts both sync runtimes, calls training sync after navigation, and keys page children by `lang.value`                                               | Trace locale changes, owner initialization and route lifecycles. An intentional language remount is different from a same-language background flash. No runtime SvelteKit server.                                                |
| First paint/theme/offline      | `frontend/src/app.html` already applies stored theme before first paint; `src/lib/theme.ts`, `src/app.css`, `src/service-worker/index.ts`, `src/lib/offline-cache.ts` own related behavior                          | Do not prescribe “add a theme bootstrap” without evidence. Compare dev and built preview, worker state, hydration and actual paints.                                                                                             |
| Two sync pipelines             | `training-sync.svelte.ts`, `training-sync-engine.ts`, `data/training-sync-repository.ts`; separately `learning-sync.svelte.ts`, `learning-evidence/sync.ts`, `data/learning-evidence.ts`                            | Preserve independent training and evidence status, owner partitions, retries, transactions and outboxes. “Synced” in one pipeline does not certify the other.                                                                    |
| Projection lifecycle           | `createLearningView()` in `learning-view.svelte.ts` creates a **page-local** snapshot; each page starts subscriptions and a focus listener. `loadLearningSnapshot()` reads evidence plus lifetime training attempts | It shares projection logic, not a persistent cross-route cache. Current batching may reduce work within a mount; it does not prove warm navigation stability.                                                                    |
| Mounted page loading           | Home `loadHome()` and Progress `loadProgress()` retain same-owner data. The pending `loadLessons()` diff moves resets into the owner-change branch                                                                  | Verify initial loading, remounts and background refresh separately. Lessons still closes/reopens its repository during refresh; test visible Resume/Restart actions during that interval.                                        |
| Guided authority               | `training/v2/course-guidance.ts::deriveCourseGuidance`, `mastery.ts`, `progression.ts`, `sequence.ts`; `data/home-dashboard.ts`                                                                                     | Historical guided stability determines course unlocking/completion; recent performance is separate. Reuse these existing calculations.                                                                                           |
| Competing learner actions      | Home `lessonLink` chooses evidence recommendations once known characters ≥2; Lessons `currentLesson` substitutes `LearningOverview` for `LearnHero` under its current condition                                     | Workflow collision is confirmed in source. Separate the presentations; do not “fix” it by changing proficiency or unlock algorithms.                                                                                             |
| Two notions of course progress | `data/learning-snapshot.ts` derives `frontierStep`/`courseComplete` from prospective proficiency; `training/learning-policy/recommendation.ts` can propose `new-lesson`                                             | These are not guided unlock authority. Map every consumer before removal or routing changes.                                                                                                                                     |
| Session orchestration          | `routes/morse/learn/session/+page.svelte` (1,074 lines) handles guided, mixed-check, return/coaching, checkpoints, audio activation, persistence and navigation                                                     | Preserve shared mechanics. A full session rewrite is unnecessary for independent learner workflows. URL step parsing bounds to the curriculum; inspect historical unlock enforcement before claiming all entry paths obey locks. |
| Large settings surface         | `routes/settings/+page.svelte` (1,018 lines) includes account forms, settings, two sync statuses and imports                                                                                                        | Candidate for incremental separation by responsibility, not evidence of a bug merely because it is long.                                                                                                                         |
| Server authority               | `backend/internal/server/router.go` registers evidence endpoints under `/v1/training/learning-evidence/*`; implementations remain in `handlers/v2`; `internal/learning` validates/projects evidence                 | The old local 404 was not proof of missing current routes. Directory naming is not permission to rename APIs or remove compatibility aliases.                                                                                    |
| Documentation drift            | `learning.md` describes desktop More, but current layout primary navigation has Lessons/Practice/Progress/Forum; `ui-ux-audit.md` retains an old “dormant” policy note despite implemented prospective evidence     | Reconcile owning guides with code and dated reports. Do not alter policy code merely to match an old description.                                                                                                                |

**Still hypotheses:** root cause(s) of visible flashes; auth/locale churn; theme/compositor behavior; duplicate resumed attempts; stale pending counts; whether prospective recommendation links bypass historical locks in real sessions; allegedly unused stores/fields. Confirm each independently. `owned_mastery` and server `training_profiles` are compatibility/data concerns, not deletion targets based on search results alone.

## 3. Execution rules for every phase

- One discrete packet per session, normally under 400 changed lines, with explicit acceptance criteria. Split by demonstrated behavior or architectural responsibility; do not combine bug fixes, formatting, cleanup and product changes.
- Re-inventory Git first. Save a private binary diff, staged diff, untracked-file inventory/copies and file hashes before isolation. Never expose secrets in reports. Do not use `git add .`, force-push, destructive resets, automatic stashing, or broad cleanup.
- Prefer a suitable existing checkout/worktree. Because this checkout contains overlapping edits, use an isolated branch/worktree if necessary, leaving the original intact. Refresh remote refs without pulling into the dirty tree; compare PR head, merged tree and current mainline before selecting a base. Reuse/create worktrees through available tooling. No permanent `dev` branch is needed.
- Proposed branches: `codex/opencw-flashing-<cause>`, `codex/opencw-maintainability-<scope>`, `codex/opencw-workflows-<packet>`, `codex/opencw-ux-<issue>`. Organize new implementation and its regression test into reviewable local commits. Attribute any carried-forward existing hunks explicitly; do not commit another workstream's edits. Publishing, merging and deployment require separate authorization.
- Baseline comparisons may use a clean isolated PR head/merged checkout, but never obtain “before” by reverting the user's tree. If existing work suppresses reproduction, say so and compare isolated variants with hashes; do not claim a new fix caused an earlier improvement.
- Preserve SvelteKit 3/Svelte 5/static adapter and Go; no new dependencies without approval. Pure training calculations remain independent of UI/storage. Browser resources belong in lifecycle/orchestration layers; components receive state and emit intent.
- Freeze learning-policy semantics, immutable evidence/provenance, owner isolation, historical unlocks, audio validity, review intervals and compatibility contracts. Do not modify thresholds, scoring, screening eligibility, assessment ordering rules, or evidence certification to simplify UI. A policy discrepancy becomes a separate decision request with evidence.
- Backend schema, endpoints, authentication semantics and deployment configuration need an approved specification and explicit authorization. No production database work, deployment, volume deletion, or reuse of production credentials. Backend startup itself runs migrations: use verified disposable resources.
- Keep moving on independent authorized work when a device, policy decision or environment is unavailable. Mark dependent acceptance blocked; never silently waive it. No broad rewrite, global cache framework, framework migration or design-token mass migration.

## 4. Phase 1 — reproduce and diagnose flashing (P0, no behavioral fixes)

**Objective/scope:** Establish exactly what flashes, where, under which identity and trigger, and whether it is application state replacement or browser painting. Include every route in the investigation inventory; prioritize Home, Lessons, Progress and Settings, then Profile, Practice/reference, active sessions, auth and Forum for shared-shell symptoms.

**Architecture/dependencies:** Static shell, auth/session ownership, locale/theme, route lifecycles, both sync runtimes, IndexedDB notifications, page-local projections, service worker and CSS. Use browser instrumentation against a verified local origin and synthetic data. `npm run acceptance` offers isolated presentation fixtures and an always-503 mock API; it cannot demonstrate successful authenticated sync. Use a separate disposable current backend and synthetic accounts for that evidence.

**Tasks:**

1. Record branch/HEAD/diff hashes, Node/Go versions, actual frontend/API URLs, build mode, locale/theme/profile, browser/OS, service-worker controller and fixture version. Verify current local API route support without resetting any existing database or browser profile.
2. Capture the current dirty checkout before application edits. Start with browser-side probes; add temporary diagnostic hooks only in isolation if internal timing cannot otherwise be observed. Hooks must not change scheduling/policy and must be identified in evidence.
3. Use Playwright/browser MCP or equivalent DevTools instrumentation: timestamp navigation/focus/blur/visibility/pageshow/pagehide, route mount/unmount IDs, owner/auth generation, data revisions, sync start/settle/error, loader generations and completion. Alias owner IDs; omit credentials and payload bodies.
4. Record network counts/status/duration, IndexedDB open/read/write timings and change emissions, DOM removals/insertions, bounding boxes, loading/default/empty visibility and focused element. Use MutationObserver, PerformanceObserver and visible-frame sampling where supported. Inspect theme root attributes, computed surface colors, fonts and layout shifts; retain a trace/filmstrip/video.
5. Run the scenario matrix below. Include real tab/window activation; synthetic events only test handlers. For macOS desktop switching, record a manual switching sequence and screen recording when automation cannot reproduce the compositor lifecycle. Test idle and audio-active contexts separately.
6. Produce a cause map: symptom → trigger → event sequence → source owner → evidence artifact → competing explanation → smallest proposed fix. Label each cause **confirmed**, **suspected**, or **not reproduced**. Report performance costs separately from visible flashing.

**Measurement contract:** Define a flash as a captured rendered transition of a loaded semantic region into blank/default/initial skeleton, an unrelated replacement tree, or an unintended surface-color change before restoration. Measure count and visible duration per trigger, remount count, redundant fetch/projection count, layout displacement, and settle latency. DOM mutation alone does not prove a visible frame; screenshots alone do not explain the cause. Report unavailable metrics explicitly.

| Scenario                                                                  | Required observations and expected behavior                                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Warm Home → Lessons → Progress → Settings → Lessons; browser Back/Forward | At least 10 repeat cycles; distinguish necessary route entry from avoidable whole-page default/landing/lesson-1 intermediates.     |
| Cold load, new guest, returning guest, signed-in user                     | Honest loading/empty states; no invented prior activity; identify prerender-to-client transitions separately.                      |
| Tab/window return; real desktop switch; BFCache restore if available      | 10 return cycles per automated trigger; record manual cycles separately. No unexplained data teardown, duplicate audio or restart. |
| Unchanged sync, cursor-only download, rapid training/evidence events      | No loaded-region reset; count invalidations and passes. A status change need not be a data revision.                               |
| Genuine local/remote update, correction/rejection, failed/offline sync    | Real data/status changes remain visible; errors and evidence uncertainty are not suppressed.                                       |
| Delayed and out-of-order loads; unmount during load                       | Only current owner/request may publish; no late restore of stale content or resource leak.                                         |
| Logout, account A→B, same-account auth renewal, cross-tab changes         | Previous private content/actions become inaccessible immediately; no stale-owner frame or writes.                                  |
| Speed/profile, locale and theme changes; reduced motion                   | Claims retain correct profile; intentional locale/theme updates settle coherently; no unexplained remount on an unchanged locale.  |
| Save/resume/restart while refreshing; hidden active session               | Current IDs, drafts, audio interruption and persistence remain correct.                                                            |

**Risks/constraints:** Probes and CPU throttling can perturb timing. Keep ordinary-speed and diagnostic-throttled runs distinct. Raw traces can contain credentials; store privately under an existing ignored path (`.playwright-mcp/` is ignored here) or outside the checkout, and share sanitized summaries only. Do not clear the user's IndexedDB or unregister their worker.

**Acceptance/verification:** At least one repeatable evidence chain per proposed fix, with controls for unchanged data and genuine updates; broad route inventory completed; identical action/fixture script saved for before/after runs. Start in Chromium and repeat representative failures in Firefox and Safari/WebKit where available. A physical Safari result and a Playwright WebKit result are different evidence.

**Completion:** Publish a sanitized diagnosis with baseline metrics, source anchors, reproduction script, current-diff attribution, and proposed packets. No code fix starts until its diagnosis is recorded. If no symptom reproduces, report the tested matrix and missing conditions; do not invent a cause or refactor speculatively.

## 5. Phase 2 — eliminate demonstrated flashing (P0)

**Objective/scope:** Remove measured application-driven flashes using the smallest changes. Address each independent cause in a separate packet; preserve real loading, freshness, uncertainty and account transitions.

**Architecture/dependencies:** Phase 1 evidence and the existing uncommitted candidates. Likely boundaries are repository change notifications, sync wakeup coalescing, projection scheduling, page loading and shell initialization. These are investigation leads, not a mandatory patch list.

**Tasks:**

1. Classify each existing candidate as necessary/correct, insufficient, unrelated, or needing a regression test. Preserve the original tree; make only explicitly attributable follow-up changes in the implementation branch.
2. For demonstrated refresh resets, retain safe same-owner content through revalidation; distinguish initial loading from background work and show refresh failures without falsely certifying stale data. Clear sensitive state immediately on owner/auth loss.
3. For redundant work, coalesce identical wakeups and unchanged data revisions while preserving queued local writes, reconnect retries, corrections, acknowledgements and status counts. Do not suppress all notifications or disable synchronization.
4. Fence stale async results by owner/session generation and request identity; include profile/time/coverage invalidation where the projection depends on them. Do not retain claims across speed changes, rejection or lost coverage merely to preserve appearance.
5. Verify the pending projection's “wait until settled” behavior: genuine coverage/error changes must render truthfully, and simultaneous training notifications must not reintroduce partial/complete oscillation. Test rejected/blocked/status-only changes, not just version increments.
6. Add a small owner/profile-aware retained view only if warm-route measurements justify it; define invalidation, time-dependent due states, disposal and error behavior first. Do not turn this into shared-global-state architecture work.
7. Add regressions that fail on the measured cause. Keep DOM/browser assertions for visual stability and lifecycle tests for concurrency. Test action availability while the retained Lessons display is refreshing.

**Risks/constraints:** Smooth stale UI can conceal revoked claims or leak another account. Deduplication can lose genuine follow-up work. Closed repositories can leave visible buttons inert. Audio changes already in progress must remain a separate workstream.

**Acceptance:** In identical baseline/after scenarios, zero avoidable blank/default/initial-skeleton frames for already-loaded unchanged same-owner regions; no unintended owner/profile content; no redundant pass caused solely by paired focus/visibility events where coalescing is the proven fix. Genuine updates appear after the successful read without a second user action. Required errors, pending/rejected counts and partial coverage remain visible. Route/locale changes retain valid behavior and focus.

**Verification:** Repeat Phase 1 scripts/fixtures/browser versions and report before→after counts/durations, including regressions and cases not reproduced. Run focused sync/projection/repository tests plus frontend verify, lint, build and analyzer for changed Svelte files. Exercise built preview as well as dev. If the change touches actual backend behavior, stop for the required authorization and add relevant backend gates.

**Completion:** Every confirmed cause has a bounded fix and regression evidence, or a clearly documented remaining blocker; no temporary diagnostic code ships. Affected acceptance rows pass, changes are reviewable, unrelated edits excluded. Do not declare project-wide flashing resolved while a confirmed route or browser failure remains.

## 6. Phase 3 — verified maintainability improvements (P1)

**Objective/scope:** Reduce demonstrated duplication, ownership ambiguity and maintenance cost after visual behavior is stable. Inspect the full codebase, but implement only ranked, bounded findings. Behavior-neutral cleanup belongs in separate commits/branches from Phase 2.

**Closeout assessment (2026-11-04):** `frontend/docs/reports/2026-11-04-maintainability-assessment.md` ranks the concrete findings from the flashing closeout. It records demonstrated cost, smallest useful change, compatibility risks, and verification criteria. No cleanup from that assessment has been implemented.

**Architecture/dependencies:** UI → orchestration → pure training policy; repositories/transactions → sync engines → independent status; Go handlers → validators/projection/storage. Review tests, route inventory, static/locale build configuration and owning docs alongside runtime code. Phase 2 measurements provide the performance baseline.

**Tasks and initial source-backed queue:**

| Order | Finding and proposed packet                                                                       | Evidence needed before editing                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Home/Lessons/Progress repeat owner/revision subscriptions, request guards and DB read lifecycles  | Compare exact differences, including Lessons retaining a writable session repository. Extract a narrow lifecycle helper only if it preserves those differences and removes meaningful duplication.                             |
| 2     | Page-local projection plus page history readers repeat lifetime reads and evidence reconstruction | Measure large synthetic histories and mounted subscriber counts. Optimize proven hot paths without changing result ordering, rejection filtering or time-dependent readiness. No database migration for speculative speed.     |
| 3     | Settings and session route combine several responsibilities                                       | Map inputs, resource owners and side effects. Start with a presentational section or pure route-intent parser; preserve audio user activation, save guards, checkpoint IDs and leases. Avoid simultaneous controller redesign. |
| 4     | Documentation mixes implemented, dated and future behavior                                        | Correct navigation and evidence-status descriptions in owning guides; keep historical reports dated. Link to types/validators instead of copying policy constants.                                                             |
| 5     | Alleged dead state/stores and legacy profile fields                                               | Trace production callers, wire consumers, migrations and recovery behavior. Remove only proven unused non-persistent code. Retain archived stores/compatibility fields absent an approved migration.                           |

**Risks/constraints:** Line count alone does not justify extraction. A shared abstraction must not merge the two learning models or sync statuses. Resume double-count, fresh-order validation, screening recency and profile-scope findings need separate reproduction/semantic classification, not cleanup patches. Backend contracts and persistence formats remain frozen.

**Acceptance:** Each implemented finding states the current cost, proposed boundary and observable benefit; identical fixtures produce identical domain outputs, records, routes and status semantics. No increase in flashing or redundant work. Removed code has a documented consumer search and compatibility rationale. Deferred items carry evidence and priority, not speculative “cleanup” labels.

**Verification:** Characterization tests around the extracted boundary; use existing lifecycle, checkpoint, projection, navigation and policy fixtures. Run frontend gates for frontend changes; Go test/vet and applicable disposable database/race suites for authorized backend changes. Compare Phase 2 stable scenarios and measured hot paths after each packet.

**Completion:** Ranked findings report delivered; each selected packet independently passes its gates and has a reviewable commit. Remaining items explicitly deferred with reasons. Do not require clearing the entire backlog before workflow separation; only proven prerequisites block it.

## 7. Phase 4 — independent Guided Lessons and Recall & Review (P1)

**Objective/scope:** Give learners two understandable journeys without changing either learning model. Guided Lessons owns course progress and the next guided action. Recall & Review owns checks, proficiency/retention, due/cold readiness, screening and coaching. Shared exposure and persistence remain shared where required.

**Architecture/dependencies:** `deriveCourseGuidance`, `loadHomeDashboard`, Home `lessonLink`, Lessons `currentLesson`, `LearningOverview`, `learningRecommendationHref`, `recommendation.ts`, `returnScreeningTargets`, session route/controller, checkpoints, navigation, `src/lib/routes.js`, SEO/locales and offline route policy. Read current Penpot authority in `design-handoff.md`; the historical file ID is `41725af0-a889-809a-8008-d8302a5aefb6`, and live structure must be checked before use.

**Tasks, split into separately verifiable packets:**

1. **Contract and design:** Write the workflow/terminology/state table before code. Proposed default: retain `/morse/learn` for Guided Lessons and add a distinct Recall & Review entry/surface; select its canonical path in the specification. Home exposes both tasks, with guided resume/next lesson governed by guided history. Follow the repository's Penpot-first workflow for new design changes: inspect current boards, save a named version and save the changed design before implementation. Use Penpot MCP; do not infer current boards from old screenshots.
2. **Authority and actions:** Introduce a small presentation/action mapping over existing domain outputs. Home, Lessons, CoursePath and guided Results agree on course step/completion. Recall recommendations cannot substitute the guided CTA or manufacture an unlocked course step. Preserve optional cross-links and explain due versus cold-ready without rescheduling anything.
3. **Guided surface:** Keep checkpoints, resume versus restart, current/locked/revisit lessons, remaining mastery requirements and persistent course completion visible. Show requirements for the lesson/characters actually being evaluated; do not hide them merely because some characters are known.
4. **Recall surface:** Present known-character checks, attained-only return screening, due reviews and coaching with their actual eligibility and purpose. Guided-only history must not imply prospective proficiency. A learner with no eligible screening targets gets a useful guided/familiarization destination, not a dead-end screening CTA.
5. **Session entry and compatibility:** Keep the existing session controller and evidence capture unless a proven boundary demands extraction. Preserve legacy `step`, `check`, `review`, `targets`, `resume` links and checkpoints. Audit direct URLs, result links and saved entries against existing guided lock policy. If enforcement changes access semantics beyond the documented lock contract, obtain a specific decision before that change; do not adjust mastery thresholds to make access succeed.
6. **Navigation/Progress:** Make both journeys discoverable on desktop/mobile and give Progress explicit guided versus recall vocabulary. Scope character claims to the active speed/profile; distinguish historical achievement, present criterion and review schedule. Preserve URL-backed views, filters, scrolling, history and local pilot records. Update new route inventory, localized prerender entries, SEO and offline caching if a route is added.
7. **Localization/docs:** Update all five message catalogs and owning architecture/design guides. Use meaningful labels and restrained contextual help; preserve instant check entry, pause, save/recovery and accessible audio controls.

**Semantic boundary:** Presentation separation is authorized direction, not permission to change `recommendNext` policy, remove its new-lesson eligibility logic, reinterpret guided stability as proficiency, change “fresh order,” redefine screening recency, or make recall mandatory for course progress. Adapt which surface consumes an existing recommendation; keep policy calculation unchanged. If product decisions require any such semantic change, submit a concrete separate proposal and continue independent presentation work.

**Risks/constraints:** Moving entry UI can lose the initiating audio gesture, duplicate playback, invalidate saved URLs or blur save/end semantics. Adding routes must work in the static five-locale build and offline shell. If Penpot access is unavailable, finish the state/route contract and report the design dependency; do not claim design alignment from code alone.

**Acceptance:** A beginner can identify “learn new characters” versus “check and retain what I know”; a guided-only learner sees the correct next lesson independently of recall evidence; recall-only attainment never unlocks guided lessons; due review/inactivity never relocks earned lessons; all-39-lessons completion persists. Eligible review targets and cold-readiness explanations are truthful. Both journeys remain functional with empty/partial/offline data. Entry, direct links, save/resume and completion preserve existing evidence and audio semantics.

**Verification:** Fixture matrix: new learner; incomplete guided session; guided stability without recall attainment; recall attainment without guided stability; due-but-not-cold; old achievement/current difficulty; changed speed; full course; partial/rejected history; saved sessions of each kind. Test every entry route and result CTA, with course-guidance/policy parity fixtures unchanged. Compare design and browser at matched widths, all locales/themes, and run full frontend gates.

**Completion:** Both end-to-end journeys are independently discoverable and executable; each acceptance fixture agrees across Home, destination, session, Results and Progress; no policy/schema changes are hidden in UI commits. Design and source handoff match. Unresolved semantic proposals remain separate and are not reported as implemented.

## 8. Phase 5 — remaining UX and accessibility (P1/P2)

**Objective/scope:** Fix verified remaining problems in separate packets, preserving PR #3 improvements and the stabilized workflows. Reproduce each historic report against the current revision before scheduling implementation.

**Architecture/dependencies:** Sync notices/Settings, learning overview and recommendation copy, Progress/history, shared controls/dialogs, responsive tokens, translation catalogs, session input/audio and recovery. Use `ui-ux-audit.md`, `design-handoff.md` and `android-acceptance.md` as acceptance inventories, not proof of current failures.

**Tasks:**

- Verify the reported “Refresh learning history” action. If it navigates to Settings, name the destination accurately; if it promises a refresh, wire the existing action and expose progress/failure. Do not hide evidence uncertainty.
- Explain training-history versus learning-evidence sync and local save separately. Verify pending/rejected/blocked counts against repositories through failure/retry. Make the evidence section discoverable from Settings navigation; offer useful localized recovery, not raw internal error codes as the only explanation.
- Verify hidden unlock requirements, misleading lesson references, terminal-course state and screening dead ends; phase-4 fixes already proven complete are regression controls rather than duplicate tickets.
- Audit keyboard focus after navigation, asynchronous refresh, dialogs, completion and retry; status announcements must not repeat on every unchanged sync or speak over assessed sound. Ensure no visual or accessible target leakage during recognition.
- Check 320/390/768/960/1440 widths, navigation boundaries 959/960/1199, short landscape, EN/DE/JA/zh-Hans/zh-Hant, both themes, reduced motion and native 200% zoom. Verify primary targets ≥44×44 CSS px (prefer 48), spacing, contrast, reflow, safe areas and software-keyboard access.
- Complete actual spoken screen-reader journeys and physical-device keyboard/IME/audio checks. Distinguish emulator, browser DOM assertions and audible device observations in results. Keep simulator-only limitations open.

**Risks/constraints:** Copy simplification must retain essential guidance and uncertainty; no semantics change disguised as terminology. Do not repeat the completed History/target/metadata fixes unless a current regression is demonstrated. Avoid new design-system/token migration.

**Acceptance:** Each confirmed issue has reproducible before/after behavior; every control and recovery path is keyboard/touch reachable; no traps, clipped essential content, undiscoverable error recovery or misleading saving/sync/attainment labels. Screen-reader announcements and sound interaction are observed, not inferred from ARIA alone.

**Verification:** Focused browser scenarios and relevant existing component/controller tests; message validation/checking for all copy; full frontend gates. Record device/browser/assistive-technology versions, action steps and results. If physical hardware or an evaluator is unavailable, mark those rows blocked and report the exact manual procedure.

**Completion:** Selected issue packets pass; remaining findings have severity/owner/blocker. Accessibility acceptance is not declared comprehensive while required device or spoken-AT rows are unverified.

## 9. Phase 6 — integrated regression and final delivery

**Objective/scope:** Demonstrate that the completed packets coexist without flashing, policy drift, owner leaks or recovery regressions. This is local/CI readiness, not deployment authorization.

**Architecture/dependencies:** Combined reviewed branch, deterministic synthetic fixtures, current static build, disposable backend for real sync, unchanged policy vectors and existing PR #3 regression suites.

**Tasks:** Re-run the Phase 1 action script on the final integrated revision; then complete guided introduction → answers → results → next/repeat/finish, recall entry → check → results/review, practice → save, interrupted → resume, and save failure → retry. Exercise two isolated browser profiles syncing the same synthetic account, different-account isolation, guest import, offline/reconnect, concurrent updates, rejected dependencies, late corrections and no-Web-Locks recovery. Confirm Forum/auth/settings navigation still works. Ensure retries do not duplicate attempts, terminals, milestones or due-cycle advancement.

**Risks/constraints:** Mock API success, fake IndexedDB and controller tests cannot replace browser persistence or real authenticated sync. An unset PostgreSQL test DSN causes skips; it is not database acceptance. Never use development/production data for destructive fixtures.

**Verification commands:** Run frontend commands from `frontend/` with `export PATH="/opt/homebrew/opt/node/bin:$PATH"`. Use existing installed locked dependencies; `npm ci` is for a fresh isolated checkout or dependency repair, not a ritual that replaces a working environment. Use the documented local `PUBLIC_API_BASE`, never a production API for write tests.

```sh
npm run verify
npm run lint
npm run build
```

`verify` already includes Vitest, messages, SEO, Svelte/TypeScript, worker and script checks. Use `npm run test -- <paths>` for targeted iterations. Run the installed Svelte analyzer on changed components; report suggestions and blockers, not just its exit code. Use existing browser tooling without silently adding an external dependency.

For authorized backend changes and the final real-sync regression gate, use Go from `backend/go.mod`. From `backend/`: `go test -count=1 ./...` and `go vet ./...`. From the repository root, when Docker/disposable test resources are available: `backend/scripts/test-postgres.sh --verbose` and `backend/scripts/test-postgres.sh --race --verbose`. These scripts create isolated resources; do not substitute a live DSN. Keep PostgreSQL/race runs sequential. Do not run deploy/update/restore commands as verification.

**Acceptance:** Required frontend gates pass; actual backend/database/race evidence is captured for the integrated sync acceptance; all applicable browser, workflow, policy, isolation and accessibility matrix rows pass or are explicitly blocked with a reason. New CI failures are resolved or attributed with a reproducible baseline. No published success claim relies on historical counts.

**Completion:** Deliver a coherent, reviewable sequence of local branches/commits, sanitized diagnosis and before/after evidence, updated owning docs, verification matrix and remaining decision list. If any required acceptance remains blocked, label the release candidate incomplete rather than “fully verified.” Do not push, merge, access production, or deploy without separate authorization.

## 10. Reporting contract and first OpenCode response

At each packet's start report the objective, files/boundary, acceptance criteria and baseline identity. At completion report:

1. Findings: observed/source-confirmed/hypothesis, with source symbols and reproduction evidence.
2. Changes: exact files, why needed, commit/base IDs, existing edits carried forward and excluded work.
3. Results: command, working directory, exit code, test-file/test/assertion counts, skips, and logs; browser scenario pass/fail/blocked plus before/after measurements.
4. Safety/invariants: policy and owner/persistence behavior checked; exact remaining risks or blockers; no claim of audible playback from a visual indicator.
5. `git status --short`, proof that original uncommitted files remain intact, and the next bounded packet.

Keep raw traces private and summarize them in dated reports under `frontend/docs/reports/`; maintain current architecture, UX backlog and design requirements in their existing owning guides. Do not duplicate the entire policy or rewrite historical reports.

**First response to the user:** confirm the current branch/HEAD and preserved-work inventory, identify the safe local reproduction setup, and begin instrumented flashing reproduction. Report the baseline cause/evidence map before proposing the first behavioral change. Do not begin by implementing a cache, extracting components, splitting routes, or repeating PR #3.
