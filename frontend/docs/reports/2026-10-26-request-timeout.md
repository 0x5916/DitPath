# Request timeout and Android setup — 26 October 2026

Implementation milestone: `2c1e3c1`. Acceptance: terminate stalled API transport/body
reads, keep credentials and pending history, expose recovery, fence late responses
to the captured account, and verify retry without duplicate sessions.

## Delivered behavior

- [`fetchApiResponse`](../../src/lib/request-timeout.ts) bounds each non-streaming
  API exchange, including response-body reading, to 15 seconds. It aborts transport,
  settles even an uncooperative request, and removes its timer/listener. Existing
  HTTP status, error codes, Retry-After and account fences remain intact. A workflow
  with a successful refresh followed by another exchange can take longer overall.
- Timeout during refresh preserves credentials; a late login/refresh cannot commit.
  Settings shows **The server took too long to respond. Please try again.** with its
  existing **Try again** action. All five translations are included.
- Sync preserves pending records and the recovery notice during retries. A timeout
  leaves at least 15 seconds for manual retry before automatic backoff resumes.
- A loopback preview serves the new static build against the existing isolated API.
  The remote deployment remains `ac25e57`; no backend/schema/authentication contract
  or external dependency was added. See the [USB walkthrough](../android-acceptance.md).

## Verification

| Check                                                          | Result                                                                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_API_BASE=/v1 npm run verify`                           | Exit 0; 595 tests / 49 files; 568 message keys / 5 locales; Svelte 0 errors / 0 warnings                                                              |
| `npm run lint`; `PUBLIC_API_BASE=/v1 npm run build`            | Both exit 0                                                                                                                                           |
| Svelte autofixer on `training-sync.svelte.ts`                  | Exit 0; no issues or suggestions                                                                                                                      |
| Python preview syntax; `git diff --check`                      | Both exit 0                                                                                                                                           |
| Browser stalled API → retained Practice save → timeout → retry | Passed in desktop Chromium against disposable account A; server history increased from 5 to 6 unique records, zero duplicates                         |
| English/dark and German/light recovery, including 320px width  | Error and recovery actions visible; German document width and scroll width both 320px                                                                 |
| Homebrew Platform-Tools installation / USB forwarding          | Exit 0; Platform-Tools 37.0.1; Android 16, model 2602EPTC0G, Firefox 159.0; Chrome 155.0.8059.84 installed but not tested; TalkBack 17.1.0.1003738110 |

The first focused combined run passed 63/64 tests; its runtime test counted an
unrelated timer. The revised test verifies behavior instead: manual recovery cancels
the scheduled automatic retry. It passed (4/4 runtime tests), followed by the full
595-test run. Browser checks used a local 30-second transport stall, then removed
the stall before retry. Captures are `request-timeout-phone.jpg` and
`request-timeout-german-320.jpg` in this chat's visualization directory. A committed
upload with a lost response is covered separately by the idempotent-retry test.

## Design and native acceptance status

Penpot synchronization is pending: its MCP repeatedly reports no connected instance.
The existing file in desktop Firefox shows “Connection lost. Retrying to save your
changes.” Reconnecting through both connection menus did not restore access. No new
timeout frame or named design version is claimed. Preserve the existing Settings
hierarchy, inline alert, retained-history notice, and separate Try again / Sync now
actions. Add a timeout recovery frame and prototype retry to the normal Settings frame;
label the 15-second deadline as a design note, not product copy.

USB mapping `tcp:3001 → tcp:3001` is active, and the phone preview is
`http://127.0.0.1:3001/en`. Firefox 159.0 on the real Android 16 phone passed
K/M playing/completed UI states and **Practice → type KMK → Enter → saved result →
expand Source → Finish → Home** with one completed session. Keyboard focus remained
visible; tabbing to Finish scrolled the expanded result dialog to the action. Capture:
`android-firefox-practice-saved.png` in this chat's visualization directory.

Control used scrcpy 5.0.1 and temporary USB HID keyboard input because the default
SDK input was rejected with INJECT_EVENTS permission errors. No phone security
setting was changed. This does not establish soft-keyboard, IME or touch acceptance.
The first K/M run was muted; the user confirmed clear tones in the subsequent
[Firefox walkthrough without TalkBack](2026-10-26-android-firefox.md).
TalkBack 17.1 was enabled after explicit approval, Android confirmed
the running service, and the user confirmed audible speech. With its enhanced
keymap, Action+Right focused the Progress heading, summary heading and completed-
sessions help control; Action+Space opened and closed the explanation. Capture:
`android-firefox-talkback.png`. This is a setup/basic-interaction check, not a full
spoken-label or touch-gesture walkthrough. TalkBack was then disabled at the user's
request and its service was verified off. The subsequent walkthrough records
guided-lesson completion using native touch and the on-screen keyboard, alongside
an unresolved mirrored-keyboard anomaly. Full TalkBack, Practice soft-keyboard,
Japanese/Chinese composition and second-device account sync remain open.
The implementation commit left `git status --short` empty. Capture it again after
the final evidence/design synchronization commit.
