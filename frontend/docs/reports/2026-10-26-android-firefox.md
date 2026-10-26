# Android Firefox without TalkBack — 26 October 2026

Scope: continue real-phone acceptance of implementation `2c1e3c1` using the existing
loopback preview and disposable guest history. No application code, design, backend,
deployment or dependency changed. Acceptance for this pass: audible K/M playback,
guided answer/feedback and interruption recovery, then completion with native touch
and the on-screen keyboard reflected in Home's saved history.

## Environment and method

- Xiaomi 2602EPTC0G, Android 16, Firefox 159.0; English interface, dark theme.
- `http://127.0.0.1:3001/en`, via the existing USB forwarding arrangement in the
  [Android guide](../android-acceptance.md). The remote stack remains `ac25e57`.
- TalkBack disabled at the user's request. A read-only Android service check
  returned `False`, exit 0, before this pass.
- Initial control used scrcpy 5.0.1 with a USB HID keyboard. The mirror was later
  restarted with keyboard and mouse disabled so the user could test native input.
  It was closed after evidence capture; the private preview remains available.
- Screenshots are local to this chat's visualization directory. They are real
  phone captures, not desktop responsive emulation.

## Observed results

| Check                     | Result and evidence                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home entry                | Skip to content and Start Lesson 1 were reachable with visible keyboard focus.                                                                                                                                                                                                  |
| Audio                     | The user confirmed both K and M tones were clear. Introduction playback exposed Listening, Sound played, Hear again and Continue states.                                                                                                                                        |
| Warm-up feedback          | Correct and incorrect answers showed text and icons; incorrect feedback offered both comparison sounds and explained that warm-up answers do not change mastery.                                                                                                                |
| Typed recognition         | A single typed character submitted automatically and produced scored feedback. This initial portion used the USB keyboard.                                                                                                                                                      |
| Pause/resume              | Explicit pause kept prompt 6; resume returned to the answer field. `android-firefox-paused.png`.                                                                                                                                                                                |
| Background/return         | Switching from Firefox to Android Settings and back paused the lesson at the same prompt, with an explicit Resume session action.                                                                                                                                               |
| Cancel exit               | Cancelling Leave this lesson retained prompt 7 and returned focus to Back. Subsequent keyboard navigation had the anomaly below; touch playback still worked.                                                                                                                   |
| Native touch and keyboard | With both virtual input devices disconnected, the user resumed at prompt 9 and confirmed completion without hidden typing or Continue/Finish controls. Keyboard application/version and composition language were not recorded, so this is not Japanese/Chinese IME acceptance. |
| Saved result              | After the user's completion, the phone showed Home with 2 completed sessions (previously 1), 13.4 recorded minutes and 64% lesson accuracy. `android-firefox-lesson-completed.png`. The long duration includes this interactive test; the score is synthetic test activity.     |

## Unresolved keyboard observation

After pause/background recovery, Tab sometimes alternated between Back and Pause;
Space did not start the next prompt. The behavior persisted after reconnecting the
mirror and removing its mouse capture. The user directly tapped Play sound and
confirmed playback; typing then submitted normally. A later Tab/Enter activation
also played a prompt, but the navigation anomaly recurred on the next prompt.

This is an unresolved Firefox/HID interaction, not an established application
defect or a keyboard-navigation pass. Native touch completion succeeded. Reproduce
with a directly connected physical keyboard, recording actual key/modifier events
and focus, before changing the shared session components. Local source inspection
did not establish a root cause; no speculative code fix was made.

## Checks and remaining coverage

This is an evidence-only increment: 0 new automated tests were run. The earlier
implementation verification remains 595 tests across 49 files, with verify/lint/build
exit 0, as recorded in the [timeout report](2026-10-26-request-timeout.md); those
commands were not repeated for this documentation change.

The Svelte diagnostic attempted during investigation exited 1 because `svelte.dev`
was unreachable. Automatic approval review rejected a network-enabled retry because
it might transmit private source to that service; investigation continued locally.
Prettier `--check` on the three changed guides and `git diff --check` both exited 0.
Before commit, `git status --short` listed only this report, the timeout report and
the audit guide. A final Android service check again confirmed TalkBack off, exit 0.

Still open: Practice with the native soft keyboard, Japanese/Chinese composition,
rotation and native text scaling, full TalkBack coverage, native account/timeout
and second-device sync, plus reproduction of the keyboard anomaly. The previously
blocked Penpot timeout frame remains pending; this pass changed no product visuals.
