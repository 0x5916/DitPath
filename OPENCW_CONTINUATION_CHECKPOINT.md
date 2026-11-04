# OpenCW continuation checkpoint — 2026-11-04

Local implementation and verification are complete for the authorized continuation packets. Nothing was pushed, merged, deployed, or run against production. Learning-policy semantics and backend contracts are unchanged.

## Git identity

- Working branch: `codex/opencw-continuation`
- Base: `0e81a7685723fb9dd9fa67451ed894cbfd8810b5` (`integration/opencw-learning-reliability`)
- Final code commit before docs: `6781aee25cb0bdce350fb97657205f11f4c55ed8`
- Original dirty checkout: `/Users/alan/Desktop/Morse` (preserved; audio/timing/controller edits untouched)
- Isolated worktree: `/Users/alan/.codex/worktrees/opencw-continuation/Morse`
- Baseline patch and untracked copies: `.playwright-mcp/opencw-baseline-2026-11-04/`
- Build/source identity: `.playwright-mcp/opencw-continuation/source-identity.txt`

## Commit series

| Commit    | Scope                                                                  |
| --------- | ---------------------------------------------------------------------- |
| `b007cf7` | Carried-forward learning reliability and pending-coverage fixes        |
| `e743e1b` | Evidence record revisions project with current coverage                |
| `474feee` | Distinct Recall & Review surface and route                             |
| `e714051` | Purpose-specific Home, Lessons, Progress, and owning docs              |
| `6781aee` | Evidence sync scope, recovery wording, live-region and focus fixes     |
| docs      | Dated report, checkpoint and handoff update                            |

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
- Built preview (`4175`) browser checks: route tour, Back/Forward focus, 320/390/768/960/1199/1440 widths, five locales, dark theme, offline recall shell, Lighthouse accessibility 100.
- Synthetic acceptance (`4174`) checks: guided-only Home/Recall, new-learner empty state, partial coverage recovery, evidence-vs-training status wording, Settings/More evidence discovery.
- Full details: `frontend/docs/reports/2026-11-04-opencw-continuation.md`.

## Remaining blockers and deferred work

- Penpot MCP was not connected. No board was inspected, versioned, or edited; the Recall & Review visual design is an explicit pending design-review dependency.
- Real authenticated backend sync, two-profile success paths, concurrent successful sync, and disposable PostgreSQL/race suites were not run. The acceptance API is an always-503 mock.
- Physical-device audio, IME, spoken screen-reader, native 200% zoom, safe areas, and software-keyboard checks remain unverified.
- Chrome macOS desktop switching, Safari return-to-original-space visibility, active desktop/app-focus changes during playback, guided introduction playback, and screen recording remain open from the prior lifecycle packet.
- Large-history projection optimization was measured (~160 ms for 4,800 synthetic records) and deferred because a trial optimization showed no meaningful gain.
- Same-owner authentication renewal was not repeated in a browser; runtime tests cover owner fencing and late responses.

## Next task

Connect Penpot and review/version the Recall & Review boards, then run the remaining real-backend and physical-device acceptance. Do not claim the release candidate fully verified until those rows have evidence.
