# Lessons presentation implementation — 28 October 2026

## Scope and acceptance

Implement the Penpot Lessons proposal as a focused presentation packet. Keep the shared navigation, curriculum, recommendation resolver, access rules, persistence and sync behavior. Make the recommendation prominent, show three nearby lessons, and provide the full ordered course through a keyboard-accessible disclosure. Preserve readable layouts at 320, 390, 768 and 1440px in both themes and all five locales.

Design: [05 · Lessons · Proposal](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-dbb152fe2af6). Additional requirements/saved-session details were saved in Penpot before frontend changes.

## Result

The recommendation and course sit side by side on desktop and stack on phones. Numbered markers retain textual status; locked rows remain noninteractive. Start, review, resume, restart, discard and error handlers are unchanged. The existing application shell, system font and translated instructions remain authoritative; the proposal's simplified header and example copy were not substituted for production navigation or messages. Long content grows naturally rather than adopting fixed design-board heights.

The homepage changes already in the working tree were preserved. No dependencies, backend changes, commits, pushes or deployments.

## Verification

- `npm run verify`: exit 0; 768 tests in 62 files; Svelte check 0 errors, 0 warnings.
- `npm run lint`: exit 0.
- `npm run build`: exit 0; static build generated.
- Svelte analyzer: exit 0 on all four changed components/routes; no issues or suggestions. Final styling adjustments rechecked.
- Browser matrix on the static build: exit 0; 41 checks covering five locales, both themes, four widths, course expand/collapse by keyboard, all 39 rows, locked access, existing mobile icons and lesson entry.
- Saved/recovery browser flows on the static build: exit 0; five checks covering save, resume in the existing paused state, discard, legacy restart and storage error/retry; no page errors.
- Complete lesson from Lessons: exit 0; 15 prompts completed, 13 answer records saved, Finish returned to Lessons; no page errors.
- `git diff --check`: exit 0; working-tree status captured. All work remains uncommitted.

Intermediate checks exposed obsolete translation keys and missing local API configuration; these were corrected before the successful runs. A premature assertion expected the resumed introduction rather than the existing paused screen; the corrected flow passed. A development reload timeout was resolved by checking the static build. The analyzer's initial approval rejection was resolved by inspecting its local compiler/linter implementation and public documentation GET request, then obtaining automatic approval for the same command.

Browser evidence: `/tmp/lessons-qa/`; scripts `/tmp/lessons-qa.cjs`, `/tmp/lessons-states.cjs`, `/tmp/lessons-session.cjs`. Logs: `/tmp/lessons-verify.log`, `/tmp/lessons-lint.log`, `/tmp/lessons-build.log`.

## Limits

Live authenticated sync, assistive-technology testing, real-device touch/audio, 200% browser zoom, multiple simultaneous checkpoints, and every populated recommendation/course-complete variant were not separately browser-tested in this packet. Their existing logic was retained; automated domain tests passed. This is local implementation evidence, not deployment approval.
