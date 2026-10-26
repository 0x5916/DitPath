# Complete app design coverage — 26 October 2026

Design coverage is complete for the existing app at implementation `2c1e3c1`.
The [manifest](2026-10-26-complete-design.json) records 52 editable boards in the
new **Complete app · design coverage** page: 49 UI references, a starting index,
a shared-state library, and recovery/completion contracts. This is a design and
documentation increment; application behavior and deployment are unchanged.

Saved Penpot version: **Complete app design coverage · 2c1e3c1 · final link audit**, revision 111,
26 October 2026 at 09:02:28 UTC. The saved version was read back successfully.
Start from the [screen index](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=21101970-335a-8004-8008-d91319cd3c14).

## Acceptance and coverage

- Every implemented page and the shared error route has an editable reference or
  an explicitly linked reference on the existing Daily training page.
- Normal, empty, loading, error, cancellation and recovery presentation is covered
  by screen examples and shared-state contracts. Repeated combinations reuse those
  contracts rather than duplicating every page/theme/locale permutation.
- Guided prompt/result references use the current components, labels and hierarchy.
  They supersede the older **Guided lesson · interaction study** as current UI
  references; that historical study is preserved.
- Shared warm neutral/Forest surfaces, typography, spacing, status icons, focus,
  native disclosure affordances and responsive layouts remain consistent with code.
- Board IDs, source revision, prototype limits and verification are recorded in the
  repository. Design completion does not close native-device or live-sync acceptance.

| Route / surface         | Design coverage                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                     | New learner and interrupted work; returning learner remains on Daily training                                                                                         |
| `/morse/learn`          | Interrupted restart guidance and completed course; normal lesson selection on Daily training                                                                          |
| `/morse/learn/session`  | Introduction/unlocked start, warm-up choice, recall, partial group, listening, correct/mistake comparison, audio error, pause and exit confirmation                   |
| Guided results          | Next, repeat, weak sounds, insufficient evidence, unmeasured, course completion, saving, failed-save retry and response-time tip                                      |
| `/morse/practice`       | Current entry; copy, review, saving/retry, replacement and departure remain on Daily training                                                                         |
| `/morse/progress`       | Completed course; empty/populated history and desktop presentation remain on Daily training                                                                           |
| `/settings`             | Complete account form, verified/unverified email, verification code, cache confirmation, advanced preferences; independent timeout recovery remains on Daily training |
| `/profile`              | Guest/account history and habits, tablet layout, clipped horizontal heatmap                                                                                           |
| `/morse`, `/more`       | Morse reference and supporting navigation                                                                                                                             |
| `/login`, `/register`   | Current forms; pending/error behavior in shared states; German narrow registration                                                                                    |
| `/forum`, `/forum/[id]` | List, empty category, guest composer gate, reading, signed-in compose and reply forms                                                                                 |
| `/about`, error route   | Supporting content with synthetic author, 404/recovery layout                                                                                                         |

Responsive references include 320px English recovery and German registration,
390px phone screens, 768px Profile and 1280px results. Dark results supplement the
existing dark Practice and timeout frames. These are representative layouts;
the [guided/daily acceptance record](2026-10-26-daily-training-ui.md) owns the
broader locale/theme evidence.

## Source fidelity and prototype limits

Current routes were rendered in a temporary loopback preview with synthetic
read-only account/Forum fixtures. Lesson prompt and result variants rendered the
existing components with explicit synthetic props. They establish visual coverage,
not new scoring, saving, audio or authentication test evidence. A temporary fixture
entry was removed, its preview stopped, and its browser tab closed after capture.

Captured geometry was converted to native editable text, shapes and SVG icons.
The review corrected text wrapping, hidden disclosure content, heatmap clipping,
native disclosure/select markers, long Forum preview text and category destinations.
Long mobile frames place the fixed navigation at the bottom of the reference;
Penpot does not simulate the application's scrolling viewport.

The new page contains 215 navigation links and one link to the existing Daily
training page. Section links, supported route navigation, selected cancellation
and successful result-save retry are modeled. Each board is an independent
synthetic example; account state and session state do not persist between boards.
Unrepresented category filters, nested scrolling, disclosures, forms, live audio,
typing, native selectors and asynchronous outcomes require the running app.
The older page's prototype scope and source revisions remain in its
[own manifest](2026-10-26-daily-training-design.json).

All learner history, email and Forum content is synthetic. Automatic approval
review blocked an About transfer containing personal author details and a GitHub
destination. The accepted replacement uses a clearly labeled synthetic author
paragraph and omits external profile/source destinations. No real posts, credentials
or personal activity were sent to the design file.

## Verification

| Check                  | Result                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Penpot file validation | 0 errors                                                                                                                  |
| Interaction graph      | 215 navigation links; 0 broken destinations; 0 self-links                                                                 |
| Text bounds            | 1,218 text layers checked; 0 board overflows, respecting heatmap scroll masks                                             |
| Render review          | Index, shared states/contracts, Home, Settings, Profile, lesson comparison and result recovery inspected as exported PNGs |
| Saved version          | Label and creation timestamp verified by reading version history                                                          |
| Application tests      | 0 new tests; no application code changed; prior 595 tests / 49 files remain the implementation baseline                   |

The board/hotspot audit also found 0 overlapping boards and 0 navigation hotspots
outside their frames, after correcting two long-page footer hotspots.

This is a structural graph and rendering audit, not a new prototype-viewer
click-through. Final documentation checks and working-tree status are recorded
below. The exported overview is `penpot-complete-app-index.png` in this chat's
visualization directory.

Documentation verification: manifest validation (52 unique board IDs, source/version
fields and three manifest links), Prettier on the four changed documentation files,
and `git diff --check` each exited 0. Application test count for this increment is 0.
Before commit, `git status --short` contained only the new report/manifest and the
updated Daily training manifest/audit guide. The temporary preview was deliberately
stopped with SIGINT (exit 130); its repository fixture was removed. No application
or deployment files are included in this increment.

## Remaining acceptance

Design coverage is closed. Native testing remains as recorded in the
[Android Firefox report](2026-10-26-android-firefox.md): guided touch/soft-keyboard
completion and clear Morse audio were confirmed; Practice soft-keyboard/IME,
full TalkBack, iOS first-tap audio, native scaling and the mirrored-keyboard anomaly
remain open. Genuine second-browser-profile synchronization remains separate from
the completed [isolated live-sync checks](2026-10-26-live-sync-acceptance.md).
These gaps do not require speculative new design or new backend behavior.
