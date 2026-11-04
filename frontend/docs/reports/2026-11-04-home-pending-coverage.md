# Home pending-coverage CTA stability — 2026-11-04

Bounded fix for the Home recommendation CTA. No learning-policy, backend, schema, endpoint, authentication, or deployment changes. All work remains uncommitted.

## Source identity

- Branch: `integration/opencw-learning-reliability`
- HEAD: `0e81a7685723fb9dd9fa67451ed894cbfd8810b5`
- Tracked diff: 17 files, 852 insertions, 92 deletions
- Tracked diff SHA-256: `7f839215c692240fdeee75bc8daf86e22e7c1832b1585ff895327c1b60e7e768`
- Pre-existing audio/timing/controller edits were preserved unchanged.

## Root cause

`learningEvidenceCoverage()` reports `partial` until the first evidence sync settles. Home projected that partial snapshot immediately, so `recommendNext()` returned `load-history` and rendered the actionable “Refresh learning history” CTA while the first read was still pending.

A second source was the learning-view focus wake: a focus event can schedule a refresh before the learning-sync listener publishes `syncing: true`, replacing a settled projection with a transient partial one. That reproduced the same swap during unchanged background sync.

## Fix

- `frontend/src/lib/learning-sync.svelte.ts`: added owner-scoped `initialized`, set only after the initial sync loop drains, including queued reruns. It resets on owner change and also settles after offline, unavailable, or failed first passes.
- `frontend/src/lib/learning-view.svelte.ts`: added a `settled` projection signal. A transient partial read no longer replaces a settled projection; the sync-settle notification refreshes it. Focus wakes wait for the sync pass to settle, and `initialized` participates in the coverage key.
- `frontend/src/lib/data/home-view-state.ts`: `resolveHomeView()` now takes `coveragePending` and `snapshotSettled`; the recommendation stays `loading` until both are settled.
- `frontend/src/routes/+page.svelte`: derives `coveragePending` from the owner-scoped sync state and passes `learning.settled`.
- Tests: `home-view-state.test.ts`, `learning-view.test.ts`, and `learning-sync-runtime.test.ts` cover pending initialization, settled partial coverage, real failures, transient partial reads, focus during sync, and owner-change reset.

Real errors remain visible: the recovery CTA appears only after the failed read settles, and persists with its settings link.

## Before and after

### Initial load with 1.5 s delayed evidence sync

Before:

```
t=0 ms:    Loading…, 1 skeleton
t=52 ms:   Refresh learning history (actionable)
t=1537 ms: Check your current recall
```

After:

```
t=0 ms:    Loading…, 1 skeleton
t=51 ms:   Loading… (non-actionable)
t=1538 ms: Check your current recall
```

No recovery frame appears. The follow-up trace below removes the redundant rerun that previously made this 3.1 s.

### Unchanged background sync (focus)

Before:

```
t=0 ms:    Check your current recall
t=52 ms:   Refresh learning history (actionable)
t=1530 ms: Check your current recall
```

After: `Check your current recall` remained stable for the full 2.6 s sample.

### Settled evidence failure (404)

Before and after both keep the recovery CTA actionable, but after it appears only when the failed read settles:

```
t=0 ms:    Check your current recall
t=1535 ms: Refresh learning history → /en/settings#learning-evidence
```

A cold-start 404 shows `Loading…` until `t=1532 ms`, then the recovery CTA persists.

## Acceptance matrix

| Scenario                                        | Result                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Pending first coverage never exposes recovery   | Passed: 0 recovery frames; loading stays non-actionable.                                         |
| No CTA swap while first read pending            | Passed: Loading → recall only.                                                                   |
| Successful sync resolves correct recommendation | Passed: `Check your current recall` with the expected check URL.                                 |
| Real 404/unavailable coverage                   | Passed: recovery CTA appears after settle and persists.                                          |
| Settled partial coverage (offline)              | Passed: actionable recovery CTA, then recall after reconnect.                                    |
| Account switching                               | Passed: account B saw only its own empty progress; no account A activity or pending recovery.    |
| Profile change                                  | Passed: recommendation re-projected at 25 character WPM.                                         |
| Guest landing                                   | Passed: public landing with no recommendation CTA.                                               |
| No learning-claim caching                       | Passed: Home still retains only the dashboard; the learning projection is revalidated per owner. |
| Owner/profile isolation                         | Passed in unit tests and the browser account/profile checks.                                     |

## Follow-up targeted investigations

### Initial sync invocation trace

The 1.5 s-delay fixture previously made two sequential `learning-evidence/changes` requests:

```text
request 1: start 69 ms,  duration 1504 ms
request 2: start 1583 ms, duration 1503 ms
readiness: 3070 ms
```

The second pass was an unconditional `recoverInterruptedEvidence(...).finally(() => syncLearningNow())` rerun. Recovery found no orphan candidates, so the follow-up pass was redundant. The explicit follow-up is removed; recovery appends notify the evidence repository, which starts or queues exactly one upload pass. A later audit also caught the count-based replacement double-queuing when recovery appended after the initial pass had settled; that regression is covered by the runtime test.

After the fix:

```text
request 1: start 50 ms, duration 1503 ms
readiness: 1538 ms
```

Recovery that does append evidence queues exactly one pass through its repository notification. The regression covers no-op recovery and an append that lands after the initial pass settles.

### Projection invalidation and display stability

- Data revision changes now force an immediate re-projection. A correction, rejection, attempt, or profile change cannot leave stale claims/actions visible until the sync settles.
- A forced refresh during a pending pass re-projects against the previously settled coverage. This updates changed claims without letting transient partial coverage alone swap the action to “Refresh learning history.”
- `repository.reject()` now notifies projection consumers; corrections already notified through `applyPage()`.
- A real local append plus upload acknowledgment during a 1.5 s delayed sync kept `Check your current recall` stable for the full 2.6 s sample. No Loading or recovery flash.
- Profile change from 20 to 25 character WPM updated Home without a reload and re-projected Lessons and Progress; no stale 20 WPM text remained.

Regressions:

- `learning-view.test.ts`: forced data-revision refresh during sync replaces a stale claim, preserves settled coverage for the forced read, then uses current partial coverage at settle.
- `learning-evidence/sync.test.ts`: rejection emits a non-local `learning-evidence` data change.
- Existing projection correction and owner-isolation tests remain green.

### Recovery warning during retry

After a settled 404, the recovery CTA stayed visible throughout the next delayed retry:

```text
retry t=0 ms:    Refresh learning history → /en/settings#learning-evidence
retry t=1559 ms: Check your current recall
```

No Loading frame appeared while the retry was pending.

### Repeated queued work

Three local evidence changes queued during an 800 ms initial pass coalesced into one rerun:

```text
evidence requests: 2 (initial + one coalesced rerun)
ready at: 1644 ms
```

The runtime regression also queues three local changes during a held pass, drains them, and asserts `initialized` becomes true with exactly two passes.

## Gates

| Check              | Result                              |
| ------------------ | ----------------------------------- |
| `npm run verify`   | exit 0 — 70 files, 901 tests passed |
| `npm run lint`     | exit 0                              |
| `npm run build`    | exit 0                              |
| `git diff --check` | exit 0                              |

Browser evidence was captured on a fresh preview of the final build.

## Artifacts

- `pending-coverage-trace.js` and `pending-coverage-before.json`
- `pending-coverage-after.json`
- `pending-coverage-acceptance.js` and `pending-coverage-acceptance.json`
- `pending-coverage-cold-failure.js` and `pending-coverage-cold-failure.json`
- `initial-sync-trace.js`
- `profile-change-consumers.js`
- `queued-work-drain.js`
- `upload-ack-stability.js`

All under `.playwright-mcp/flashing-verification/`.

## Remaining device verification gaps

These were not part of this packet and remain open from the lifecycle report:

- Chrome macOS desktop switch: no new lifecycle events observed.
- Safari desktop return-to-original-space visibility: not confirmed.
- Active desktop switch during guided/check playback: not executed.
- Active app-focus change during check playback: blocked by a native dialog/renderer hang.
- Guided introduction playback: not exercised; active check playback passed.
- Screen recording: blocked by macOS capture permission; timestamped screenshots remain the fallback.
- Language/URL timing: unchanged; no user-visible defect reproduced.
