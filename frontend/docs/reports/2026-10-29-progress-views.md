# Progress views — 29 October 2026

Implemented the saved compact Progress design from Penpot page 09. Overview, Characters and History use URL-backed navigation. Character status filters use shallow URL updates, retain focus, and survive switching views. Continuous character lists use a desktop scroll region and normal mobile page scrolling with a sticky filter; short desktop windows use document scrolling.

Character records have a heading, matching count, native status selector, inline milestone details, Lucide chevrons, and a filtered empty state with an All action. Current recall remains separate from past attainment. Existing history filters and records are retained. New strings cover all five locales. No backend or dependency changes.

Verification: `npm run verify`, `npm run lint`, `npm run build`, and `git diff --check` exit 0. Verify includes 768 tests in 62 files, with zero Svelte errors/warnings. Svelte analyzer reports no issues; two element-binding suggestions were reviewed. Public API base was supplied only to the command environment.

Browser coverage: 40 combinations across five locales, both themes, and 320/390/768/1440 widths, exercising view changes, filters, URL persistence, overflow and desktop scroll restoration. A filter/navigation race discovered during testing was corrected using shallow URL updates and a function binding. Screenshots were reviewed for narrow and desktop layouts. Evidence is in `/tmp/progress-final-*.log` and `/tmp/progress-final-*.png`.

Limits: native screen readers, real-device touch, authenticated sync and native browser zoom were not tested. Native select appearance and authoritative translated evidence labels differ from the illustrative Penpot text. Earlier saved-session and scoring checks remain covered by existing tests; this packet did not change those operations.

Prior uncommitted work preserved. No commit, push, merge or deployment.
