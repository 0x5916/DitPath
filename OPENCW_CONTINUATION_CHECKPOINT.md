# OpenCW continuation checkpoint — 2026-11-04

Implementation is complete for the authorized continuation packets; acceptance is partially complete. Nothing was pushed, merged, deployed, or run against production. Learning-policy semantics and backend contracts are unchanged.

## Git identity

- Working branch: `codex/opencw-continuation`
- Base: `0e81a7685723fb9dd9fa67451ed894cbfd8810b5` (`integration/opencw-learning-reliability`)
- Integration branch: `codex/opencw-integration`, based on `origin/main` `4d286506fcf3184fb6c0ead4c82a8380d8879430`, merged cleanly with the candidate
- Final code commit before docs: `6781aee25cb0bdce350fb97657205f11f4c55ed8`
- Final documentation commits follow `6781aee`; see `git log -1` for the current HEAD
- Original dirty checkout: `/Users/alan/Desktop/Morse` (preserved; audio/timing/controller edits untouched)
- Isolated worktree: `/Users/alan/.codex/worktrees/opencw-continuation/Morse`
- Baseline patch and untracked copies: `.playwright-mcp/opencw-baseline-2026-11-04/`
- Build/source identity: `.playwright-mcp/opencw-continuation/source-identity.txt`

## Commit series

| Commit    | Scope                                                              |
| --------- | ------------------------------------------------------------------ |
| `b007cf7` | Carried-forward learning reliability and pending-coverage fixes    |
| `e743e1b` | Evidence record revisions project with current coverage            |
| `474feee` | Distinct Recall & Review surface and route                         |
| `e714051` | Purpose-specific Home, Lessons, Progress, and owning docs          |
| `6781aee` | Evidence sync scope, recovery wording, live-region and focus fixes |
| docs      | Dated report, checkpoint and handoff update                        |

Audio/timing/controller files from the other workstream are excluded from every commit. The original branch remains at `0e81a76` with its dirty tree intact.

## Implemented behavior

- Forced refreshes distinguish evidence record revisions from outbox/status changes. Corrections, rejections, and new records project with current coverage; duplicate appends, acknowledgements, empty imports, and retryable rejections no longer claim a data revision.
- Home exposes Guided Lessons and Recall & Review as separate journeys. Guided Lessons uses historical course guidance only. Recall & Review owns checks, due reviews, proficiency/retention, screening, and coverage uncertainty.
- `/morse/review` is localized, prerendered, noindexed, offline-precached, linked from desktop navigation, mobile More, Home, Lessons, and Progress.
- A prospective `new-lesson` recommendation opens Guided Lessons instead of a specific step; mixed checks wait for two known characters rather than linking to a dead end.
- Lessons no longer substitutes recall recommendations for the guided hero or hides requirements; its duplicate learning projection was removed.
- Evidence sync wording is distinct from training history. The old `Refresh learning history` action is now `Open learning evidence settings` with a recovery hint.
- Non-expanded sync attention is no longer a live region. Client-side navigation and Back/Forward focus the main landmark.

## Verification

- `npm run verify`: exit 0; 72 test files, 903 tests passed.
- `npm run lint`: exit 0.
- `npm run build`: exit 0.
- `npm run messages:validate`: exit 0; 740 keys, 5 locales.
- `go test ./...`: exit 0; `go vet ./...`: exit 0.
- Disposable PostgreSQL suites: `backend/scripts/test-postgres.sh --verbose` exit 0, 14 packages ok, 1,292 pass lines, 0 skips/failures; `--race --verbose` exit 0, 8 packages ok, 961 pass lines, 0 skips/failures, no data races.
- Real authenticated browser acceptance against a disposable backend: successful login, training upload/download, two-profile sync, account isolation, concurrent practice updates, offline save/reconnect, learning-evidence upload, permanent rejection visibility, Home recall CTA audio activation, saved-session reload, visible Chrome active-check pause/resume, and Safari navigation focus.
- Same-owner token renewal: access token rotated with unchanged username/JWT subject; pending practice stayed pending through renewal, then uploaded once; loaded history and the saved check checkpoint survived.
- Guided introduction playback in visible Chrome: K and M each started audio, changed to Continue after completion, and advanced to the warm-up prompt.
- Real milestone correction: four valid mixed checks produced four server milestones; a late exposure guard deferred correction until closure, then emitted one `unverified / late-evidence-invalidated` correction. Browser showed K proficiency recorded, K retention not established, `Earlier claim needs verification`, while M retention remained.
- Built preview (`4175`) browser checks: route tour, Back/Forward focus, 320/390/768/960/1199/1440 widths, five locales, dark theme, offline recall shell, Lighthouse accessibility 100.
- Synthetic acceptance (`4174`) checks: guided-only Home/Recall, new-learner empty state, partial coverage recovery, evidence-vs-training status wording, Settings/More evidence discovery, and Practice save failure → retry → saved.
- Integration candidate: `npm run verify` 72 files/903 tests, `npm run lint`, and `npm run build` all exit 0 after a formatting-only report fix.
- Intermediate commits: `npm run check` exit 0 at every code commit; focused suites passed at `b007cf7` and `e743e1b`.
- Full details: `frontend/docs/reports/2026-11-04-opencw-continuation.md` and `frontend/docs/reports/2026-11-04-opencw-acceptance.md`.

## Remaining blockers and deferred work

- Penpot requires login and the MCP plugin was unavailable after one transient page read. No board was inspected, versioned, or edited; the Recall & Review visual design remains an explicit pending design-review dependency.
- Physical-device audio, IME, spoken screen-reader, native 200% zoom, safe areas, and software-keyboard checks remain unverified.
- Chrome macOS desktop switching, Safari return-to-original-space visibility, active desktop/app-focus changes during playback, and screen recording remain open from the prior lifecycle packet.
- Large-history projection optimization was measured (~160 ms for 4,800 synthetic records) and deferred because a trial optimization showed no meaningful gain.
- Manual checklist: `frontend/docs/reports/2026-11-04-manual-acceptance-checklist.md`.

## Next task

Authenticate Penpot and review/version the Recall & Review boards, then complete the remaining physical-device, assistive-technology and lifecycle rows. Do not claim the release candidate fully verified until those rows have evidence.
