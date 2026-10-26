# Listening-first Home

The first-time Home page now introduces Morse through a small listening
experience. This replaces the earlier action-first composition. Returning-user
Home, learning rules, audio behavior and other routes are unchanged.

## Design and acceptance

The Penpot **Home · listening-first** page contains a direction board and phone
proposal created before implementation, followed by seven editable references
from commit `6d70771`.

- Shorten the introduction and explain the K/M experiment in all five locales.
- Put the introduction, listening panel and lesson entry in that DOM order.
  Desktop places the introduction and entry beside the listening panel.
- Group sound controls in a warm neutral inset, retaining the existing Forest
  palette, typography tokens and flat surfaces. Larger screens use 192px sound
  controls; phones retain 128px controls.
- Keep Start Lesson 1 prominent, with browse beside it and Practice beneath.
  Method details remain optional and keyboard-operable.
- Preserve sample playback, quiz gating, feedback, retry and lesson entry.

## Verification

The isolated acceptance preview was checked at 320px in all five locales and both
themes: ten combinations, document width exactly 320px, no clipped action labels,
and every Home action at least 48px high. German and Japanese Start labels wrap
without clipping. The 390px phone, 768px tablet and 1280px desktop compositions
were visually inspected; expanded method and quiz feedback were also captured.

Keyboard Tab moves from K to M to Start, with a visible focus outline. Enter
opens/closes the method disclosure and activates the entry links. K/M playback
reached completed/replay states. The quiz disabled answers while playing, showed
feedback, focused its lesson link, retried, and returned to samples. Browse and
Practice reached their expected pages; Start opened Meet K and its exit dialog.
These are browser observations, not a new audible-device or screen-reader test.

Commands used Node 26 and `PUBLIC_API_BASE=/v1` where required:

| Check                             | Result                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run verify`                  | Exit 0; 596 tests / 49 files; Svelte 0 errors/warnings; 562 keys / 5 locales; 25 SEO URLs |
| `npm run lint`                    | Exit 0                                                                                    |
| `npm run build`                   | Exit 0; static output generated                                                           |
| Svelte autofixer, both components | Exit 0; no issues; existing HomePreview `bind:this` suggestion reviewed and retained      |
| `git diff --check`                | Exit 0                                                                                    |

## Design handoff

The [manifest](2026-10-26-home-listening.json) identifies the boards, source and
saved version. **Home listening-first · 6d70771** was saved and independently
found in version history at `2026-10-26T11:41:14.111Z`. This confirms persistence
of the current file after the previous save timeout. Validation returned zero
errors, all reference text stayed inside its board, and the exported phone frame
was inspected.

The prototype connects the light phone method disclosure in both directions and
returns quiz feedback to samples. Audio, randomized quiz/retry and route changes
remain application interactions. Penpot uses Roboto as the available font
fallback; local browser screenshots preserve platform typography. Capture data
and representative PNGs are retained in this chat's visualization artifacts.

Implementation commit: `6d70771`. Delivery requires a clean `git status --short`
after the evidence commit. Native acceptance gaps remain tracked in the
[UI/UX audit](../ui-ux-audit.md); this Home packet does not claim to close them.
