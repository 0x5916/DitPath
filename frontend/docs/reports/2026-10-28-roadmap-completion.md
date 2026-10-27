# Remaining implementation roadmap — 28 October 2026

This pass implements the three remaining feature items on `dev`, following `6b3019c`. The user explicitly requested these together in one pass. No backend schema, endpoint, dependency, deployment or existing wire contract was changed. Nothing was pushed or merged.

## Implemented

- **Purpose-aware history:** Progress now browses prospective coaching, return screening and mixed checks, across recorded profiles, with purpose/outcome filters, twenty-row progressive disclosure, settings, answer/replay/skip/invalid-delivery counts, original responses and explicit claim corrections. Open checks expose no answer details or correctness. Original device-only pilot history remains labelled separately.
- **Exact local continuation:** Lessons offers saved guided/review/check sessions. Save & leave preserves frozen prompts, IDs, settings, current prompt, draft and completed answers. A write-ahead first-response checkpoint commits before its attempt; restoration retries the same immutable IDs. A live-tab lock prevents a second continuation. Active audio resumes paused from a safe prompt boundary, never mid-character; interrupted recognition stays unmeasured or invalid. Exposure recovery preserves resumable plans while conservatively closing old guards. Older sessions without a checkpoint retain the restart path.
- **Saved copy practice:** A passage and partial copy survive leaving/reloading, including its contextual mode and settings. Save failure retains the latest snapshot for retry; starting a second live passage is fenced. Restored reviewed results keep the original history ID and cannot create another result under a new ID. Checkpoints are owner-scoped, device-local and excluded from guest-evidence import and account feeds.
- **Contextual practice:** The existing copy workflow offers random groups, words, callsigns and synthetic contact exchanges. Context uses letters and digits, retains frozen source text until checking, reuses the native transport and comparison UI, and does not unlock lessons or create single-character milestones. Word/callsign playback uses the already approved exposure source kinds.

## Design and verification

Penpot was refined and saved before UI changes: board `fd9f7595-460b-8009-8008-dafa4ad911d8`, version `Remaining roadmap · history, exact continuation and context before implementation`. Existing boards, IDs and prototype destinations were preserved.

Focused verification passed: **37 tests in four files, exit 0**; Svelte/worker type checks **exit 0, zero errors/warnings**; translation validation **exit 0, 663 keys across five locales**; lint and static build **exit 0**. Eleven changed/new Svelte files were analyzed with **exit 0 and no issues**; existing advisory suggestions were retained. The full frontend/backend suites were intentionally not repeated. The focused lock test initially reproduced a release race; release now waits until the lock has actually been relinquished.

Safari rendered the new history with the existing synthetic check fixture. Its native filter-menu automation subsequently stalled, including tab-list requests. The installed Playwright SDK had no browser binaries, so the available in-app browser was used without installing anything. That walkthrough selected Words, started audio, entered `TEST COPY`, saved and left, reopened Practice, continued the saved Words passage with the draft intact, and checked it. The existing comparison showed Words and one saved practice result. A guided lesson was then saved, reopened through its exact session URL, resumed at the same prompt (1 of 15, Meet K), and saved again. These establish local UI behavior, not human recognition or audible-quality validation. Automated generation/controller/evidence/recovery tests cover the remaining contextual and resumed-assessment branches.

## Release limits

The requested implementation items are present. Native-device/IME/screen-reader checks, genuine two-profile real-service synchronization, delayed learner validation and long-history/clock acceptance remain release gates. They are not claimed complete. Continuation requires browser Web Locks and remains on the same device/profile; the application never pretends a cloud download contains a local checkpoint. Synthetic contact passages are copy exercises, not a live radio connection.
