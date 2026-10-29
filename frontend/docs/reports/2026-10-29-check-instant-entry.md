# Recall check instant entry — 29 October 2026

Implemented locally on `codex/opencw-instant-entry-verified`, created from local `main` at `25a526bba85b87176296bcdb0586bb401f5453cb`. The Desktop checkout already had 15 modified files for this packet; that work was preserved and completed. No commit, push, merge or deployment was performed during implementation verification; the user subsequently authorized committing to main and pushing.

## Approved target and resulting behavior

Authority: [Penpot page 10 · Recall check · Instant entry](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-dc28f0eee393), read through Penpot MCP, including the behavior/accessibility board and exported desktop, phone, dark, first-sound and optional-rules states. This supersedes the [countdown report](2026-10-29-check-direct-start.md).

**Choose check → first sound → answer.** Recommendations and individual-character actions validate the owner's recorded targets and start once, without a Start screen, countdown or mandatory rules. The entry gesture prepares a silent audio engine for transfer to the existing evidence engine; stale, mismatched and unused transfers are disposed. This hint is not required for session entry.

Direct URLs attempt playback on the same session surface. A durable checkpoint ID is added to the current URL with replacement navigation, so reload recovers the same frozen plan and session. Recovery stays paused until Resume; it retains the existing invalidation of interrupted first listens. A blocked browser or failed audio device leaves the prompt unanswered with a visible Play sound action. No unheard prompt advances or becomes valid evidence.

The active header contains progress, Save & leave and Pause. End check is inside Pause and retains confirmation. Browser Back also confirms before ending a check; cancellation retains the session. Dialog cancellation restores focus, and failed saves remain reachable after closing the confirmation. Optional native disclosures at entry and in Pause keep focus on their invoking summary and never start audio. Routine confirmed-save status appears once in Pause/results; saving, local failures and actionable sync attention remain immediate.

The single-character answer appears and receives focus after audio, preserving software-keyboard access without opening it before the first sound. Replay, Space/IME guards, Skip and the controller's timing, scoring and evidence rules remain intact. Subsequent prompts play once after accepted answers. Check-only styling follows existing warm/Forest tokens, visible focus, flat controls, 48px targets, 8px gaps and scrolling. Keyboard shortcut copy follows pointer capability rather than viewport width. German save labels wrap safely at 320px. All five source catalogs were updated and obsolete countdown keys removed. No backend contracts, schemas, scoring modules, dependencies or unrelated screens changed.

## Acceptance evidence

Browser testing used isolated Playwright Chromium contexts against `npm run acceptance` at `http://127.0.0.1:4174`, with its synthetic API and separate fixture databases. The bundled Node Playwright runtime was used because Python Playwright was unavailable; no dependency was installed. Audio used the native Web Audio engine with oscillator-start counting. Browser blocks, device faults, quota failures and deterministic visibility changes were injected explicitly.

**16 browser scenarios passed**, in three focused runs (10 + 4 + 2), each exit **0**:

- Recommendation entry, optional entry rules, one first playback, Replay/Space/IME guard, Skip and results with exactly 20 observations and one terminal record.
- Individual-character action, including rapid double activation: one plan and one playback.
- Direct entry and reload: unchanged session ID and prompt order, paused recovery and interrupted-prompt validity.
- Blocked audio and device failures: no unheard observations, same prompt recovery and invalid first-listen evidence after failure.
- Hidden during sound: paused; returning is silent; explicit Resume preserves interruption evidence.
- Save & leave/resume and another-tab session-lock rejection.
- Pause rules, focus restoration, End cancellation and browser Back cancellation without a terminal record.
- Save failure from confirmation: visible error, no false save success, retry and a distinct End action.
- Invalid, duplicate, unrecorded and mutually incompatible URL targets: no audio or assessment plan.
- Responsive matrix described below.
- Initial storage failure and safe retry without unheard observations.
- Hidden during delayed initialization: no sound on entry or visibility return; explicit Resume starts once.
- Account-owner change: session stops; no answer UI or cross-owner observations remain active.
- Routine save status hidden during recall; synthetic sync failure remains actionable.
- Clean unassisted completion: 20 valid, uninterrupted observations, zero replays, 20 playbacks, terminal `completed` and existing Check complete result.
- Blocked direct URL: same session surface, visible Play sound, zero unheard observations and same-session recovery.

The layout scenario covered **50 cases**: five locales × two themes × 320×720, 390×844, 768×1024, 1440×900 and 390×400. It checked horizontal overflow, control size, header overlap, touch shortcut visibility and scrolling to input/Skip. Screenshots were compared with Penpot; spacing, instruction copy, control styling and narrow German header wrapping were iterated. Representative screenshots: `/tmp/instant-verified-en-light-390.png`, `/tmp/instant-verified-de-dark-320.png`, `/tmp/instant-verified-en-light-1440.png`, `/tmp/instant-verified-blocked.png` and `/tmp/instant-verified-clean-results.png`.

Firefox received an additional manual tool-driven smoke pass: recommendation entry, answer surface, real tab switching during replay, silent return into Pause, End confirmation and cancellation restoring focus to End check. It used the separate acceptance databases. This was additional coverage, not a second full matrix.

## Required checks

Commands ran from `frontend/` with Node **26.12.1** on PATH and the repository's configured `PUBLIC_API_BASE` (`http://localhost:8080/v1`); acceptance overrides it with its synthetic local API.

| Check                                        | Exit | Evidence                                                                                                     |
| -------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `npm run verify`                             | 0    | **773 tests / 63 files**, message/SEO validation, zero Svelte errors/warnings, worker and script type checks |
| `npm run lint`                               | 0    | Prettier and ESLint                                                                                          |
| `npm run build`                              | 0    | Static adapter output generated successfully                                                                 |
| Svelte autofixer on all 7 changed components | 0    | No issues; existing dialog effect/binding suggestions reviewed                                               |
| Browser runs                                 | 0    | 16 scenarios, including 50 layout cases                                                                      |
| `git diff --check`                           | 0    | No whitespace errors                                                                                         |

Logs and harness are disposable `/tmp/instant-verified-*` artifacts, including `final-verify.log`, `lint.log`, `final-build.log`, `analyzers.log`, `browser.log`, `extra-browser.log`, `completion-browser.log` and `browser.mjs`. Earlier exploratory selector failures and the unused-message/type-check failures were corrected; the results above are the final passing runs. Backend and operational commands were outside this frontend packet and were not run.

## Remaining limits and local state

Physical iOS/Android devices, native screen readers, native 200% browser zoom and live authenticated synchronization were not verified. The iOS Simulator follow-up below adds native Mobile Safari and software-keyboard coverage. Neither desktop touch emulation nor the iOS Simulator replaces physical-device testing. Chromium's successful direct-autoplay case used an explicit allow policy; blocked cases used rejected audio preparation. Firefox provided real tab-visibility coverage. Temporary screenshots/logs may disappear.

`git status --short` was captured after implementation and documentation: 18 modified tracked files and this new report (19 uncommitted paths). It contains the five message catalogs, two audio files, two gesture-transfer files, seven Svelte components/routes, the handoff, the superseded report and this report. Existing changes were preserved. No commit, push, merge or deploy had been performed at that verification snapshot.

## iOS Simulator follow-up — 29 October 2026

Used **Xcode 27.1 (27A9275)** and its Device Hub simulator UI with a newly created **iPhone 17e / iOS 27.0 (24A434)**, named `OpenCW Disposable iPhone`, UDID `BE2A2864-D573-49E7-BDF2-72ECA22DFD29`. Existing simulator devices were not erased or changed. Native taps, software-keyboard keys, Safari reload/Back and the iOS Home control drove the tests. Safari WebDriver could not discover a matching simulator host; no remote-automation security setting was weakened.

The unchanged acceptance server supplied synthetic data. A temporary local proxy at `127.0.0.1:4178` observed real AudioContext/oscillator starts, read only the fixture evidence database and provided a quota-failure switch. It did not change production sources or install dependencies. Foreground-tab telemetry was kept separate from background tabs. Early proxy setup and first-use iOS keyboard-tip interruptions were harness issues; the verified outcomes below followed successful setup.

The simulator found and fixed a **portrait software-keyboard defect**: Safari panned the document and hid Pause / Save & leave. Check sessions now fit the visible viewport, keep the header outside the scrolling prompt stage, retain safe-area padding and compact spacing, and keep the focused answer/instruction visible. Viewport changes are applied after layout; listeners and animation frames are cleaned up. Other session modes retain their shared layout. Desktop regression coverage was repeated after these changes.

**10 native check scenario groups passed**, with one explicit landscape limitation:

1. Recommendation entry starts its first sound without Start/countdown/another Play; the software keyboard appears after the sound. Header and answer/instruction remain visible in portrait; prompt content scrolls independently.
2. Reload retains the same checkpoint/plan and returns paused; Resume starts once and retains interrupted first-listen invalidation.
3. Backgrounding Safari during Replay through the actual iOS Home control pauses; returning remains silent. Optional Pause rules open/close without playing.
4. Native Safari Back opens confirmation; cancellation retains the same check and creates no terminal record.
5. Injected quota failure during Save & leave stays on the session, shows retry and no false saved success; retry followed by Save & leave retains the checkpoint.
6. Continue saved session on Lessons restores the same check paused; explicit End records abandonment and removes its checkpoint, independently of Save & leave.
7. A direct URL under **normal iOS autoplay policy** reaches Play sound with zero oscillator starts and no unheard observation; a native Play tap recovers the same prompt.
8. K's individual-character action starts exactly one sound without another Play tap.
9. A full character check completed through **14 native keyboard answers**: 14 valid, uninterrupted observations, zero replays, 10/10 target first-listen correct, and one `completed` terminal record. No duplicate sound or observation was recorded.
10. Unrecorded targets show recovery with zero audio; native Skip records a skipped observation and advances once. Rotation back to portrait preserves the active session and usable keyboard/header geometry.

Additional native smoke coverage passed: returning Home, Lessons and saved-session access, Progress Overview/Characters, the native character disclosure, More navigation, Practice playback → transcription entry → saved comparison result, Settings, native theme/language selectors, and German dark appearance. This is not exhaustive testing of the forum, authentication or every app feature. Live API features were outside the synthetic environment.

### Open findings and limits

- **Landscape with expanded Safari tab chrome plus the software keyboard leaves only 36 CSS pixels of page content on this iPhone.** The check header/input cannot fit there; dismiss the keyboard or return to portrait. This case is not a passing layout claim. A fresh landscape surface without the keyboard and return to portrait were checked. A complete solution needs a separate decision about the short-landscape input experience.
- Progress's existing landscape page content can extend beneath the side notch. Check-header safe areas were corrected; unrelated Progress layout was not changed in this packet.
- No iPad, second iOS runtime, physical-device acoustics/autoplay, VoiceOver, native 200% zoom or live authenticated sync matrix was completed. Simulator audio evidence confirms scheduling and validity records, not subjective speaker quality.

Final frontend gates after the simulator changes: `npm run verify` **exit 0, 773 tests / 63 files**, zero Svelte errors/warnings; `npm run lint` **exit 0**; `npm run build` **exit 0**; Svelte autofixer **exit 0, no issues**; `git diff --check` **exit 0**. The final desktop browser regression **exit 0: 16 scenarios**, including 50 layout cases. Native results and assertions are in `/tmp/instant-ios-results.json` and `/tmp/instant-ios-evidence/`; representative captures are `keyboard-fixed.png`, `direct-blocked.png`, `save-failure.png` and `native-complete.png`. These temporary artifacts may disappear. Required gate logs use `/tmp/instant-ios-{verify,lint,build}.log`.

Before publication, git status recorded **18 modified tracked files and one untracked implementation report**. The new simulator was shut down; its saved test data and evidence were preserved. At the user’s request, the acceptance server was restarted and the internal browser received an additional recommendation-entry and Pause smoke check using disposable data. The check remains available for manual testing. The user subsequently authorized committing this packet to main and pushing; deployment remains outside this packet.
