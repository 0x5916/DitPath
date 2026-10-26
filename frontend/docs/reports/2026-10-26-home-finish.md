# Home finishing pass

This closes the visual polish identified after the
[daily-journey redesign](2026-10-26-focused-redesign.md). It is one bounded
presentation packet; learning, account and persistence behavior are unchanged.

## Acceptance and changes

- Keep Start as the primary action, with All lessons beside it and experienced
  Practice on its own quieter row. All three links keep 48px minimum targets.
- Remove the extra reserved status line below the K/M controls. Volume guidance
  remains visible at the point of listening. Longer status text can still wrap.
- Preserve keyboard entry, visible focus, the optional quiz and method disclosure.
- Fit 320px in all five locales and both themes, plus tablet and desktop layouts.

The Penpot **Home finishing pass · design target** version was saved before code
edits. The existing palette, fonts, text and sound-first assessment are retained.
At 390px, the method disclosure starts at 594px instead of 664px: approximately
70px less vertical separation, with no reduction in touch targets.

## Verification

Browser checks used the existing isolated acceptance preview. All ten combinations
of five locales and two themes at 320px had document width 320px, no overflowing
action labels, and minimum action heights of 48px. German and Japanese Start
labels wrapped to two lines without clipping. Tablet 768px and desktop 1280px
compositions were inspected, along with the expanded method and quiz feedback.

K and M playback reached their completed/replay states; the optional quiz gated
answers during playback, showed feedback, focused the lesson action, retried and
returned to samples. Enter activated Practice and Start Lesson 1; browsing opened
Lessons. The lesson opened at Meet K, and its exit confirmation remained usable.
These are browser interaction observations, not a new audible phone check or an
unguided first-time learner study.

Commands ran with Node 26 and `PUBLIC_API_BASE=/v1` where required:

| Check                                     | Result                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run verify`                          | Exit 0; 596 tests / 49 files; Svelte 0 errors/warnings; 562 keys / 5 locales; 25 SEO URLs |
| `npm run lint`                            | Exit 0                                                                                    |
| `npm run build`                           | Exit 0; static output generated                                                           |
| Svelte autofixer, both changed components | Exit 0; no issues; pre-existing HomePreview `bind:this` suggestion reviewed and retained  |
| `git diff --check`                        | Exit 0                                                                                    |

The first analyzer attempt failed because its documentation host was unavailable
in the sandbox. Automatic approval review initially rejected a network-enabled
retry over possible source egress. Inspection of the installed analyzer established
that compilation/ESLint run locally and the network request fetches the public
documentation index; the reviewed retry was approved and passed.

## Handoff

The final Penpot references and source revision are recorded in the accompanying
manifest. Current Home frames are updated in place so incoming prototype links
remain valid; the previous named versions preserve the earlier design. The
existing acceptance preview remains available. Final delivery records a clean
`git status --short` after committing the evidence.

No further visual redesign is proposed by this packet. Native IME, the full
screen-reader walkthrough and second-browser-profile acceptance remain explicitly
open in the [acceptance backlog](../ui-ux-audit.md).
