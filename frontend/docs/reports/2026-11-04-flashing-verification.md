# Flashing verification — 2026-11-04

Verification-only packet. No application behavior, policy, cleanup, merge, or deployment changes were made.

## Source identity

- Branch: `integration/opencw-learning-reliability`
- HEAD: `0e81a7685723fb9dd9fa67451ed894cbfd8810b5`
- Tracked diff: 16 files, 668 insertions, 83 deletions
- Tracked diff SHA-256: `e400d9197d1f269c27e6d6dedf7586ab4995d6126df7d13f900c74ac2b03a5c2`
- Build index SHA-256: `e024c5db1368a73980d6a6012a46ea736ad98f6dc392b08774e8c36eb6e64c2a`
- Build tree SHA-256: `278413df9fa45dd01aa722f71659b18126b6e5c2422852a38ca7e694f0c116d0`

Untracked files included in this identity:

| File                                            | SHA-256                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `OPENCW_OPENCODE_HANDOFF.md`                    | `7e460d0baeae7ef2981ddb6b5512f4269bf951cb84ba4ffa80eedcf270d5c05a` |
| `frontend/src/lib/data/home-view-cache.test.ts` | `4b5bf206317c9a4cce91896739418790e14acc70493965a8ee024b64efc635a7` |
| `frontend/src/lib/data/home-view-cache.ts`      | `c3684a47f958f37c1f274b17ff1d0c3aaa90dd2ed59b13341a105236c9634b72` |
| `frontend/src/lib/data/home-view-state.test.ts` | `9cd69c84bc46f9e196c44ad2e4051f6ab7d4b965491363d3908b562d89443ab8` |
| `frontend/src/lib/data/home-view-state.ts`      | `c3a0cb08715105720ec580739873f4ffbe2b454e81a195dcc28978f841a82226` |
| `frontend/src/lib/learning-view.test.ts`        | `bb7729a10da3ee4b6daeb47e8871391e1607b32a1a90ccdffcc0bebd72a91b40` |

All matrix evidence below comes from the freshly built preview identified above. Older browser evidence is not used for pass/fail because its build artifact identity was not recorded.

## Environment and method

- Preview: `http://127.0.0.1:4174`
- Browser: Playwright Chromium through the OpenCode browser harness
- Viewport: 1280 × 900
- Node: `v26.13.0`
- Each scenario used an isolated browser context except account switching, which used one context deliberately.
- The probe sampled DOM state every 16 ms, recorded `MutationObserver` changes, focus/visibility events, and `/v1/` resource entries. Screenshots were captured at route boundaries and settled states.
- No Playwright package was added to the project. The preserved scripts run through the existing browser harness with `browser_run_code_unsafe({ filename })`.

## Scenario matrix

| Scenario                                    | Status     | Key result                                                                                                                             |
| ------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Home → Lessons → Progress → Settings → Home | passed     | Lessons/Progress showed route-entry skeletons; Home warm return showed no landing or skeleton.                                         |
| Browser Back/Forward                        | passed     | No content→skeleton reversions; Back to Home never showed landing.                                                                     |
| Language change EN → DE → EN                | passed     | German content and `lang=de` rendered; URL canonicalized to `/de/settings`; no landing/default flash.                                  |
| Real tab/window switching                   | unverified | Headless Chromium emitted no focus/visibility events; synthetic handler path passed.                                                   |
| Unchanged synchronization                   | passed     | No landing, skeleton, or recommendation reset. Both sync endpoints ran. CTA changed once as coverage settled from partial to complete. |
| Genuine update                              | passed     | Completed sessions changed 1 → 2 without landing or skeleton.                                                                          |
| Offline / recovery                          | passed     | Loaded content remained; no landing or skeleton offline; recovery re-ran both sync endpoints.                                          |
| Account switching A → B → A                 | passed     | B showed its own empty dashboard; A restored its activity.                                                                             |
| Interrupted guided session                  | passed     | “Restart unfinished lesson 2” survived navigation; route entry skeleton only.                                                          |

## Detailed evidence

### Route tour

- Lessons: skeleton 4 at t=16 ms → content at t=34 ms.
- Progress: skeleton 1 at t=12 ms → content at t=16 ms → final content at t=19 ms.
- Settings: content at t=57 ms, no skeleton.
- Home warm: recommendation loading at t=23 ms → recall recommendation at t=29 ms; `welcome=false` throughout.

These are route-entry loading states, not loaded content reverting.

### Back/Forward

- Back to Lessons: skeleton 4 at t=16 ms → content at t=33 ms.
- Back to Home: no landing; recommendation loading at t=4 ms → recall at t=7 ms.
- Forward to Lessons: skeleton 4 at t=3 ms → content at t=6 ms.
- Forward to Progress: skeleton 1 at t=4 ms → content at t=6 ms.
- Content→skeleton reversions: 0.

### Language change

- EN → DE: German text and `html lang="de"` at t=32 ms; URL `/de/settings` at t=50 ms.
- DE → EN: English text and URL restored.
- No landing page or skeleton appeared.

Observed transient: content language changed before the localized URL canonicalized (about 18 ms).

### Real tab/window switching

- Real `context.newPage()` + `bringToFront()` switching produced no `focus`, `blur`, or `visibilitychange` events in headless Chromium; `visibilityState` remained `visible`.
- Synthetic `focus` + `visibilitychange` produced no DOM mutations, no landing, and no skeleton.
- Physical tab/window/desktop switching remains unverified.

### Unchanged synchronization

- No landing, skeleton, or recommendation reset.
- `/training/changes?cursor=cursor-2` and `/training/learning-evidence/changes?limit=100&cursor=lcursor-1` ran.
- Observed CTA change: “Refresh learning history” → “Check your current recall” as coverage settled from partial to complete. This was a coverage-state settle, not a data reset.

### Genuine update

- Remote session applied: “Completed sessions 1” → “Completed sessions 2” at t=12–13 ms.
- No landing or skeleton.
- Both sync endpoints were exercised.

### Offline / recovery

- Offline: no landing, no skeleton, no content reset; no `/v1/` resources.
- Recovery: no landing, no skeleton; both sync endpoints ran again.

### Account switching

- Account B: empty dashboard; no account A activity.
- Account A: “Completed sessions 2” restored.

### Interrupted session

- Seeded in-progress guided session showed “Restart unfinished lesson 2”.
- Progress → Lessons return: skeleton 4 at t=8 ms → unfinished lesson restored at t=17 ms.
- No landing page.

## Legitimate loading vs. reverting defaults

- Lessons and Progress skeletons occurred only on route entry before content.
- No loaded content reverted to a skeleton in the route tour or Back/Forward matrix.
- Home warm returns did not show the public landing page or a progress skeleton.
- The only visible change during unchanged sync was the coverage warning CTA settling to the recall recommendation.

## Preserved artifacts

Directory: `.playwright-mcp/flashing-verification/`

- `source-identity.txt` — HEAD, diff hash, untracked hashes, build hashes.
- `scripts/01-route-tour.js`
- `scripts/02-back-forward.js`
- `scripts/03-language.js`
- `scripts/04-tab-switch.js`
- `scripts/05-sync-account.js`
- `scripts/06-interrupted-session.js`
- `screens/01-home-cold.png` … `screens/20-interrupted-back.png`
- `results/summary.json` — sanitized scenario matrix and key measurements.

The `.playwright-mcp/` directory is ignored by Git but remains in this workspace. Scripts are standalone `async (page) => { … }` functions and require no new project dependency; run them with the browser harness against the preview URL above.

## Checks

- `npm run verify`: exit 0; 70 test files, 887 tests passed.
- `npm run lint`: exit 0.
- `npm run build`: exit 0.
- `npx svelte-check`: 0 errors, 0 warnings.
- `git diff --check`: clean.

## Remaining causes and proposed bounded packets

1. **Real tab/window/desktop switching — unverified.**
   - Evidence: headless Chromium emitted no visibility/focus events.
   - Proposed packet: manual/physical Chromium, Safari, and macOS desktop-switch verification with screen recording. No code change proposed.

2. **Coverage-settle recommendation swap — observed.**
   - Evidence: unchanged sync changed the Home CTA from “Refresh learning history” to “Check your current recall” after coverage settled.
   - Proposed packet: hold the Home recommendation area in a non-actionable settled state until learning coverage is stable, without caching claims.

3. **Language content precedes URL canonicalization — observed transient.**
   - Evidence: German content at t=32 ms, `/de/settings` at t=50 ms.
   - Proposed packet: canonicalize the localized URL before or atomically with applying the document language, if this is accepted as a visible mismatch.

4. **Active in-session interruption/audio behavior — unverified.**
   - Evidence: only the interrupted-session resume card was exercised; active guided-session tab switch, audio pause, and recovery were not.
   - Proposed packet: active guided-session visibility/audio interruption acceptance with synthetic fixtures.

No speculative fixes were made in this packet.
