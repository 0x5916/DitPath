# Progress refinement — 29 October 2026

Penpot-first: inspected the existing page and dated references, created and visually reviewed desktop light/dark, phone, empty, expanded-evidence and recovery designs on **08 · Progress · Proposal**, then saved the design before implementation. Original designs remain preserved.

[Penpot proposal](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-dc144bce0964)

- Centered 960px page, prominent existing recommendation, expandable character evidence with current recall visible and detailed counts/attainment/check actions retained.
- Activity panel, followed by history disclosures; existing purpose/outcome filters, session details, show-more, error and retry behavior preserved.
- Removed duplicate Lessons navigation; empty state has one primary action. Saved learning history no longer appears beneath a false empty-history message.
- Changes limited to the Progress route, detailed LearningOverview presentation and opt-in PracticeActivity presentation. Scoring, persistence, recommendation logic and dependencies unchanged.

## Verification

Node 26 with the documented local `PUBLIC_API_BASE` supplied to command environments. Final `npm run verify`, `npm run lint`, `npm run build` and `git diff --check`: exit 0. Verify: **768 tests / 62 files**, Svelte 0 errors/warnings. Svelte analyzer on three edited components: exit 0, no issues or suggestions.

Browser checks: **85 passing cases/flows**, exit 0: 80 empty/populated combinations across five locales, two themes and widths 320/390/768/1440; practice-only and large-character-set states; empty-state navigation, learning-history filters/details and injected load-failure retry. Keyboard disclosures, history expansion and overflow checked; screenshots visually compared with Penpot. Firefox also checked the loading and empty page. The first recovery script used the wrong button label, then passed with the existing “Try again” label.

Evidence: `/tmp/progress-{verify,lint,build,browser,states,analyzer-final}.log` and `/tmp/progress-qa/`. Synthetic records used only in isolated test contexts. No real authenticated sync, screen reader, native zoom or real-device testing. Partial-sync and milestone semantics retained but not exhaustively exercised in this UI packet.

`git status --short` captured; prior uncommitted work preserved. No commit, push, merge or deployment.
