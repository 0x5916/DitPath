# Maintainability assessment — flashing implementation closeout

Date: 2026-11-04. Scope: the accumulated flashing/Home changes on `integration/opencw-learning-reliability`. This is an assessment, not an implementation. No cleanup was performed.

## Method and limits

- Reviewed the accumulated diff, the sync runtimes, evidence repositories, projection lifecycle, Home state/cache, and the Phase 3 queue in `OPENCW_OPENCODE_HANDOFF.md`.
- Reused the final-build browser evidence and the 901-test verification run. No new performance profiling, large-history benchmark, backend run, or device acceptance was performed.
- Findings are ranked by demonstrated or source-confirmed cost. Items whose cost is unmeasured are labeled as such; they are not presented as bugs.

## Fixed during closeout

**Recovery double-queue.** Recovery appends already notify the evidence repository. The explicit `recoverInterruptedEvidence(...).then(syncLearningNow)` added a second trigger. A runtime regression demonstrated three passes when recovery appended after the initial pass settled. Removing the explicit follow-up yields the initial pass plus exactly one notification-driven pass. The recovery API remains `Promise<void>`.

## Observed tradeoffs (not ranked cleanup)

- **Same-owner auth renewal resets learning sync state.** `initializeLearningSync()` fences on auth generation, so a token renewal with the same owner resets `initialized`, `synced`, and `pending`, then starts a new pass. This is conservative and prevents old-session writes, but it can show Loading during renewal. It was source-confirmed, not reproduced in a browser in this closeout. Do not relax it without a token-renewal fixture proving late work is fenced; verification should include same-owner renewal, account switch, and a late response from the old generation.
- **Forced refresh preserves prior coverage.** This is the deliberate tradeoff described in finding 3. It prevents a coverage-only action swap but can show a temporarily optimistic coverage label until settle.
- **Disposal coverage.** `learning-view` now has a late-result-after-stop regression; the sync runtime tests cover owner-change fencing and post-dispose inactivity. No concrete resource leak was demonstrated in this closeout.

## Ranked findings

### 1. Sync lifecycle and notification duplication

**Source anchors**

- `frontend/src/lib/learning-sync.svelte.ts`: owner/auth subscriber, abort controller, retry timer, focus/visibility wake, online reconnect, BroadcastChannel, `running`/`rerun`, status refresh.
- `frontend/src/lib/training-sync.svelte.ts`: the same lifecycle shape for the independent training pipeline.
- `frontend/src/lib/data/learning-evidence.ts`: `append()` notifies unconditionally, including duplicate-only appends; `reject()` now notifies for retryable and permanent rejections.
- `frontend/src/lib/learning-sync.svelte.ts::changed()`: every notification refreshes status and may start/queue a sync.

**Demonstrated cost**

- The recovery follow-up duplicated the repository notification and produced three passes; fixed in this closeout.
- Duplicate-only `append()` still emits a data change even when no record was written. Retryable `reject()` emits a change even though `rejectedIds()` only changes for permanent rejections. Both can trigger a status read, a projection refresh, and potentially a sync pass for no projection change. Cost is source-confirmed but not benchmarked.
- The two sync runtimes repeat owner/auth/abort/retry/wake code. This is the Phase 3 item 1 duplication; it has not caused a demonstrated failure beyond the recovery ordering issue.

**Smallest useful change**

1. Track whether `append()` inserted at least one new row and notify only then.
2. Notify `reject()` only when a permanent rejection changes `rejectedIds()`; the sync settle status publish still updates pending/error counts.
3. Only after those guards, consider extracting a narrow owner-scoped wake/fence helper. Do not merge training and evidence status models.

**Compatibility risks**

- Status-only UI may currently rely on a notification after an idempotent append or retryable rejection; verify Settings and session status behavior before changing.
- A shared helper could accidentally merge the two sync statuses, weaken abort/owner fencing, or change retry timing.

**Verification criteria**

- Duplicate append writes no new record and emits no change; recovery of a genuinely new record still triggers exactly one pass.
- Retryable rejection keeps status truthful without a projection change; permanent rejection still invalidates claims.
- Existing owner-change late-response, focus coalescing, retry, and no-op-sync tests remain green.
- Re-run the 1.5 s initial-sync trace and assert one evidence request when recovery finds nothing.

### 2. Page-local projection reads and subscriptions

**Source anchors**

- `frontend/src/lib/learning-view.svelte.ts`: each `createLearningView()` owns a snapshot, training/learning subscriptions, focus listener, and full evidence-plus-attempts read.
- Consumers: `frontend/src/routes/+page.svelte`, `frontend/src/routes/morse/learn/+page.svelte`, `frontend/src/routes/morse/progress/+page.svelte`, `frontend/src/routes/morse/learn/session/+page.svelte`.
- Home additionally loads the dashboard and learning-pilot history; Lessons retains a writable session repository.

**Demonstrated cost**

- Source-confirmed duplicate lifetime reads and subscriptions per mounted page. No large-history benchmark or mounted-subscriber count was captured in this closeout, so the runtime cost is unmeasured.
- The differences are real: Home needs dashboard/recommendation readiness, Lessons needs a writable session repository and same-owner preservation, Progress needs summary/history views, and the session route needs results/check data. A shared global cache would be unsafe.

**Smallest useful change**

- Extract a narrow read-only projection loader or owner-scoped lifecycle helper only after measuring the duplicated reads. Preserve page-specific writable repositories, owner/profile/time/coverage inputs, and settlement rules.
- Do not introduce a persistent cross-route learning-claim cache.

**Compatibility risks**

- Profile, coverage, time-dependent due states, rejected-ID filtering, and owner fencing must remain per call.
- Lessons refresh currently retains a writable repository; closing or sharing it can make visible actions inert.
- A shared cache could show stale claims across speed changes or account transitions.

**Verification criteria**

- Identical snapshots/recommendations for the same owner/profile/time/coverage before and after extraction.
- Large synthetic history fixture shows a measurable read/subscription reduction without changing ordering.
- Route tour covers Home, Lessons, Progress, and session results; owner switch and profile change remain correct.
- No increase in initial-sync or background-sync latency.

### 3. Forced-refresh coverage preservation and Home readiness state

**Source anchors**

- `frontend/src/lib/learning-view.svelte.ts`: `settled`, `initialPending`, `syncPending`, forced refresh, and previous-coverage projection.
- `frontend/src/lib/data/home-view-state.ts`: `coveragePending` and `snapshotSettled`.
- `frontend/src/routes/+page.svelte`: `lessonLink`, retained dashboard, recommendation readiness.

**Demonstrated cost**

- The previous-coverage rule is deliberate: it prevents a coverage-only swap during an upload acknowledgment. A pending correction/rejection can therefore be projected with the prior settled coverage until the sync settles. The action is fresh, but the coverage label can be temporarily optimistic.
- Home now carries several related booleans/derived states (`coveragePending`, `snapshotSettled`, `recommendationState`, `retainedDashboard`, `loadError`, `learning.failed`). This is manageable but easy to extend incorrectly.

**Smallest useful change**

- Keep the current behavior and add characterization tests for a real correction/rejection that changes the recommendation while sync is pending, plus a test that the settle refresh restores the true coverage.
- If further work is justified, compare a small recommendation/claim signature before deciding whether to replace the snapshot; do not reintroduce transient partial coverage as a display trigger.

**Compatibility risks**

- A more aggressive invalidation can reintroduce the Loading/recovery flash.
- A more permissive rule can hide real uncertainty or let a user act on a claim that a pending correction will remove.

**Verification criteria**

- Correction/rejection changes the recommendation immediately while sync is pending.
- Upload acknowledgment keeps the settled recommendation with no Loading/recovery frame.
- Settle refresh restores complete/partial coverage truthfully.
- Existing Home state/cache tests and the pending-coverage trace remain green.

### 4. Home presentation and cache derivation

**Source anchors**

- `frontend/src/routes/+page.svelte`: dashboard load, pilot review read, retained view, resolver inputs, `lessonLink`, recommendation/error/loading branches.
- `frontend/src/lib/data/home-view-state.ts`: view/recommendation state resolution.
- `frontend/src/lib/data/home-view-cache.ts`: owner-scoped, time-bounded dashboard-only retention.

**Demonstrated cost**

- Source-confirmed complexity: Home owns loading, dashboard, pilot history, cache retention, owner fencing, recommendation readiness, and lesson-link derivation in one route. No current defect was demonstrated.
- The cache is intentionally dashboard-only; this is correct for claim safety but means Home still performs the projection read on every mount.

**Smallest useful change**

- Extract `lessonLink` into a pure presentation helper with explicit inputs, leaving route loading/cache/owner logic in place.
- Do not cache recommendations, coverage, or landing decisions.

**Compatibility risks**

- Presentation copy, unfinished-session precedence, returning-review precedence, and course-complete fallbacks are behavior, not formatting.
- Moving cache ownership can leak dashboards across owners or retain stale activity.

**Verification criteria**

- Home state/cache unit tests unchanged.
- Browser fixtures cover new learner, returning learner, evidence-only dashboard, unfinished session, course complete, and guest landing.
- CTA text/href and loading/error states are byte-for-byte stable for the same fixture.

### 5. Settings and session route responsibilities

**Source anchors**

- `frontend/src/routes/settings/+page.svelte`: account forms, CW/page settings, two sync statuses, imports, verification.
- `frontend/src/routes/morse/learn/session/+page.svelte`: guided/check/coaching orchestration, audio activation, persistence, recovery, navigation.

**Demonstrated cost**

- Source-confirmed review cost; no flashing regression was attributed to these route sizes in this closeout.
- The handoff already identifies these as Phase 3 candidates, not proof of a bug.

**Smallest useful change**

- Extract one presentational section or a pure route-intent parser first. Preserve audio user activation, save guards, checkpoint IDs, capture leases, and navigation semantics.

**Compatibility risks**

- Audio activation is gesture-sensitive; moving controls can break playback.
- Save/end/checkpoint ordering and owner fencing are easy to disturb.

**Verification criteria**

- Focused component/route tests and the existing session/controller suites.
- Browser checks for check start, pause/resume, save, interrupted-session recovery, and results.
- Settings save/import/retry behavior remains unchanged.

### 6. Documentation drift

**Source anchors**

- `frontend/docs/learning.md` and `frontend/docs/ui-ux-audit.md` retain historical wording identified in the handoff.
- Dated reports are intentionally historical and should not be rewritten as current behavior.

**Demonstrated cost**

- Reported by the handoff, not independently re-audited in this closeout. Navigation and evidence-status descriptions can conflict with current routes/state.

**Smallest useful change**

- Correct the owning guides only; link to source types/validators instead of copying policy constants. Keep dated reports dated.

**Compatibility risks**

- Rewriting historical reports loses the audit trail.
- Documentation edits must not imply policy or API changes.

**Verification criteria**

- Cross-link and terminology review against current routes and `learning-view`/sync state names.
- No generated Paraglide files or bundled skill instructions edited.

### 7. Alleged dead state, stores, and legacy profile fields

**Source anchors**

- `owned_mastery`, legacy profile fields, and archived stores called out by the handoff.
- No production-caller trace was completed in this closeout.

**Demonstrated cost**

- Unmeasured. Search results alone are not proof of unused persistent state.

**Smallest useful change**

- Remove only non-persistent code with a documented production-caller search. Retain archived stores and compatibility fields absent an approved migration.

**Compatibility risks**

- IndexedDB data, backend wire compatibility, recovery paths, and migrations may depend on retained fields.

**Verification criteria**

- Caller search across frontend/backend, migration/recovery tests, and persistence compatibility review.
- No schema or storage-format change without explicit authorization.

## Recommended sequence

1. Sync notification guards (append only on new rows; reject only permanent) — smallest, highest-confidence reduction in redundant work.
2. Characterization tests for forced-refresh correction/rejection and coverage restoration — protects the new behavior before any projection extraction.
3. Measure and then reduce page-local projection reads/subscriptions, preserving page-specific differences.
4. Extract one pure Home presentation helper and one Settings/session presentational boundary, separately.
5. Documentation reconciliation and dead-state review last; both require broader consumer evidence.

No cleanup in this list has been implemented. The only closeout fix was the demonstrated recovery double-queue.
