# Top navigation implementation — 28 October 2026

Implemented the approved Penpot desktop navigation as a separate presentation packet. Desktop exposes Lessons, Practice, Progress and Forum. The logo returns Home; account actions and the footer retain their destinations. Mobile retains its icon navigation and More page, now below the design's 960px breakpoint. Account labels become icon-only from 960–1199px.

The bar aligns with the 1120px Lessons content. Links use content-sized targets and consistent gaps; current-section underlines are separate from hover and keyboard focus. The account dropdown has a full, wrapping identity label. Existing account handlers, hover behavior, keyboard navigation, persistence and authentication semantics remain unchanged. Existing translated Login/Register/Logout labels and Lucide icons remain authoritative.

## Verification

- `npm run verify`: exit 0; 768 tests in 62 files; Svelte check 0 errors and warnings. Navigation tests cover direct desktop Forum and preserved mobile More grouping.
- `npm run lint`: exit 0.
- `npm run build`: exit 0.
- Svelte analyzer on layout and Dropdown: exit 0, no issues. Suggestions concern existing lifecycle/authentication effects, focus references and an existing compiler-specific lint suppression. These were reviewed and retained rather than changing authentication or focus behavior in this design packet.
- Browser matrix: exit 0; 65 checks covering five locales, two themes, widths 320/768/959/960/1199/1440, no horizontal overflow, desktop/mobile switching, menu Enter/arrow/Escape focus handling, direct navigation and active states.
- Synthetic account checks: exit 0; five checks covering long-name wrapping, outside-click close, focus return, compact account access and Home/End menu navigation. No real credentials or account changes.
- Screenshot review: English/German, both themes and compact/full desktop; evidence under `/tmp/nav-qa/`.
- `git diff --check`: exit 0; working-tree status captured. No commit, push or deployment.

Initial browser failures came from a stale preview process serving old asset references; restarting the preview resolved them. The initial synthetic identity had an expired/malformed test token and reverted to Guest; a structured local test token with intercepted API requests exercised the intended signed-in UI.

Real authenticated sync/logout, native screen readers, real-device testing and actual browser 200% zoom were not exercised. A 720px viewport checked the responsive layout equivalent to a 1440px window at 200%, not native browser zoom itself. Earlier homepage and Lessons changes remain untouched in the working tree.
