# Practice presentation implementation — 28 October 2026

## Scope

Implement the Penpot Practice proposal as a presentation packet. Dedicated Callsigns desktop and phone targets were completed and saved before code changes. Existing content generation, scoring, playback, shortcuts, checkpoints, confirmations and account ownership remain authoritative.

The page now aligns with the shared 1120px shell. Content selection and transcription occupy a flat surface; audio settings expand inline beside it on desktop and below it on mobile. The player has an opt-in Practice layout; other uses retain their existing presentation, including the character-reference player with settings hidden. All five message catalogs include the new purpose and audio-summary labels.

Random groups retains lesson selection. Words, Callsigns and Simulated contact retain the context notice and hide that selector. Inspection confirmed that the existing code already supplies the correct 36-character alphabet-and-digit disclosure for those modes; no character-set correction was needed. Existing translated instructions and actual persisted values supersede synthetic mockup examples such as 70% volume.

## Verification

- `npm run verify`: exit 0, 768 tests / 62 files, Svelte check 0 errors and warnings.
- `npm run lint`: exit 0.
- `npm run build`: exit 0.
- Svelte analyzer on the three changed components/routes: exit 0, no issues. Existing effect/lifecycle and element-reference suggestions were reviewed; they concern playback positioning, persistence and focus orchestration rather than this presentation change.
- Browser matrix: exit 0, 160 checks for four modes × five locales × two themes × four widths (320/390/768/1440). Checks cover overflow, hidden pre-start answer field, correct selector visibility and character counts, five audio inputs, and keyboard open/close of settings.
- Browser flows: exit 0, six checks covering playback/pause/resume/stop, cancelled mode changes, review and saved results for all four modes, plus saved-draft continue/discard. No page errors.
- Additional regression checks: exit 0, three checks covering settings-change cancellation, confirmed replacement and character-reference playback. The reference player intentionally has no settings trigger; an initial test assumption was corrected. Final screenshot review found and fixed inherited flex styling on the inline settings disclosure; the 160-case matrix passed again afterward.
- `git diff --check`: exit 0; final status captured with all work uncommitted.
- Screenshot comparison: desktop ready, narrow light/dark, Callsigns, settings and mode results. Evidence under `/tmp/practice-qa/`.

Native disclosure toggle events require settling before checking Escape; the first test sent Escape too early. The matrix now waits for that event. Returning to groups uses the existing lesson selection behavior; tests explicitly select Lesson 1 when checking its two-character disclosure.

## Limits

No real authenticated sync, screen reader, real-device audio quality, native browser zoom, exhaustive persistence fault injection or concurrent-tab session locking test in this packet. Existing domain tests passed. Earlier Home, Lessons and navigation work remains in the working tree. No dependencies, backend changes, commits, pushes or deployments.
