# Browser audit fixes — 1 November 2026

This packet addresses the confirmed UI, interaction, and accessibility findings from the read-only Playwright/Penpot comparison. It preserves the established warm-neutral/Forest visual language and does not change Penpot, backend contracts, storage schemas, or training policy.

## Changes

- **Progress History is immediately useful.** `Recent sessions` is now a visible section in the History view instead of a collapsed disclosure. Five rows appear at once, `Show more` still reveals the existing 20-session limit, and the section keeps a short empty explanation when no sessions exist. The character overview is no longer mounted on History for ordinary complete evidence, removing the extra 32px gap it contributed; a partial-coverage notice still renders there when present.
- **Secondary and compact actions meet the 44px target.** The shared `.btn-primary` and `.btn-ghost` minimum height is 44px for every pointer type, and `.settings-btn-compact` no longer undercuts it at 36px. This covers Save & leave, retry, cache clearing, Test tone, New thread, and similar actions.
- **Forum filter tabs are 44px tall at every width.** The existing horizontal overlay still enlarges narrow labels without changing the visual chip or active rule.
- **The volume slider has a 48px interaction box.** The native track and thumb are unchanged while the whole row is easier to hit with touch and pointer input.
- **Progress keeps a page-specific document title across tabs.** Progress tabs are query-only changes on one route, and the route's title was being replaced by the site title during client-side navigation. Progress now has localized SEO title/description metadata, so direct loads and tab switches both read `Progress · OpenCW` (localized).
- **Audio-settings summaries are no longer repeated.** The compact speed/tone summary is shown while the controls are collapsed and hidden while the panel is open, because the controls already display every value.
- **Character view no longer contradicts its own evidence.** The `No training history yet` card is not shown on Characters while character records exist. The History view also keeps an explicit empty explanation instead of a blank page in the character-evidence-only case.
- **Learning documentation** now describes the visible five-session history and the `Show more` limit accurately.

## Verification

| Check                      | Result                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`           | Exit 0; messages/SEO/check/check:scripts passed; Vitest 775 tests in 64 files                                                                                                                              |
| `npm run lint`             | Exit 0                                                                                                                                                                                                     |
| `npm run build`            | Exit 0; static output written                                                                                                                                                                              |
| Built titles               | `Progress · OpenCW`, `Fortschritt · OpenCW`, `進捗 · OpenCW`, `进度 · OpenCW`, `進度 · OpenCW`                                                                                                             |
| Browser — Progress History | Five rows visible without expanding; `Show more` expands to six in the seeded acceptance fixture and collapses again by keyboard                                                                           |
| Browser — widths/locales   | English, German, Japanese, Simplified Chinese, Traditional Chinese at 320, 390, 768, and 1280px; no page overflow or clipped history rows                                                                  |
| Browser — themes           | Progress History and Practice audio settings checked in light and dark                                                                                                                                     |
| Browser — Practice         | Volume box measured at 48px high at 320/390/1280px; summary hidden while open and restored when closed                                                                                                     |
| Browser — targets          | Remaining small targets are the focus-only skip link, inline prose links, desktop-only compact row actions, and the intentionally dense Profile calendar/year controls                                     |
| Browser — keyboard         | History InfoTip opens with Enter and closes with Escape; Show more toggles with Enter; mastery disclosure opens; volume slider responds to arrow keys; Escape closes the settings panel and restores focus |
| Console                    | No page errors during Progress tab switching or Practice settings toggling in the normal dev server                                                                                                        |

The acceptance fixture supplied deterministic sessions for the populated History checks. The date and session counts there are synthetic.

## Remaining limitations

- Browser verification used Chromium through the in-app/Playwright browser. Native iOS Safari touch behavior, native screen-reader announcements, and assistive-technology journeys remain outside this packet's evidence.
- Inline text links remain smaller than 44px; they are inline prose actions, not standalone controls. Desktop forum row actions keep their compact text treatment and already expand to 44px under coarse pointers.
- Existing dense Profile heatmap cells and year segmented controls were not changed because they are intentional compact data views and were not part of the confirmed audit findings.
- No Penpot edits were needed; the changes reconcile the implementation with the existing approved designs.
