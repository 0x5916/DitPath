# OpenCW manual acceptance checklist — 2026-11-04

Use this only for rows that cannot be completed with the local disposable backend and automated browser. Do not record a row as passed without the stated observation.

## A. Penpot design reconciliation and sign-off

Design reconciliation is complete through the Penpot MCP plugin. The pre-edit version is `OpenCW · 2026-11-04 · pre recall design reconciliation`; the post-edit version is `OpenCW · 2026-11-04 · recall workflow reconciliation complete`.

Completed review:

1. Opened file `41725af0-a889-809a-8008-d8302a5aefb6`, page `Learning`.
2. Added the `Recall & Review` section with boards 20–25: returning Home, desktop Recall, mobile Recall, mobile More, the navigation-label decision, and the decision specification.
3. Updated Design system desktop navigation boards 10 and 11 to include `Recall` between Lessons and Practice, and added the `Recall & Review` link to the Lessons first-visit board 01.
4. Confirmed Home hierarchy: Guided Lessons is the only accented primary action; Recall & Review is a bordered secondary action; Practice and Morse table remain secondary.
5. Confirmed desktop navigation: visible label `Recall`, page title and accessible name `Recall & Review`. Approved by Alan on 4 November 2026.
6. Confirmed Recall hierarchy: profile/coverage, recommendation, due review, attainment, screening.
7. Confirmed status placement: coverage uncertainty stays on Recall; permanent-rejection diagnostics and repair stay in Settings → Learning evidence, with affected History rows labelled.
8. Confirmed mobile discovery: keep Home / Practice / Progress / More; Recall & Review remains a full-label More entry and More stays active on `/morse/review`.
9. Ran `penpot.currentFile.validate()`: 0 errors. New board bounds do not overlap.

Remaining user action:

1. Review the post-edit Penpot version against the implemented Home, Recall, mobile More and navigation surfaces.
2. Reply with design sign-off, or concrete changes. Design reconciliation alone is not final sign-off.

Acceptance: an authorized reviewer signs off the post-edit version or records concrete changes. The label decision is already recorded; the rest of the version still needs final review.

## B. Spoken screen-reader journey

Required user action: run on a machine with VoiceOver, NVDA or TalkBack enabled; provide the spoken result, not only the accessibility tree.

1. Home: verify one page heading, both journey names, and only one primary action are announced without duplicate verbosity.
2. Open Recall & Review. Verify recommendation, due review, attainment counts, screening, and coverage uncertainty are understandable; empty/partial states must not sound like failure or proficiency.
3. Start a check from Home with the screen reader active. Verify focus, progress `1 / N`, prompt instructions, Space replay, Enter submit, and that background sync does not speak over the assessed sound.
4. Pause, Save & leave, reload, and resume. Verify announcements and focus on the paused/recovery state; no automatic audio restart.
5. Open the exit dialog. Verify initial focus, contained Tab/Shift+Tab, Escape/cancel, and focus restoration.
6. Progress → Characters: expand a corrected character and verify `Proficiency`, `Retention`, and `Earlier claim needs verification` are spoken in context.
7. Settings: verify training-history and learning-evidence status are distinguishable, and `Sync now` is reachable and announced.

Blocked row remains blocked until the actual spoken output and any defects are recorded.

## C. Physical-device behavior

Required user action: run on at least one real iPhone/Safari and one Android/Chrome device. Emulators and resized desktop viewports do not satisfy this row.

1. First-tap audio: open Home, tap the recall action, and verify sound starts from that gesture. If blocked, verify the visible `Play sound` fallback and no double playback.
2. Guided introduction: open Lesson 1, tap `Listen to K` and `Listen to M`; verify audible full sounds, Continue only after completion, and no automatic replay.
3. Background/return: send the app to the background during a prompt; verify it pauses, does not auto-resume, and resumes only after the explicit action.
4. IME/software keyboard: type Japanese and Chinese composition through the device IME; verify composition does not submit early, Space does not scroll while replaying, and Enter submits only after composition ends.
5. Layout: check 320/390 CSS px equivalents, short landscape, notch/safe areas, software-keyboard clearance, touch targets ≥44px, and native text scaling/200% zoom.
6. If permitted, record the screen while exercising autoplay, pause, resume, and guided introduction.

Record device, OS, browser, IME, and audible result. A visual audio indicator is not audible-playback evidence.

## D. Remaining desktop-switch scenarios

Required user action: perform real macOS desktop/window switches, not synthetic `visibilitychange` events.

1. Chrome macOS: start an active check, switch Spaces away, wait, return to the original space. Record visibility/focus events, audio start/suspend/resume events, UI state, and whether audio resumed without an explicit action.
2. Safari macOS: repeat. Explicitly confirm whether the original space becomes visible on return; a hidden event followed by no observable return is unverified.
3. App focus change: Cmd+Tab away during guided introduction playback and during an active check. Record pause state and absence of auto-resume.
4. Guided introduction in a visible browser: repeat `Listen to K/M → Continue` after a desktop switch; verify no duplicate audio and no lost prompt.
5. If macOS screen recording permission is available, capture the sequence. If not, record timestamped screenshots and state that recording is unavailable.

A desktop switch that produces no lifecycle events is **unverified**, not passed.

## Already completed in automation

- Same-owner token renewal with pending writes and a saved checkpoint: passed.
- Guided introduction playback in visible Chrome: passed.
- Real server milestone correction with UI update: passed.
- Disposable PostgreSQL and race suites: passed.
- Two-profile sync, isolation, offline recovery, permanent rejection, active-check pause/resume, Safari navigation focus, widths, locales, offline shell: passed.
