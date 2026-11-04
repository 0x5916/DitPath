# OpenCW release acceptance — 2026-11-05

Continuation of [2026-11-04 acceptance](2026-11-04-opencw-acceptance.md) and the [manual checklist](2026-11-04-manual-acceptance-checklist.md). This run completed the available independent acceptance, fixed one demonstrated design-alignment defect, and prepared PR #4. Nothing was merged, auto-merged, deployed or run against production.

## Candidate identity

| Item                 | Value                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch               | `codex/opencw-integration`                                                                                                                                                   |
| Code candidate       | `0963f7a276f19d0ffe04c30ecacf8b2d55f81d45` (`Use full Recall & Review label in More`)                                                                                        |
| Base                 | `origin/main` `4d286506fcf3184fb6c0ead4c82a8380d8879430` (PR #3 merge)                                                                                                       |
| Integration worktree | `/Users/alan/.codex/worktrees/opencw-integration/Morse`                                                                                                                      |
| Original checkout    | `/Users/alan/Desktop/Morse`; 28 dirty entries preserved; tracked-diff SHA-256 `7f839215c692240fdeee75bc8daf86e22e7c1832b1585ff895327c1b60e7e768` (unchanged from 2026-11-04) |
| Build                | `PUBLIC_API_BASE=/v1`, served by the disposable preview at `127.0.0.1:3001`                                                                                                  |
| Served `/en`         | SHA-256 `4128c7bb0958d2733b7f68d895fc1f68b9d11248ddfc38a179db3848ab3f375a` (matches `frontend/build/en.html`)                                                                |
| Service worker       | SHA-256 `d9963990b48ad4c0ea8c12be4fdd9cf2d759172fa2553240f86d43ace46d6c88` (matches `frontend/build/service-worker.js`)                                                      |
| Disposable API       | `127.0.0.1:8081/v1/health` healthy; synthetic accounts only                                                                                                                  |

PR: <https://github.com/0x5916/Morse/pull/4> (draft, auto-merge disabled).

## Demonstrated defect and fix

**Mobile More used the short label.** At 390 CSS px, logged in as a synthetic returning learner, `/en/more` showed `Recall` in the Learning group. The reconciled design and [design handoff](../design-handoff.md) require a full-label **Recall & Review** More entry, while the visible desktop navigation label remains **Recall**. This was a routine implementation alignment, not a new product decision.

Change: `frontend/src/routes/more/+page.svelte` now uses the localized `review_page_title` message for that entry. A server-render regression test (`frontend/src/routes/more/more-page.test.ts`) asserts the review link uses the full localized title.

Verification: `/en`, `/de`, `/ja`, `/zh-Hans` and `/zh-Hant` More pages show the localized full label; no overflow at 390 px; full frontend gates pass. No learning-policy, backend-contract, auth or schema change.

No other demonstrated product defect was found in the completed rows.

## A. Design acceptance

The Penpot MCP plugin was not connected during this run. Every `execute_code` attempt that referenced the plugin failed with `ReferenceError: Unknown identifier 'penpot'`. The comparison below therefore uses the reconciled board descriptions recorded in the design handoff and manual checklist, plus fresh 1440/390 screenshots. **It is not a substitute for the owner's final visual review of the Penpot version.**

| Surface               | Observation                                                                                                                                                           | Status                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Home 1440 light       | Guided Lessons is the only accented primary card; Recall & Review is a bordered secondary card; Practice and Morse table remain secondary; desktop label is `Recall`. | Matches boards 20/10/11              |
| Recall 1440 light     | Heading `Recall & Review`; recommendation, ready-for-review, attainment and return-screening sections in the documented order; no horizontal overflow.                | Matches board 21                     |
| Recall 390 light/dark | Single-column stack; bottom navigation with More active; no horizontal overflow; desktop label remains `Recall`, page title remains `Recall & Review`.                | Matches boards 22/24                 |
| More 390              | Learning group now shows `Recall & Review`; More is active on `/morse/review`.                                                                                        | Matches board 23; fixed this run     |
| Lessons               | Additive `Recall & Review` link below course availability; guided hero and requirements remain.                                                                       | Matches board 01 update              |
| Progress              | `Recall & Review` link and learning-evidence card present; guided/recall vocabulary distinct.                                                                         | Matches approved Progress vocabulary |

Evidence (ignored): `.playwright-mcp/opencw-acceptance-20261105/screens/` (`home-returning-1440-light.png`, `review-1440-light.png`, `review-390-light.png`, `final-more-390-en.png`, `design-lessons-1440.png`, `design-progress-1440.png`) and `more-label-verification.json`.

Final design sign-off remains an owner action. The visible desktop label `Recall` is already approved; the repaired More label and the rest of the post-edit version still need final review.

## B. Physical-device and accessibility acceptance

| Row                                               | Status                          | Evidence or block                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real iPhone/Safari                                | Blocked                         | No physical iPhone attached. `xcrun xctrace list devices` lists only the Mac and simulators. The prior LAN test environment was unreachable because ProtonVPN LAN access was off; no device was available to tap or listen. |
| Real Android/Chrome                               | Blocked                         | `adb devices` returned no devices.                                                                                                                                                                                          |
| Audible first-tap playback                        | Blocked                         | Audio graph starts were observed in Chrome/Safari (`osc-start`), but audibility requires a human on a real device. A visual indicator is not audible evidence.                                                              |
| Full K/M introductions                            | Partially verified              | Prior visible-Chrome K/M evidence remains applicable to the unchanged code tree; this run exercised the R introduction. Physical-device audibility is blocked.                                                              |
| Replay, pause, explicit resume                    | Passed in desktop Chrome/Safari | Real tab/app/Space switches paused the session; explicit Resume restored the prompt. See section C.                                                                                                                         |
| Save & leave / checkpoint reopening               | Reused                          | Prior same-owner renewal and saved-session reload evidence on the unchanged code tree; not re-run as a new physical-device row.                                                                                             |
| IME composition / software keyboard               | Blocked                         | Requires a physical Japanese/Chinese IME and software keyboard; not available.                                                                                                                                              |
| Portrait/landscape, safe areas                    | Partially verified              | 320/390/768/960/1199/1440 widths and short layouts verified in the built preview; notch/safe-area behavior requires a physical device.                                                                                      |
| Native 200% zoom/text scaling                     | Partially verified              | Desktop Chrome page zoom at 200% reached a 720 CSS px viewport with no horizontal overflow and mobile navigation. Mobile native text scaling and Safari 200% remain unverified.                                             |
| Spoken VoiceOver/TalkBack/NVDA journey            | Blocked                         | No spoken-output observation. Automated accessibility tree, names, focus and dialog behavior were checked but are explicitly not substituted for a spoken journey.                                                          |
| Background sync announcements over assessed audio | Not audibly verified            | Code and prior tests keep non-expanded sync attention out of a live region; spoken behavior remains part of the blocked screen-reader row.                                                                                  |
| Control names, focus, no answer leakage           | Automated checks pass           | Accessibility tree and focus order are clear at 390/1440; no dot/dash or answer hint is exposed during recognition. Spoken clarity remains blocked.                                                                         |

Manual procedure for the blocked physical/assistive rows is in [the checklist](2026-11-04-manual-acceptance-checklist.md).

## C. Real desktop lifecycle

Method: visible Chrome 156.0.8078.80 with a separate profile and raw CDP; real Safari 27.2 via WebDriver; real Cmd+Tab and Control+Right/Left Space switching through macOS. Page screenshots and event JSON were captured. Screen recording was unavailable, so timestamped screenshots and event logs are the evidence. Playwright's CDP focus emulation was found to mask real visibility changes and was not used for these results.

| Scenario                                 | Observation                                                                                                                                                                                  | Status              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Chrome tab switch during guided playback | Audio oscillator started; `blur` + `visibilitychange hidden`; session showed `Session paused`; return showed visible/focus but did not auto-resume.                                          | Passed              |
| Chrome Cmd+Tab during guided audio       | Frontmost Chrome → OpenCode; `blur`/hidden; return to Chrome; prompt retained (`Sound played` / Continue); no duplicate audio.                                                               | Passed              |
| Chrome tab switch during active check    | Audio started; tab hidden; `Check paused`; explicit Resume returned to the answer prompt; zero additional oscillator starts on Resume.                                                       | Passed              |
| Chrome Cmd+Tab during check              | Chrome → OpenCode → Chrome; blur/hidden and focus/visible captured; check stayed paused until explicit Resume.                                                                               | Passed              |
| Chrome Space switch                      | Control+Right moved to a desktop where OpenCode was frontmost and the page was hidden; Control+Left returned to Chrome and the original desktop became visible; check paused; Resume worked. | Passed              |
| Safari tab switch during guided playback | Safari created a real second tab; original tab reported hidden and paused; return restored the prompt.                                                                                       | Passed              |
| Safari Cmd+Tab during guided audio       | Safari → Chrome → Safari; blur/focus captured; sound completed; no duplicate playback; prompt retained.                                                                                      | Passed              |
| Safari Space switch                      | OpenCode frontmost while away; page hidden; return made Safari/original desktop visible; sound played and Continue remained.                                                                 | Passed              |
| Screen recording                         | Unavailable (prior capture permission failure not re-attempted).                                                                                                                             | Blocked, documented |
| Original desktop visible again           | Confirmed in Chrome and Safari Space-return screenshots.                                                                                                                                     | Passed              |

Evidence: `lifecycle-final.json`, `lifecycle-raw.json`, `lifecycle-raw2.json`, `app-switch-audio.json`, `recall-app-audio.json`, `safari-lifecycle.json`, and matching screenshots under `.playwright-mcp/opencw-acceptance-20261105/`.

One Safari WebDriver page, left open after an automation timeout, showed the no-checks empty state beside populated attainment. A fresh Chrome context showed `Loading recall evidence…` followed by a consistent result, and the condition was not reproducible as a product defect. It remains an unverified Safari first-sync observation for the physical Safari row.

## D. Trailing-slash serving check

| Setup                                                                     | `/en` | `/en/` | Localized review route with/without slash        |
| ------------------------------------------------------------------------- | ----- | ------ | ------------------------------------------------ |
| Local preview (Python static server, `3001`)                              | 200   | 404    | `/en/morse/review` 200; `/en/morse/review/` 404  |
| Repository production nginx (`frontend/nginx.conf`, disposable container) | 200   | 404    | Same pattern for EN/DE/JA/zh-Hans/zh-Hant routes |

The behavior is identical in preview and production configuration, so it is **not preview-only**. It is consistent with SvelteKit `trailingSlash: 'never'` and canonical links that omit the slash. It is not treated as a release blocker. If trailing-slash URLs must resolve (old shared links, typed URLs), add an nginx 301 that strips the trailing slash; that is a deployment-configuration change requiring separate approval and is not included in this PR.

## Verification commands

| Command                                                                                | Working directory | Result                                                      |
| -------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| `npm run verify`                                                                       | `frontend/`       | exit 0; 73 files, 904 tests; svelte-check 0 errors/warnings |
| `npm run lint`                                                                         | `frontend/`       | exit 0 (Prettier + ESLint)                                  |
| `npm run build`                                                                        | `frontend/`       | exit 0                                                      |
| `PUBLIC_API_BASE=/v1 npm run build`                                                    | `frontend/`       | exit 0; served build hashes match                           |
| `npx @sveltejs/mcp svelte-autofixer ./src/routes/more/+page.svelte --svelte-version 5` | `frontend/`       | exit 0; 0 issues, 0 suggestions                             |
| `go test -count=1 ./...`                                                               | `backend/`        | exit 0; all packages                                        |
| `go vet ./...`                                                                         | `backend/`        | exit 0                                                      |

Reused evidence: disposable PostgreSQL `--verbose` (14 packages, 1,292 pass lines, 0 skips/failures) and `--race --verbose` (8 packages, 961 pass lines, no races) from 2026-11-04. `git diff 6781aee..HEAD -- backend` is empty, so the backend tree and configuration identity are unchanged. PR CI re-runs both suites for the exact candidate.

PR #4 CI on code candidate `0963f7a` passed all four jobs: Frontend checks, Backend tests/vet, PostgreSQL integration and Targeted race tests (run `41896405567`).

## Remaining approvals and blockers

1. **A. Acceptance exceptions:** none requested for completed rows; physical-device, spoken screen-reader, mobile native text scaling and Safari 200% rows remain blocked/unverified.
2. **B. Final design sign-off:** owner review of the post-edit Penpot version, including the repaired More entry.
3. **C. Merge approval:** not granted; PR #4 is a draft with auto-merge disabled.
4. **D. Deployment approval:** not granted; no deployment command was run. The plan is [2026-11-05-opencw-deployment-plan.md](2026-11-05-opencw-deployment-plan.md).

The release candidate is **not fully verified** while the blocked manual rows and final design sign-off remain open.
