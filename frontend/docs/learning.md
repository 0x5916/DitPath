# Learning architecture and acceptance

This document describes the current frontend. The [UI/UX backlog](ui-ux-audit.md) distinguishes remaining requirements from implemented behavior. Contributor rules live in [AGENTS.md](../AGENTS.md); types and algorithms are authoritative in source rather than duplicated here.

## Routes and coexistence

- [Learn](../src/routes/morse/learn/+page.svelte) uses the lifetime attempt count to distinguish newcomers, then derives recommendations from recent device history through [course guidance](../src/lib/training/v2/course-guidance.ts). It stops at the first unstable lesson and requires stable evidence across the whole curriculum before showing completion. Remaining checks use the [mastery policy](../src/lib/training/v2/types.ts); lesson bounds come from the curriculum. Only the latest session can offer a restart; restart and dismissal persist abandonment while retaining saved answers. Exact prompt restoration is not implemented.
- [CoursePath](../src/lib/components/learning/CoursePath.svelte) shows the previous/current/two upcoming lessons, with earlier/later rows in native disclosures. The current row stays outside disclosures. The [curriculum](../src/lib/training/sequence.ts) contains 39 lessons introducing 40 characters.
- [Guided session](../src/routes/morse/learn/session/+page.svelte) creates browser resources and a [reactive controller](../src/lib/training/v2/session-controller.svelte.ts). The controller coordinates prompt playback, scoring, persistence, and interruption handling using the [pure guided state machine](../src/lib/training/v2/guided-session.ts). Initialization has a retry state and ignores stale asynchronous work; route changes and disposal release owned resources.
- [Practice](../src/routes/morse/practice/+page.svelte) provides continuous copy and character familiarization. Continuous copy retains the separate [passage state machine](../src/lib/training/session.ts), with [attempt snapshots](../src/lib/practice/copy-attempt.ts) and a shared [playback controller](../src/lib/practice/playback.ts) owning exercise and audio lifetimes. Familiarization may show Morse notation because it is an inspection mode. Free practice does not unlock guided progression.
- [Progress](../src/routes/morse/progress/+page.svelte) reads the full indexed seven-day session range and recent guided attempts, then delegates metrics and diagnostics to the [pure summary reducer](../src/lib/training/v2/progress-summary.ts). Recorded session time comes from valid timestamps; absent measured evidence stays unmeasured. Loading, empty activity, and storage failure/retry are distinct. Character cells are labeled, noninteractive displays; the diagnostics action opens free practice without claiming a targeted session.

Learn and Progress close connections on failure or unmount and ignore late initialization results. Progress closes its read connection after loading. Recommendation, session, practice, result, and progress copy use the five [message catalogs](../messages/); the shared layout owns their outer page padding.

## Domain, audio, and persistence

[Prompt types](../src/lib/training/v2/types.ts), [lesson building](../src/lib/training/v2/lesson-builder.ts), [attempt scoring](../src/lib/training/v2/attempt.ts), [mastery](../src/lib/training/v2/mastery.ts), and [progression](../src/lib/training/v2/progression.ts) are pure TypeScript. The controller is the Svelte orchestration exception; presentation components emit intent rather than owning domain decisions.

`reduceCharacterMasteries` indexes a history once for multi-character analysis and shares an evaluation time. Progress and progression use it. Learn deliberately uses the single-character reducer to preserve its early exit; eagerly computing every character can increase work for that route.

[Timing](../src/lib/training/timing.ts) produces plans in seconds; the [audio engine](../src/lib/audio/engine.ts) schedules them and creates Web Audio resources on playback. Attempt latency is stored in integer milliseconds. Audio completion and replay counts feed assessed recognition; inspection/repair must not create duplicate scored attempts.

[IndexedDB](../src/lib/data/training-db.ts) and the [attempt](../src/lib/data/attempt-repository.ts)/[session](../src/lib/data/session-repository.ts) repositories store guided history. Transaction success waits for commit; late aborts reject. The controller retains failed writes in order, exposes saving/saved/failed state, and retries with the same identifiers. Results claim device persistence only after the queue commits. The [navigation guard](../src/routes/morse/learn/session/navigation.ts) keeps the session and failed queue available until saving succeeds or the user explicitly chooses to leave unsaved; cancelled Back/Forward navigation retains its original destination.

[Legacy migration](../src/lib/data/legacy-migration.ts) imports compatible device data. The account-scoped [legacy progress queue](../src/lib/progressSync.ts) and [IndexedDB outbox](../src/lib/data/outbox-repository.ts) coexist; an outbox repository or [SyncStatus component](../src/lib/components/learning/SyncStatus.svelte) does not establish a working guided server-sync integration.

## UI acceptance requirements

These are requirements for changes, not a claim that every existing flow passes them:

- Preserve the [shared design tokens](../src/app.css), five-locale messages, semantic feedback, theme support, and reduced motion. The layout owns page padding and mobile navigation clearance.
- During assessed recall, reveal no Morse notation or visual decoding cues. Inspection and post-answer repair must remain clearly distinct from scoring.
- Provide one clear primary action, stable answer positions, 44px minimum/48px preferred targets, 8px target spacing, visible focus, and text/icons with success/error feedback.
- Space plays/replays and Enter submits/continues only in the appropriate phase. The guided route owns Enter continuation for introductions, feedback, and sound comparison through the [keyboard guards](../src/lib/components/learning/keyboard.ts). Focused controls retain native activation. Escape pauses or opens exit confirmation without immediately discarding the session. Guard composition and held keys; displayed shortcuts must work.
- Expose session progress with accessible current/maximum values and announce prompt feedback through a live region.
- Exit dialogs need initial focus, contained Tab navigation, Escape/cancel behavior, and focus restoration. Background audio/hotkeys must not bypass a modal.
- Distinguish loading, empty history, initialization failure, audio failure, and unsaved progress. Only offer resume, replay, targeted review, or sync when the associated action is implemented.
- Verify newcomer/returning/review/complete states and full session intent/recovery paths in the browser. Inspect 320px, 390px, and desktop widths, both themes, translated wrapping, disclosure navigation, and overflow. Source review and a static build do not prove these interactions.
