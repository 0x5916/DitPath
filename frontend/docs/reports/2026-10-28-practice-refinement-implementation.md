# Practice refinement implementation — 28 October 2026

Implemented the saved Practice proposal on Penpot page `07 · Practice · Proposal` (file `41725af0-a889-809a-8008-d8302a5aefb6`, page `fd9f7595-460b-8009-8008-dbd7ac01617a`). This supersedes the layout in the earlier [Practice implementation report](2026-10-28-practice-implementation.md).

## Acceptance and changes

- Practice column is centered, capped at 650px; title and audio disclosure share its left edge.
- Audio settings are collapsed by default below the panel, with current values visible. Expanded controls remain inline.
- Removed the subtitle, repeated mode scope description and generic ready instruction. Active status, errors and destructive-action confirmations remain visible.
- One optional title tip: content-sized heading, 8px icon gap and a non-overlapping 48px target. Hover/focus, click/tap, Close, Escape/focus return and outside dismissal verified. Other InfoTip uses retain their default appearance and behavior.
- Preserved all four practice modes, playback, transcription, review, settings replacement and saved-session behavior. No dependencies or backend changes.

## Verification

Node 26; documented `PUBLIC_API_BASE=http://localhost:8080/v1` supplied only to command environments. Initial verify exited 1 because the variable was absent; corrected final verification passed.

| Check                                   | Result                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run verify`                        | Exit 0; 768 tests / 62 files; Svelte 0 errors, 0 warnings                                     |
| `npm run lint`                          | Exit 0                                                                                        |
| `npm run build`                         | Exit 0                                                                                        |
| Svelte analyzer, four edited components | Exit 0; no issues; existing orchestration/binding suggestions reviewed                        |
| Browser matrix                          | Exit 0; 160 cases: four modes × five locales × two themes × four widths (320, 390, 768, 1440) |
| Layout/tip checks                       | Exit 0; 20 locale/width cases plus one emulated-touch case                                    |
| Practice flows                          | Exit 0; six playback/review and saved-session flows                                           |
| Regressions                             | Exit 0; three settings replacement/reference-player checks                                    |

Final desktop and narrow-phone screenshots visually compared with Penpot. Existing native typography, navigation and actual user settings remain authoritative. Temporary evidence is in `/tmp/practice-refine-*.log`, `/tmp/practice-qa/` and `/tmp/practice-refine-{desktop,tip}.png`.

No real authenticated sync, native screen-reader, real-device audio or native zoom testing. Existing uncommitted work was preserved; `git status --short` captured. Nothing committed, pushed, merged or deployed.
