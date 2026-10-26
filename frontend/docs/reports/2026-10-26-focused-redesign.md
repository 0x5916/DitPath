# Focused daily journey redesign

This packet changes the interface following the current-state inventory in
`b9c43ad`. The [Penpot design targets](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=21101970-335a-8004-8008-d92bcf7c19c3)
were prepared before implementation, under **Redesign · focused daily journey**.

## Design decisions

| Friction in the existing interface                                                 | Improvement and acceptance                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home extends into repeated destination links and author information                | Retain lesson entry, K/M listening and browse/practice links. Put the method explanation in a disclosure; supporting destinations remain in More.                          |
| Practice shows a disabled copy field and Another passage before the first playback | Reveal typing and replacement actions when a session starts. Start and settings remain discoverable; first playback must focus the newly mounted field.                    |
| Result timing/replay metrics separate completion from the next action              | Lead with recommendation and accuracy, then save state and next/finish actions. Put timing/replays in Session details. Failed saves remain visible outside the disclosure. |
| Progress expands multiple historical records by default                            | Keep actionable findings, weekly activity and character recognition visible. Put recent records in a keyboard/touch disclosure and provide a direct Lessons action.        |
| Settings account controls require a long scroll                                    | Add named section links using existing anchors. Make password editing a deliberate disclosure while preserving form values, validation and request behavior.               |

The visual direction retains the established warm neutral/Forest tokens,
system UI type, 4px spacing, flat controls and large sound letters. Hierarchy and
progressive disclosure provide the improvement. No new curriculum, score,
account, API, dependency or deployment behavior is proposed.

Other surfaces retain their existing responsibilities: Lessons selects/restarts;
More organizes supporting destinations; Profile owns identity/habits; the Morse
table remains a reference; authentication and Forum keep existing forms and
recovery contracts. They do not need a cosmetic rewrite to support this packet.
This is a focused redesign of the daily journey, not a claim that every screen
has been redesigned or every native acceptance gap has closed.

## Design checkpoint

Seven editable boards record direction, Home, Practice ready/active, results,
Progress and Settings. Version **Focused daily journey · redesign targets**
preserves the proposal. Penpot file validation returned 0 errors. This checkpoint
contains design targets, not implementation evidence; application tests run: 0.

## Implementation and verification

Implemented the five changes above, including localized disclosure labels in all
five catalogs and visible player Settings text. Replacing a Practice passage now
focuses Start after removing the previous copy field. The smaller result layout
starts near the top of the lesson viewport. A reproduced German 320px player
popover overflow now preserves its readable width and scrolls within the available
height; a geometry regression test covers that case.

Browser evidence used synthetic local activity:

- Newcomer Home and its keyboard-operated method disclosure at 390px; two-column
  Home at 1280px.
- Practice Start focuses the newly mounted copy field; cancelling replacement
  preserves the answer; confirmed replacement and result Another passage focus
  Start. Two saved results followed by Finish return to updated Home activity.
- A complete 15-prompt guided lesson saves a 55% result, focuses its heading,
  reveals timing/replays on request, and finishes to Lessons. The expanded result
  fits the 320px width; the desktop reference uses 1280px.
- Progress opens/closes its two synthetic history records with Enter and links
  directly to Lessons.
- Settings section links reach the intended sections. A synthetic account shows
  empty password fields only after expansion, with no credentials entered or
  requests submitted. German dark mode fits 320px; account Settings also fits
  390px and 768px. Player Settings closes with Escape and returns trigger focus.

Final commands used Node 26 and `PUBLIC_API_BASE=/v1` where required:

| Check                                  | Result                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run verify`                       | Exit 0; 596 tests in 49 files; Svelte 0 errors/warnings; 562 keys across 5 locales; 25 SEO URLs |
| `npm run lint`                         | Exit 0                                                                                          |
| `npm run build`                        | Exit 0; static output generated                                                                 |
| Focused player placement test          | Exit 0; 5 tests in 1 file                                                                       |
| Svelte autofixer on changed components | Exit 0; no reported issues; existing suggestions reviewed                                       |

Initial verification correctly rejected eight newly unused Home messages; those
keys were removed from every catalog before the passing run. An initial focused
test lacked the required API environment and an analyzer attempt could not reach
its documentation host from the sandbox; both were rerun successfully. Browser
viewport checks are not new Android, IME or screen-reader evidence. Existing
native and second-browser-profile limits remain in the
[acceptance backlog](../ui-ux-audit.md).

The pre-implementation Penpot targets are saved. Final rendered synchronization
is pending restoration of the MCP connection; focusing and reloading the saved
file did not restore its heartbeat. Captured implementation states are retained
locally for that handoff. The existing current-state inventory remains a
historical reference to its recorded revision.
