# OpenCW integration and acceptance — 2026-11-04

Acceptance continuation for `codex/opencw-continuation`. Local only: no push, merge, deployment, production access, backend contract/schema change, or learning-policy change.

## Identity

- Tested code: `6781aee25cb0bdce350fb97657205f11f4c55ed8`
- Integration acceptance HEAD: `79ef77db2bb9e0f54ad4c6fdd6c8ed473d7a46de` (documentation only after the tested code; see `git log -1` for later doc commits)
- Implementation candidate: `codex/opencw-continuation`, base `0e81a7685723fb9dd9fa67451ed894cbfd8810b5`
- Integration candidate: `codex/opencw-integration`, based on `origin/main` `4d286506fcf3184fb6c0ead4c82a8380d8879430`
- Remote main contains PR #3 merge `4d28650`; its tree is identical to candidate base `0e81a76` (`git diff 0e81a76..origin/main` empty).
- Original checkout `/Users/alan/Desktop/Morse` was not modified. Its preserved tracked-diff SHA-256 remains `7f839215c692240fdeee75bc8daf86e22e7c1832b1585ff895327c1b60e7e768`.

## Integration preparation

The integration worktree was created from `origin/main` and merged with the candidate without conflicts. The integration branch was verified independently:

| Check                                          | Result                                        |
| ---------------------------------------------- | --------------------------------------------- |
| `git merge --no-ff codex/opencw-continuation`  | exit 0; no conflicts                          |
| `npm run verify` in `codex/opencw-integration` | exit 0; 72 files, 903 tests                   |
| `npm run lint` after report formatting         | exit 0                                        |
| `npm run build`                                | exit 0                                        |
| localized `/morse/review.html` output          | en, de, ja, zh-Hans, zh-Hant, plus bare route |

The only integration issue was a Markdown table formatting failure in the continuation report. It was fixed on the candidate (`36f97da`) and merged into integration; lint then passed.

## Disposable backend and database

- PostgreSQL: `postgres:18.6-alpine3.24`, unique container name, random password, tmpfs data, ephemeral loopback port. No development or production database was read or modified.
- API: Go backend on `127.0.0.1:8080`, schema migrated by startup; `/v1/health` returned 200.
- Synthetic accounts: two accounts created through the real registration endpoint (A and B); credentials stored only in a private temporary directory and not included in this report.
- Frontend: built preview at `127.0.0.1:4175`, `PUBLIC_API_BASE=http://localhost:8080/v1`, CORS allowing the loopback preview origins.

### PostgreSQL suites

| Command                                             | Result                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `backend/scripts/test-postgres.sh --verbose`        | exit 0; 14 packages ok; 1,292 `--- PASS` lines; 0 skips; 0 failures; schema/index target verified |
| `backend/scripts/test-postgres.sh --race --verbose` | exit 0; 8 packages ok; 961 `--- PASS` lines; 0 skips; 0 failures; no `DATA RACE`                  |

Counts are test-case pass lines because `go test` did not emit a separate aggregate test total. They are not a claim of 1,292 independent user journeys.

## Real authenticated browser acceptance

Browser: built Chromium 157 preview plus visible Google Chrome 156.0.8078.80 and Safari 27.2 where noted. Synthetic accounts only.

| Scenario                              | Result                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real login form                       | Passed                   | Account A token persisted; Home rendered as signed-in owner.                                                                                                                                                                                                                                                                                                                                                                  |
| Practice save and upload              | Passed                   | One completed practice; `/v1/training/sessions` returned 1 server session.                                                                                                                                                                                                                                                                                                                                                    |
| Second profile downloads same account | Passed                   | New browser context logged into A; Home/Progress showed 1 completed session.                                                                                                                                                                                                                                                                                                                                                  |
| Concurrent two-profile update         | Passed                   | A second context completed another practice; both contexts then showed 2 completed sessions.                                                                                                                                                                                                                                                                                                                                  |
| Account isolation                     | Passed                   | Account B showed empty Progress and no A activity.                                                                                                                                                                                                                                                                                                                                                                            |
| Offline save then reconnect           | Passed                   | Practice saved while offline; after online, server session count increased to 3.                                                                                                                                                                                                                                                                                                                                              |
| Learning-evidence upload              | Passed with limitation   | Recall CTA started a check; server received a plan, 10 observations, exposures and a terminal (paginated changes). The headless check was incomplete due to interrupted first presentations; this did not block the separate valid-evidence correction scenario below.                                                                                                                                                        |
| Permanent rejection                   | Passed                   | Injected ID-conflict evidence was rejected permanently; Settings showed `Permanently rejected evidence records: 1.`; Home and Recall still rendered; rejected records were excluded.                                                                                                                                                                                                                                          |
| Same-owner token renewal              | Passed                   | Access token rotated while username/subject stayed unchanged; pending practice remained pending through renewal, then uploaded once; loaded history stayed visible and the saved check checkpoint survived.                                                                                                                                                                                                                   |
| Guided introduction playback          | Passed                   | Visible Chrome: Lesson 1 `Listen to K` and `Listen to M` each created/started audio, changed to Continue after completion, and advanced to the warm-up prompt. Artifact: `.playwright-mcp/opencw-continuation/chrome-guided-intro.json`.                                                                                                                                                                                      |
| Correction milestone                  | Passed                   | Four valid server-accepted mixed checks produced 4 milestones. A late exposure guard produced no correction until closure; closure produced one `unverified / late-evidence-invalidated` correction. Progress then showed K proficiency recorded, K retention not established, `Earlier claim needs verification`, while M retention remained. Server evidence: `.playwright-mcp/opencw-continuation/seed-correction-d.json`. |
| Home recall CTA audio activation      | Passed                   | Clicking `Check your current recall` started the session and audio without an extra Play action; the answer input received focus.                                                                                                                                                                                                                                                                                             |
| Saved session reload                  | Passed                   | Reload retained the same `resume=` URL and prompt index; resumed paused with focus on the paused heading.                                                                                                                                                                                                                                                                                                                     |
| Visible Chrome active check           | Passed                   | Audio oscillator started; real tab hide showed `Check paused`; return did not auto-resume; explicit `Resume check` returned to the answer state. Artifact: `.playwright-mcp/opencw-continuation/chrome-active-check.json`.                                                                                                                                                                                                    |
| Safari smoke                          | Passed                   | Real Safari 27.2 loaded Recall & Review at 390px with no horizontal overflow; client navigation focused `main-content`.                                                                                                                                                                                                                                                                                                       |
| Penpot design reconciliation          | Passed, sign-off pending | MCP connected; pre-edit and post-edit versions saved; Learning boards 20–25 added; desktop nav boards 10/11 updated; `validate()` returned 0 errors. Label `Recall` approved by Alan; full design sign-off remains separate.                                                                                                                                                                                                  |

### Same-owner renewal procedure

1. Log in through the real form and load at least one synced practice session.
2. Save a check checkpoint, then complete another practice with `/v1/training/**` blocked.
3. Advance only the page clock so the access token is considered expired; click `Sync now`.
4. Confirm the access token rotated, username/JWT subject stayed the same, pending history stayed pending, and the saved checkpoint remained.
5. Unblock training, sync again, and confirm the pending session uploaded exactly once and history remained visible.

No session was replaced, no pending write was dropped, and no checkpoint was lost.

### Milestone-correction prerequisites and procedure

Prerequisites: disposable PostgreSQL/API, real synthetic account, mixed-check intake enabled, client-profile ID matching the active `single-character-clean-open-20` profile.

1. Upload four complete mixed-check manifests (20 observations each) at days 0, 1, 3 and 9. Each check contains ten K and ten M first-listen correct observations with matching `exposure-open`/`exposure-close` guards and a completed terminal. The server accepted all 62 records per check with zero rejections and produced four milestones (K/M proficiency and retention).
2. Upload a late `exposure-open` for K one hour before the day-9 cold probe. Confirm no correction is emitted while the guard is unresolved.
3. Upload the matching `exposure-close`. The server emitted exactly one correction: `kind=milestone-correction`, `status=unverified`, `reason=late-evidence-invalidated`, no replacement.
4. Log in the account in the browser and wait for evidence synchronization.
5. Expected UI: K proficiency `Recorded`, K retention `Not established`, `Earlier claim needs verification`; M retention remains. This matched. No validation was weakened and no correction was injected as a client record.

## Accessibility, browser, and device matrix

| Row                                                            | Status                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Built-preview widths 320/390/768/960/1199/1440                 | Passed; no horizontal overflow                                                    |
| Navigation boundary 959/960                                    | Passed                                                                            |
| Five locales on Home/Lessons/Review/Practice/Progress/Settings | Passed; 200 responses                                                             |
| Dark theme at 390px                                            | Passed on Review and Settings                                                     |
| Offline shell for `/morse/review`                              | Passed through service worker                                                     |
| Lighthouse accessibility on built Review                       | 100; best practices 100; SEO 80 (non-descriptive-link warning on a noindex route) |
| Keyboard focus after client navigation/Back/Forward            | Passed on Chromium and Safari                                                     |
| Visible Chrome active-check pause/resume                       | Passed                                                                            |
| Visible Chrome macOS desktop switch                            | Blocked/unverified; prior attempt produced no lifecycle evidence                  |
| Safari return-to-original-desktop visibility                   | Blocked/unverified                                                                |
| Active app-focus change during playback                        | Not repeated; prior attempt blocked by a native dialog/renderer hang              |
| Guided introduction playback                                   | Passed in visible Chrome for K and M, including Continue progression              |
| Physical-device audio/autoplay                                 | Blocked; no physical device available                                             |
| Physical IME/software keyboard                                 | Blocked; no physical device available                                             |
| Spoken screen-reader journey                                   | Blocked; VoiceOver spoken-output acceptance not performed                         |
| Native 200% zoom/text scaling                                  | Blocked; resized viewports are not native zoom                                    |
| Screen recording                                               | Blocked by prior macOS capture permission failure                                 |

## Design reconciliation

The Penpot file was reconciled through MCP on 4 November 2026. Versions: `OpenCW · 2026-11-04 · pre recall design reconciliation` and `OpenCW · 2026-11-04 · recall workflow reconciliation complete`.

1. Home hierarchy — established: Guided Lessons is the sole accented primary action; Recall & Review is a bordered secondary action.
2. Desktop navigation label — approved: visible label `Recall`; page title and accessible name `Recall & Review`.
3. Recall surface hierarchy — established: profile/coverage, recommendation, due review, attainment, screening.
4. Status placement — established: coverage uncertainty on Recall; permanent-rejection diagnostics and repair in Settings → Learning evidence, with affected History rows labelled.
5. Mobile discovery — established: keep Home / Practice / Progress / More; Recall & Review is a full-label More entry and More remains active on `/morse/review`.

The Learning page now carries boards 20–25, and Design system desktop navigation boards 10/11 include Recall. `penpot.currentFile.validate()` returned 0 errors. No learning-policy or backend contract changed, and no application code change was required.

Design reconciliation is not final user sign-off. The remaining user action is to review the post-edit version and confirm sign-off or request concrete changes.

## Remaining acceptance work

- Final design sign-off after reviewing the post-edit Penpot version; the label decision is already approved.
- Physical-device audio, IME, native text scaling, safe-area and software-keyboard checks.
- Spoken screen-reader acceptance.
- Chrome desktop switch, Safari desktop-return visibility, active desktop/app-focus during playback.
- Screen recording where macOS permission permits.
- Backend/database race and PostgreSQL suites are complete for this candidate; no frontend/API contract change was introduced.
- Same-owner renewal, guided introduction playback and the real milestone-correction run are complete.

Manual checklist for the remaining rows: [2026-11-04-manual-acceptance-checklist.md](2026-11-04-manual-acceptance-checklist.md).

## Commands and artifacts

- PostgreSQL: `backend/scripts/test-postgres.sh --verbose` and `--race --verbose` (repository root).
- Frontend candidate/integration: `npm run verify`, `npm run lint`, `npm run build` from `frontend/`.
- Real sync artifacts: `.playwright-mcp/opencw-continuation/chrome-active-check.json`, `chrome-guided-intro.json`, `seed-correction-d.json`; screenshots under `.playwright-mcp/opencw-continuation/screens/`.
- Manual checklist: [2026-11-04-manual-acceptance-checklist.md](2026-11-04-manual-acceptance-checklist.md).
- Penpot versions: `OpenCW · 2026-11-04 · pre recall design reconciliation` and `OpenCW · 2026-11-04 · recall workflow reconciliation complete`. Navigation comparison: `.playwright-mcp/opencw-continuation/screens/nav-label-comparison.png`.
- Build/source identity: `.playwright-mcp/opencw-continuation/source-identity.txt`.
- Historical continuation report: [2026-11-04-opencw-continuation.md](2026-11-04-opencw-continuation.md).
