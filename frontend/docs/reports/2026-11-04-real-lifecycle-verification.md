# Real browser lifecycle and active-session verification — 2026-11-04

Verification-only packet. No application source, policy, cleanup, merge, or deployment changes were made.

## Source identity

- Branch: `integration/opencw-learning-reliability`
- HEAD: `0e81a7685723fb9dd9fa67451ed894cbfd8810b5`
- Tracked diff: 16 files, 668 insertions, 83 deletions
- Tracked diff SHA-256: `e400d9197d1f269c27e6d6dedf7586ab4995d6126df7d13f900c74ac2b03a5c2`
- App build: the fresh preview built for the preceding verification packet; application source is unchanged by this packet.
- Full untracked-file inventory and hashes: `.playwright-mcp/flashing-verification/source-identity.txt`

## Environment

- macOS 27.2 (build 26B123)
- Visible Google Chrome 156.0.8078.80, isolated profile, CDP on `[::1]:9224`
- Visible Safari 27.2 through `safaridriver` on `127.0.0.1:4444`
- Preview: `http://127.0.0.1:4174`
- Screen recording: blocked by macOS capture permission

## Method

- Chrome lifecycle via dependency-free CDP script.
- Safari lifecycle via dependency-free WebDriver HTTP script.
- Real tab switches, app focus changes, and macOS desktop switches driven through Chrome/Safari and `osascript`.
- DOM state, visibility/focus events, Web Audio start/stop/suspend/resume, session URL, prompt progress, and draft values captured.
- Screenshots saved for each transition.
- No synthetic events used for physical-switching evidence.

## Scenario matrix

| Scenario                                | Status     | Result                                                                                                                            |
| --------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Chrome idle real tab switch             | passed     | Hidden at t=11 ms, visible at t=738 ms; loaded Home preserved; no skeleton or landing.                                            |
| Chrome idle app focus change            | passed     | Blur t=1631 ms, focus t=2498 ms; loaded Home preserved.                                                                           |
| Chrome idle desktop switch              | unverified | No new lifecycle events; no evidence the space changed.                                                                           |
| Safari idle real tab switch             | passed     | Hidden t=251 ms, visible t=1081 ms; loaded Home preserved.                                                                        |
| Safari idle app focus change            | passed     | Blur t=1988 ms, hidden t=2233 ms, focus t=2832 ms, visible t=2883 ms; loaded Home preserved.                                      |
| Safari idle desktop switch              | passed     | Visibility hidden at t=5213 ms after Control+Right; loaded Home preserved. Return-to-original-space visibility was not confirmed. |
| Chrome active check real tab switch     | passed     | Hidden t=2283 ms, visible t=3115 ms; audio suspended; “Check paused”; no automatic resume.                                        |
| Safari active check real tab switch     | passed     | Hidden t=2447 ms, visible t=3392 ms; audio stopped; “Check paused”; no automatic resume.                                          |
| Chrome active check app focus change    | unverified | Attempt blocked by a native confirmation dialog/renderer hang.                                                                    |
| Chrome Practice draft across tab switch | passed     | Textarea value `hello draft`, URL, and content preserved.                                                                         |
| Coverage-settle CTA trace               | passed     | Delayed evidence produced a transient partial CTA; real failure produced a persistent recovery CTA.                               |

## Active check details

### Chrome

- Session URL: `/en/morse/learn/session?check=KM&resume=sess_8f5b41e4-…`
- Initial playback: oscillator created/started; prompt `1 / 20`.
- Real tab hide: `visibilitychange` hidden; `suspend` logged; UI showed “Check paused”.
- Return: no new oscillator start; no automatic resume.
- Explicit “Resume check”: pause cleared; new oscillator started only after the user action.
- Reload: same `resume=` session identity and prompt `1 / 20` preserved.

### Safari

- Initial playback: `AudioContext.resume`, oscillator created/started; prompt `1 / 20`.
- Real tab hide: `visibilitychange` hidden; audio stopped; UI showed “Check paused”.
- Return: no automatic start; same session URL and prompt preserved.

## Practice draft

- Real Chrome tab hide/return preserved the textarea value `hello draft`.
- URL and page content were unchanged.

## Coverage-settle CTA trace

### Delayed evidence sync

```
t=0 ms:    Loading…, 1 skeleton
t=52 ms:   Refresh learning history (actionable)
t=1561 ms: Check your current recall
```

The evidence changes request started at 79 ms and took 1503 ms. The partial CTA appeared while the first evidence read was still pending.

### Failed evidence sync

```
t=0 ms:   Check your current recall
t=53 ms:  Refresh learning history (actionable)
```

The failed request returned 404 after 1507 ms. The recovery CTA persisted.

**Conclusion:** the unchanged-sync CTA swap is transient sync status, not genuine missing coverage. A pending first coverage read is currently presented as an actionable recovery state.

## Blocked or unverified

- Screen recording: `screencapture -v` failed and `ffmpeg avfoundation` did not produce a usable recording; macOS capture permission is blocked.
- Chrome desktop switching: no new lifecycle events; no evidence the space changed.
- Active desktop switch during guided/check playback: not executed.
- Active app-focus change during check playback: blocked by a native dialog/renderer hang.
- Guided introduction playback: not exercised; active check playback was used.
- Safari desktop return visibility was not confirmed.

## Proposed bounded packet

**Home pending-coverage CTA stability**

- Current behavior: a pending first evidence-sync read produces “Refresh learning history” for roughly the duration of the request, then switches to the recall CTA.
- Proposed change: distinguish “initial coverage still pending” from settled error/unavailable/pending/rejected coverage. Keep the recommendation area non-actionable or retain the previous settled recommendation while the first read is pending.
- Preserve: real errors, unavailable endpoints, rejected/blocked evidence, pending uploads, and coverage uncertainty must remain visible and actionable.
- Do not cache learning claims or change policy.

No fix was implemented in this packet.

## Language/URL timing

The previously observed language-content-before-URL transition was not changed. No user-visible defect reproduced in this packet; the 18 ms transient remains documented as a prior observation, not a new failure.

## Preserved artifacts

Directory: `.playwright-mcp/flashing-verification/`

Scripts:

- `scripts/chrome-lifecycle.mjs`
- `scripts/safari-lifecycle.mjs`
- `scripts/chrome-active-check.mjs`
- `scripts/chrome-active-focus.mjs`
- `scripts/safari-active-check.mjs`
- `scripts/chrome-practice-draft.mjs`
- `scripts/coverage-trace.js`
- `scripts/chrome-session-start.mjs`
- `scripts/chrome-eval.mjs`
- `scripts/chrome-dismiss-dialog.mjs`

Results:

- `results/chrome-lifecycle.json`
- `results/safari-lifecycle.json`
- `results/chrome-active-check.json`
- `results/safari-active-check.json`
- `results/chrome-practice-draft.json`
- `results/coverage-trace.json`
- `results/real-lifecycle-summary.json`

Screenshots include `21-…` through `36-…` in `screens/`.

## Checks

- `npm run verify`: exit 0; 70 test files, 887 tests passed.
- `npm run lint`: exit 0.
- `npm run build`: exit 0.
- `npx svelte-check`: 0 errors, 0 warnings.
- `git diff --check`: clean.
