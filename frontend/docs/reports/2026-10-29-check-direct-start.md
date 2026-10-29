# Recall check direct start — 29 October 2026

Superseded by the verified [instant-entry implementation](2026-10-29-check-instant-entry.md). The countdown behavior and counts below are historical evidence.

Penpot page **10 · Recall check · Direct start** was saved before implementation. The recommendation entry shows its targets, computed prompt count and speed. An ordinary Start check click carries an exact-URL, expiring, memory-only intent into the session and begins a cancellable three-second countdown. Countdown completion starts the existing first prompt. Direct URL loads and reloads require Start. Modified/new-tab links do not arm an intent. Hiding the document cancels a pending countdown; component teardown clears its timer.

Long assessment explanations now sit in “How checks work”. Existing result criteria, evidence storage, recovery and exit handling remain intact. Character-specific links retain explicit start at the destination; this shortcut applies to the shared recommendation action.

Final checks: verify exit 0, **770 tests / 63 files**, zero Svelte errors/warnings; lint/build/diff-check exit 0. Two focused tests cover single-use, exact-match and expiration behavior. Svelte analyzers found no issues; existing binding/orchestration suggestions were reviewed. Browser exit 0: five flows cover recommendation-to-countdown, cancellation, reload safety, rules disclosure and countdown-to-first-prompt. The final prompt displayed Replay sound without another Play action. Screenshots: `/tmp/check-countdown.png`, `/tmp/check-active.png`; logs `/tmp/check-start-*.log`.

Browser testing used isolated synthetic local data at 390px. Physical-device audio/autoplay restrictions, native screen readers and all-language visual matrices were not tested in this packet. Existing audio recovery remains available if playback fails. No backend or dependency changes. Prior uncommitted work preserved; git status captured. No commit, push, merge or deploy.
