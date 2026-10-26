# Android Chrome and TalkBack acceptance

Use a real phone with disposable data. Record the phone model, Android version,
Chrome version, TalkBack version, keyboard/language, tested Git revision and date.
Keep actual outcomes separate from this checklist; desktop viewport simulation
does not count as a native pass.

## Private USB preview

The frontend build under test runs on the Mac, with `/v1` proxied through SSH to
the [isolated API](../../DEPLOYMENT.md#isolated-ui-acceptance-stack). The remote app
revision is unchanged. No public tunnel, email integration or production account
is needed. Build from `frontend/` with Node 26: `PUBLIC_API_BASE=/v1 npm run build`.

1. Install tools if needed: `brew install --cask android-platform-tools`.
2. Connect USB, enable Developer options → USB debugging, and approve this Mac
   on the unlocked phone. Run `adb devices -l`; continue only when the chosen
   device says `device`. If several appear, select its exact serial below.
3. Keep the SSH forward running: `ssh -N -L 127.0.0.1:8081:127.0.0.1:8081 pve-104`.
4. From the repository root, keep the preview running:
   `python3 scripts/acceptance-stack/preview.py --build frontend/build`.
   Port 3001 must be free; do not overwrite an existing listener.
5. Run `adb -s SERIAL reverse tcp:3001 tcp:3001`, replacing `SERIAL` with the
   selected device. Verify with `adb -s SERIAL reverse --list`, then open
   `http://127.0.0.1:3001/en` in **Chrome on the phone**.
6. Use guest mode for audio/typing checks. For sync, sign into an existing
   disposable account privately; never paste passwords into the report.

USB forwarding carries the phone's loopback traffic to this Mac. See Google's
[USB setup](https://developer.android.com/tools/adb#Enabling) and
[Chrome port forwarding](https://developer.chrome.com/docs/devtools/remote-debugging/local-server).
After testing, remove only this mapping with `adb -s SERIAL reverse --remove tcp:3001`;
stop the preview/SSH sessions and turn off USB debugging if no longer needed.

## Walkthrough and result log

For TalkBack, enable **Settings → Accessibility → TalkBack → Use TalkBack** and
configure its shortcut so you can turn it off. Swipe right/left to move focus,
double-tap to activate, and use two fingers to scroll. Device-specific shortcut
details are in [Google's TalkBack guide](https://support.google.com/accessibility/android/answer/6007100).

| Check                                                                           | Expected result                                                                                                         | Actual result |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| First visit → K/M audio → complete a guided lesson                              | First-tap audio works; playback does not overlap; answers and feedback are reachable                                    | Pending       |
| Practice with soft keyboard; English and available Japanese/Chinese composition | No submission mid-composition; Check stays visible; keyboard dismissal preserves the copy                               | Pending       |
| Rotate, enlarge text, switch theme, background and return                       | No clipped actions or lost copy; playback/interruption state is truthful                                                | Pending       |
| TalkBack: Home → lesson → Practice result → Progress → Settings                 | Logical names/order; dialogs receive and restore focus; results/errors are announced; Source disclosure and Finish work | Pending       |
| Timeout, then retry                                                             | Loading ends; Settings explains timeout; saved history remains; Retry restores settings and sync                        | Pending       |
| Second-device account history                                                   | Phone receives the desktop result once; A/B history remains separate                                                    | Pending       |

For a controlled timeout, launch the preview with `--stall-file /private/tmp/ditpath-stall-api`.
Creating that file delays local API requests for 30 seconds; the frontend's 15-second
deadline should win. Remove the file before **Try again** / **Sync now**. Airplane mode
alone does not cut the USB route. Log observed wording/focus and any failing step;
do not mark pending rows passed without a real-phone walkthrough.
