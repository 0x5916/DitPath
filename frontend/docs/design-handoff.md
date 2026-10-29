# Approved design implementation handoff

Approved by Alan on 29 October 2026. Implement the latest approved Penpot designs faithfully, preserving sound-first training and existing recovery behavior. This handoff separates approved targets from verified local behavior; implementation reports record the checks and remaining limits. Approval of designs is not permission to push, merge or deploy.

## Start here

1. Read the root and frontend `AGENTS.md`, this handoff, and the owning [learning architecture](learning.md) and [learning policy](learning-policy.md) guides.
2. Inspect `git status --short` and the existing diff. The worktree contains substantial prior UI work; preserve it. Do not reset, clean, or blindly rebuild approved screens.
3. Open [the Penpot directory](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=70d88234-9fff-8034-8008-d9950f5c83f6). Read the relevant page guide and behavior board before implementing.
4. The **instant check entry** packet below is locally implemented and verified; read its report before extending it. Most earlier screen designs already have local implementations; verify differences rather than duplicating them.
5. Use one discrete packet with explicit acceptance criteria, typically under 400 changed lines. Report checks and remaining limitations for that packet.

## Design authority and implementation status

All links below use the same Penpot file. Page IDs are stable even when titles change. Approval applies to current designs, not mutually incompatible historical studies. Page 09 supersedes page 08; page 10 supersedes earlier check-entry behavior. Page 06 owns desktop navigation even when older page mockups show a previous header.

| Area         | Authoritative Penpot page                                                                                                                                                                             | Current local state and evidence                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home         | [01 Home](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-db81dfc8c62d)               | Locally implemented; [Welcome report](reports/2026-10-28-welcome-implementation.md). Preserve returning-user behavior.                              |
| Foundations  | [04 Design system](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=70d88234-9fff-8034-8008-d9950f5dd81a)      | Reference tokens and approved cross-page criteria. Shapes are not necessarily published components.                                                 |
| Lessons      | [05 Lessons](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-dbb152fe2af6)            | Locally implemented; [Lessons report](reports/2026-10-28-lessons-implementation.md).                                                                |
| Navigation   | [06 Desktop navigation](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-dbbfd2457d3f) | Locally implemented; [navigation report](reports/2026-10-28-top-navigation-implementation.md).                                                      |
| Practice     | [07 Practice](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-dbd7ac01617a)           | Locally implemented; [latest refinement report](reports/2026-10-28-practice-refinement-implementation.md) supersedes the earlier layout report.     |
| Progress     | [09 Progress](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-dc1b736609f2)           | Compact views and scrolling implemented; [Progress report](reports/2026-10-29-progress-views.md). Check-action labels/behavior must follow page 10. |
| Recall check | [10 Instant entry](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=fd9f7595-460b-8009-8008-dc28f0eee393)      | Locally implemented and verified; [instant-entry report](reports/2026-10-29-check-instant-entry.md). The countdown report is superseded.            |

Pages 02a/02b are dated references; 03 contains earlier learning evidence work; 08 is a previous Progress reference; 90–92 preserve originals. Do not delete them or use their stale approval/status text to override this handoff. Earlier Penpot versions preserve the ready/countdown designs.

## Verified implementation packet

### Instant check entry

**Choose check → first sound → answer.** No separate Start check screen, countdown, second Play action, or mandatory rules dialog on the ordinary path. The explicit action on the originating page can say “Check K, M”; targets, prompt count and speed come from actual state, not example data.

| State or event                                | Required behavior                                                                                                                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recommendation or individual-character action | Validate the selected check and start its first sound immediately. Use the initiating user gesture for audio activation where possible. Prevent duplicate initialization/playback from repeated clicks or navigation.              |
| First sound playing                           | Show Listen and playback status within the session. Preserve progress, Pause, and Save & leave. No decoding hints or answer-revealing animation.                                                                                   |
| Sound finishes                                | Show the existing single-character answer task, Replay sound and Skip. Keep “Type one character to submit.” No answer time limit. Preserve controller scoring and timing.                                                          |
| Direct URL or reload                          | Enter the same session surface, honoring any saved-session/ownership/recovery state. Play when the browser allows it. If blocked, show Play sound on that surface with a brief explanation; do not reinstate an introduction page. |
| Audio blocked or fails                        | Do not mark an unheard prompt as a valid first listen, skip it, or advance progress. Keep a visible recovery action; preserve existing audio validity rules.                                                                       |
| Pause or tab hidden                           | Stop/pause through the existing controller. Returning to the tab must not silently resume audio. Resume retains existing interruption/replay semantics.                                                                            |
| Save & leave                                  | Preserve a resumable session using existing persistence behavior. Keep saving/errors visible; never show saved success before confirmation.                                                                                        |
| End check                                     | Available within Pause, with the existing confirmation and data safeguards. Do not make End and Save & leave aliases.                                                                                                              |
| Optional rules                                | Available at the originating entry and in Pause. Closing returns to the invoking state, restores focus and never starts audio. The static Penpot rules board is a state specimen, not a new mandatory route.                       |

The active header contains progress, Save & leave and Pause. Remove the redundant in-page Back action from this check UI; browser Back must retain navigation guards. Routine “Saved on this device” moves into Pause; actionable errors remain immediate. Keyboard shortcut copy is based on input capability, not viewport width. Keep the answer accessible with a software keyboard, without forcing a disruptive keyboard transition before audio is heard.

Inspect these existing files first; preserve their surrounding behavior:

- [LearningOverview.svelte](../src/lib/components/learning/LearningOverview.svelte): shared recommendation and character actions.
- [MixedCheckPanel.svelte](../src/lib/components/learning/MixedCheckPanel.svelte): current ready/countdown and completed-check UI.
- [session route](../src/routes/morse/learn/session/+page.svelte): validation, session initialization, playback, pause and exit orchestration.
- [check-start-intent.ts](../src/lib/check-start-intent.ts) and [tests](../src/lib/check-start-intent.test.ts): current memory-only intent. Reassess whether it is still needed; do not preserve obsolete countdown behavior to satisfy its old tests.
- Shared session controls, controller and audio ports referenced from the route: inspect their actual ownership before changing them. Restrict presentation changes to checks unless other flows require the same behavior.

Acceptance: recommendation and character entry each play once without an extra click; direct-entry success and blocked-audio fallback both work; pause/hidden-tab/resume, replay, skip, save/reload, exit cancellation and save failure preserve data and assessment validity. Invalid targets and another-tab ownership remain safe. Completing a check still records the same evidence and reaches the existing results. Verified locally: **773 tests in 63 files**, required frontend gates exit 0, **16 browser scenarios** including **50 locale/theme/viewport cases**, plus a Firefox visibility/exit smoke pass and native iPhone 17e / iOS 27.0 Simulator coverage. The simulator fixed portrait keyboard/header behavior; expanded-chrome landscape keyboard and existing Progress notch findings remain documented. See the [implementation report](reports/2026-10-29-check-instant-entry.md) for evidence and physical-device, screen-reader, native-zoom and live-sync limits.

## Preserve the approved screen behavior

- **Home:** generous whitespace, clear learning action, secondary Practice/sign-in actions, original radio illustration, optional listening demo. Preserve mobile stacking and short-screen scrolling. Do not copy Duolingo artwork or branding.
- **Lessons:** one recommended next action, then course browsing. Retain current/locked/revisit states, valid checkpoint Continue versus legacy Restart, saved-lesson access, unlock details and sync notices. Example lesson numbers are not policy.
- **Navigation:** desktop Lessons / Practice / Progress / Forum; logo returns Home. Desktop has no More destination. Mobile retains Home / Practice / Progress / More with consistent Lucide icons and labels. Current implementation switches at 960px; compact account controls cover 960–1199px. Keep active, hover, focus and open states distinct. GitHub points to `https://github.com/0x5916/Morse`.
- **Practice:** centered 650px column, heading and content aligned, audio settings collapsed below with visible values. One optional title tip, not a tip on every control. Preserve Random groups, Words, Callsigns and Simulated contact, their field differences, playback, transcription/review and replacement/save safeguards. Instant check entry does not remove Practice's explicit Start practice action.
- **Progress:** Overview / Characters / History are URL-backed views. Overview remains compact irrespective of record count. Characters uses a continuous list, never pagination. Desktop has one bounded, keyboard-scrollable region with a short-window document-scroll fallback. Mobile uses document scrolling and a sticky opaque filter, not a nested panel. Preserve filter/scroll on return; changing filter resets the list and announces count. Keep inline details, empty results, historical records and partial-sync warnings. Past attainment remains distinct from current recall.

## Visual and interaction criteria

Use [app.css](../src/app.css) and [layout.css](../src/lib/styles/layout.css) as token sources. Keep warm neutral backgrounds, Forest accents, flat surfaces, 2–6px radii and the 4px spacing rhythm. Do not introduce new font packages or scatter color literals in components. Penpot's Inter metrics and native font/control rendering can differ; match hierarchy, proportions and wrapping rather than forcing fixed heights.

Controls should have at least 48px targets and 8px separation, with visible keyboard focus. Existing primary controls are commonly 52px high. Align visible icon bounds optically with text, while retaining the larger hit area. The Practice title tip has an 8px visible gap and a non-overlapping 48px target. Popovers work with keyboard and touch, close safely and restore focus. Use installed Lucide icons and native semantic controls where suitable.

Use type and spacing before dividers. Essential instructions, consequential actions and errors stay visible. Remove repeated descriptions; occasional details belong in disclosures. Do not fill whitespace with decorative cards or extra metrics. Allow translated labels, rows and buttons to grow; status needs text as well as color. Never expose Morse notation, source text or other answer hints during assessed recall.

## Penpot to frontend workflow

1. Inspect the actual app and relevant source without modifying user data. Confirm what is already implemented, and state the packet's acceptance criteria.
2. Read the authoritative Penpot boards and interaction notes. Save a named version before any design change. Keep numbered pages/boards and concise status guides; preserve historical references. A new design change must be saved before code changes.
3. Implement using existing tokens, components, domain state and controller contracts. Use the existing `design-clear-ui`, `svelte-code-writer`, `svelte-core-bestpractices` and `webapp-testing` skills when available. The repository guides remain the durable contract; no additional skill is required for this handoff.
4. Update all five source message catalogs for copy changes; do not edit generated Paraglide output. Keep Svelte 5/SvelteKit 3/static adapter and existing dependencies.
5. Run targeted checks and the required gates from [frontend AGENTS](../AGENTS.md). Use Node 26 and the documented `PUBLIC_API_BASE` environment. `npm run verify` includes tests; also run lint, build and the Svelte analyzer on changed components. Capture exit codes, test counts and `git status --short`.
6. Compare browser screenshots with Penpot at matching viewport sizes. Follow real interactions, inspect focus and scrolling, and iterate on observable differences. Verify 320/390/768/1440px, short heights, both themes, all five locales, native 200% zoom and software-keyboard behavior where available. Test 959/960/1199px when navigation is affected.
7. Use disposable local fixtures. Never overwrite the user's IndexedDB or account data. Test loading, empty, populated, interrupted, failure and saved-session states relevant to the packet. Physical-device audio and screen-reader checks cannot be replaced by screenshots.
8. Record changed behavior, exact verification and remaining limits in a dated report; update design status only after verification. Do not claim old test counts as fresh results. No commit, push, merge or deployment without authorization.

## Known integration details

Previous work found SvelteKit 3 using `$app/env`, `goto` options `reset`/`shallow`, and `new URL(page.url.href)` for mutable URL updates. Guard browser-only query access during prerender. Verify installed APIs rather than importing remembered older SvelteKit patterns. Await shallow filter navigation before restoring scroll to avoid the prior filter race.

Local preview ports have varied; inspect the running process instead of assuming 5173 or 5175. Restart preview after a new static build to avoid stale asset manifests. Temporary `/tmp` screenshots and scripts referenced in old reports may disappear; regenerate evidence as needed. Real authenticated sync, native screen-reader behavior, physical-device autoplay and native zoom remain explicit validation gaps in earlier reports.

## Handoff review record

The design review recorded here changed Penpot and documentation only. All 85 boards across current design pages 01/04/05/06/07/09/10 were structurally checked with no board overlaps or direct-child overflow detected. Representative Home, Lessons, navigation, Practice, Progress and check exports were visually reviewed; this is not runtime acceptance of every state. Original references remain intact. The instant-entry packet has since been implemented and verified locally; see its [implementation report](reports/2026-10-29-check-instant-entry.md). Penpot specimen status text remains the historical design approval record.
