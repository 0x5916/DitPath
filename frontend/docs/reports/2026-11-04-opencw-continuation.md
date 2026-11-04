# OpenCW continuation — coverage, workflows, and UX verification

Date: 2026-11-04. Local implementation and verification only. No push, merge, deployment, production access, backend contract/schema change, or learning-policy change.

## Source identity

- Branch: `codex/opencw-continuation`
- Base: `0e81a7685723fb9dd9fa67451ed894cbfd8810b5` (`integration/opencw-learning-reliability`)
- Code commit used for the final build: `6781aee`; later commits are documentation only
- Working tree: clean for the committed series
- Node: `v26.13.0`; Go: `go1.27.3 darwin/arm64`
- Build API base: `http://localhost:8080/v1` (documented local API, not production)
- Build identity: `.playwright-mcp/opencw-continuation/source-identity.txt`
- Build `en.html` SHA-256: `e933f2a039d84c6a03add90f8fc78f12bf0b070a42f8e309ea529a78d64d6b8a`
- Service worker SHA-256: `33f1d6d59522bc8115c63a4a606404bae3285038153d385791fefb48abecd5ab`
- Build tree SHA-256: `7f80ca44040be67999b997f800d383db9da26263e60b48a92c6a31851b939657`

## Completed work

### 1. Coverage correctness for evidence revisions

The previous forced-refresh rule reused settled coverage for every trigger. A learning-evidence correction, rejection, or record revision during an in-flight pass could therefore be projected with `coverage: complete` even though the ledger was actually partial. `projectCharacterEvidence` uses partial coverage to suppress provisional candidates; reusing complete coverage could therefore change screening/recall eligibility, not only the visible coverage label.

Evidence notifications now distinguish record revisions from outbox-only status changes:

- `training-data-events`: optional `records` flag.
- `learning-evidence`: duplicate-only appends, empty imports, acknowledgements, and retryable rejections no longer claim a record revision; permanent rejections and new downloaded records do.
- `learning-sync`: exposes `dataVersion`, incremented only for record revisions.
- `learning-view`: record revisions re-project immediately with current coverage; guided-attempt refreshes may still bridge a settled coverage value because they do not change the evidence ledger.

Regressions cover duplicate/ack/rejection notifications, revision-vs-status propagation, correction during a held sync, settlement restoration, and the existing owner/late-result/disposal fences.

### 2. Guided Lessons and Recall & Review separation

- Home has two purpose-labelled actions: Guided Lessons and Recall & Review.
- Guided Lessons derives its action only from `homeCourseAction` over historical course guidance. Guided resume/restart, course completion, and introduced characters remain authoritative. A recall recommendation never selects the guided step.
- Recall & Review owns the shared recommendation, checks, due reviews, proficiency/retention, provisional claims, attained-only screening, and coverage uncertainty.
- A policy `new-lesson` recommendation on a recall surface opens `/morse/learn`, where Guided Lessons chooses the next unlocked step. A mixed check with fewer than two known characters also opens Guided Lessons instead of a dead-end check URL.
- Lessons no longer substitutes `LearningOverview` for the guided hero, no longer hides requirements for known characters, and no longer creates a duplicate learning projection.
- Progress links to Recall & Review; Recall & Review links to guided lessons, the Morse reference, and character details.
- The new localized route is `/morse/review`, with desktop Recall navigation, mobile More entry, noindex metadata, route inventory, prerender entries, and offline precache coverage in all five locales.

### 3. UX and accessibility corrections

- `Refresh learning history` became `Open learning evidence settings`; the recall action also explains that synchronization status and retry live in Settings.
- Training-history and learning-evidence status now use distinct saved/pending/rejected/blocked/synchronized wording. The evidence status links to `#learning-evidence`; Settings and More expose that section.
- Non-expanded background sync attention is no longer a live region, so routine status changes cannot speak over assessed audio. Expanded Settings status still announces changes.
- Client-side link and history navigation focus the main landmark when focus would otherwise fall back to the document body. Hash targets and intentionally focused elements are left alone.
- Recall secondary links meet the 44px target.

### 4. Maintainability

- The carried-forward audio/timing/controller work remains uncommitted and outside this series.
- Lessons dropped an unnecessary `createLearningView` mount, removing one evidence-plus-attempt projection and its subscriptions per visit.
- A representative synthetic projection benchmark measured approximately 13 ms for 240 records, 36 ms for 1,920 records, and 160 ms for 4,800 records (400 checks). A trial index optimization produced no meaningful improvement, so it was reverted rather than kept as speculative complexity. No cross-route claim cache was introduced.
- Documentation was reconciled in `learning.md`, `design-handoff.md`, and `frontend/README.md`.

## Verification

Run from `frontend/` with Node 26 unless noted.

| Check                       | Result                                            |
| --------------------------- | ------------------------------------------------- |
| `npm run verify`            | exit 0; 72 test files, 903 tests passed           |
| `npm run lint`              | exit 0                                            |
| `npm run build`             | exit 0; static build written                      |
| `npm run messages:validate` | exit 0; 740 keys, 5 locales, every key referenced |
| `go test ./...`             | exit 0 (backend)                                  |
| `go vet ./...`              | exit 0 (backend)                                  |
| `git diff --check`          | clean                                             |

Focused suites used during iteration: learning-view, learning-sync runtime, learning-evidence repository/sync, training-sync repository, home-course-action, recall-action, Home state/cache, navigation, and SEO.

Intermediate commit checks: `npm run check` exited 0 at `b007cf7`, `e743e1b`, `474feee`, `e714051`, and `6781aee`. Focused suites at `b007cf7` passed 5 files / 57 tests; at `e743e1b` passed 3 files / 26 tests.

### Browser evidence

Built preview: `http://127.0.0.1:4175` on the identity above. Synthetic fixtures: `http://127.0.0.1:4174` through `npm run acceptance` (mock API returns 503). Browser: headless Chromium 157.0.0.0 on macOS.

Passed:

- Home with guided history: Guided Lessons `Start Lesson 2: R`; Recall & Review `Check your current recall`; separate Practice and Morse table.
- Lessons: guided hero/`Start lesson 2`, course rows, `Recall & Review` link, and unlock requirements remain visible; no recall recommendation substitution.
- Recall & Review: populated guided-only state, new-learner empty state, partial-coverage recovery state, and `Open learning evidence settings` action.
- Progress → Recall & Review link and focus after navigation.
- Settings evidence status: `Learning evidence could not synchronize. Saved records are retained.` distinct from training `Some history could not sync`.
- Client-side Home/Lessons/Recall/Progress navigation and Back/Forward focus the `main` landmark.
- Locale routes for en, de, ja, zh-Hans, and zh-Hant returned 200 for Home, Lessons, Review, Practice, Progress, Settings, guided session, `review=return`, and `check=KM`.
- Widths 320, 390, 768, 960, 1199, and 1440 CSS px: no horizontal overflow; navigation switches at 959/960.
- Dark theme at 390 px on Recall & Review and Settings.
- Offline reload of the built `/en/morse/review` shell through the service worker.
- Practice save failure and recovery in the synthetic acceptance fixture: completing a passage showed `Your practice result has not been saved`, and overlay `Retry saving` changed the state to `Practice result saved on this device`.
- Lighthouse accessibility: 100 on the built recall surface; best practices 100; SEO 80 (a non-descriptive link warning; the route is noindex).

Screenshots: `.playwright-mcp/opencw-continuation/screens/` (`home-960.png`, `lessons-960.png`, `review-390-dark.png`, `settings-390-dark.png`, `review-320.png`).

### Not completed / blocked

- Penpot MCP was not connected (`penpot` unavailable), so no board was inspected, versioned, or edited. The Recall & Review design remains a pending design-review dependency; no Penpot alignment is claimed.
- Real authenticated synchronization against a disposable backend/account, two isolated profiles, concurrent-tab success paths, and Go PostgreSQL/race suites were not run. The acceptance API is an always-503 mock and is not synchronization acceptance.
- Physical-device audio, IME, spoken screen-reader, native 200% zoom, and safe-area/keyboard checks were not run.
- Chrome macOS desktop switching, Safari return-to-original-space visibility, active desktop/app-focus changes during playback, guided introduction playback, and screen recording remain open from the prior lifecycle report.
- A same-owner authentication renewal in a browser was not repeated; unit/runtime tests cover owner fencing and late responses.
- Large-history projection optimization was measured and deliberately deferred.

## Commit series

| Commit    | Scope                                                              |
| --------- | ------------------------------------------------------------------ |
| `b007cf7` | Carried-forward learning reliability and pending-coverage work     |
| `e743e1b` | Evidence record revisions project with current coverage            |
| `474feee` | Distinct Recall & Review surface and route                         |
| `e714051` | Purpose-specific Home, Lessons, Progress, and docs                 |
| `6781aee` | Sync scope wording, evidence settings, live-region and focus fixes |

Audio, timing, and controller edits remain in the original dirty checkout and are not part of this series.
