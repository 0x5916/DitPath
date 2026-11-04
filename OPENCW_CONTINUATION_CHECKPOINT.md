# OpenCW continuation checkpoint — 2026-11-04

Implementation is complete for the authorized continuation packets; acceptance is partially complete. The 2026-11-05 release-acceptance continuation added one design-alignment fix and published draft PR #4. Nothing was merged, auto-merged, deployed, or run against production. Learning-policy semantics and backend contracts are unchanged.

## Git identity

- Working branch: `codex/opencw-integration`
- Base: `origin/main` `4d286506fcf3184fb6c0ead4c82a8380d8879430` (PR #3 merge)
- Final code candidate: `0963f7a276f19d0ffe04c30ecacf8b2d55f81d45` (`Use full Recall & Review label in More`)
- Documentation commits follow the code candidate; see `git log -1` for the current HEAD
- PR: <https://github.com/0x5916/Morse/pull/4> (draft; auto-merge disabled)
- Original dirty checkout: `/Users/alan/Desktop/Morse` (preserved; 28 entries, including audio/timing/controller edits untouched; tracked-diff SHA-256 `7f839215c692240fdeee75bc8daf86e22e7c1832b1585ff895327c1b60e7e768`)
- Integration worktree: `/Users/alan/.codex/worktrees/opencw-integration/Morse`
- Historical continuation worktree: `/Users/alan/.codex/worktrees/opencw-continuation/Morse`
- Build/source identity: `.playwright-mcp/opencw-acceptance-20261105/` and `.playwright-mcp/opencw-continuation/source-identity.txt`

## Commit series

| Commit    | Scope                                                              |
| --------- | ------------------------------------------------------------------ |
| `b007cf7` | Carried-forward learning reliability and pending-coverage fixes    |
| `e743e1b` | Evidence record revisions project with current coverage            |
| `474feee` | Distinct Recall & Review surface and route                         |
| `e714051` | Purpose-specific Home, Lessons, Progress, and owning docs          |
| `6781aee` | Evidence sync scope, recovery wording, live-region and focus fixes |
| `0963f7a` | Full localized Recall & Review label in mobile More                |
| docs      | Dated report, checklist, checkpoint and handoff update             |

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
- Penpot design reconciliation: MCP connected; pre-edit version `OpenCW · 2026-11-04 · pre recall design reconciliation`; Learning boards 20–25 added; desktop navigation boards 10/11 updated; post-edit version `OpenCW · 2026-11-04 · recall workflow reconciliation complete`; `penpot.currentFile.validate()` returned 0 errors. Alan selected the visible desktop label `Recall`; page title/accessible name remain `Recall & Review`. No code or policy change was needed.
- Built preview (`4175`) browser checks: route tour, Back/Forward focus, 320/390/768/960/1199/1440 widths, five locales, dark theme, offline recall shell, Lighthouse accessibility 100.
- Synthetic acceptance (`4174`) checks: guided-only Home/Recall, new-learner empty state, partial coverage recovery, evidence-vs-training status wording, Settings/More evidence discovery, and Practice save failure → retry → saved.
- Integration candidate: `npm run verify` 72 files/903 tests, `npm run lint`, and `npm run build` all exit 0 after a formatting-only report fix.
- Intermediate commits: `npm run check` exit 0 at every code commit; focused suites passed at `b007cf7` and `e743e1b`.
- 2026-11-05 final candidate `0963f7a`: `npm run verify` exit 0 with 73 files/904 tests; `npm run lint` exit 0; `npm run build` exit 0; `PUBLIC_API_BASE=/v1 npm run build` exit 0; Svelte autofixer 0 issues/0 suggestions.
- 2026-11-05 backend rerun: `go test -count=1 ./...` exit 0; `go vet ./...` exit 0. Disposable PostgreSQL/race suites reused from 2026-11-04 because `git diff 6781aee..HEAD -- backend` is empty; PR CI re-runs both.
- PR #4 CI on code candidate `0963f7a`: Frontend, Backend, PostgreSQL and Targeted race jobs all passed (run `41896405567`).
- 2026-11-05 lifecycle: real Chrome/Safari tab, Cmd+Tab and Space switching; hidden/paused, no auto-resume, explicit Resume, confirmed desktop return; Chrome 200% page zoom; More full-label fix verified in five locales.
- 2026-11-05 trailing slash: `/en/` 404 in both local preview and production nginx; consistent with `trailingSlash: 'never'`, documented as a deployment-configuration decision rather than changed.
- Full details: `frontend/docs/reports/2026-11-04-opencw-continuation.md` and `frontend/docs/reports/2026-11-04-opencw-acceptance.md`.

## Remaining blockers and deferred work

- Design reconciliation is complete, but final design sign-off remains a separate user action after reviewing the post-edit Penpot version. The visible desktop label is approved as `Recall`; the mobile More entry now uses the full localized `Recall & Review` label.
- Penpot MCP was disconnected during the 2026-11-05 run (`Unknown identifier 'penpot'`), so the final visual comparison used the documented boards and local screenshots. It does not substitute for owner sign-off.
- Physical-device audio, IME, spoken screen-reader, mobile native text scaling, safe areas, and software-keyboard checks remain unverified. No physical iPhone/Android was attached.
- Chrome/Safari tab, Cmd+Tab and Space switching now have real local evidence; screen recording remains unavailable. Audible playback still requires a human on a physical device.
- Safari 200% page zoom was not completed in this run; desktop Chrome 200% passed.
- The `/en/` 404 behavior is identical in preview and production nginx and is not preview-only. A 301 is a deployment-configuration change requiring approval.
- Large-history projection optimization was measured (~160 ms for 4,800 synthetic records) and deferred because a trial optimization showed no meaningful gain.
- Manual checklist: `frontend/docs/reports/2026-11-04-manual-acceptance-checklist.md`.
- Release acceptance report: `frontend/docs/reports/2026-11-05-opencw-release-acceptance.md`.
- Deployment plan: `frontend/docs/reports/2026-11-05-opencw-deployment-plan.md`.

## Next task

Review the post-edit Penpot version and record final design sign-off, then complete the remaining physical-device and spoken-screen-reader rows. Merge and deployment each require separate approval; PR #4 is a draft with auto-merge disabled.
