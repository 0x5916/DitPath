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

Implementation, rendered comparisons and final command results follow in the next
milestone. Existing native keyboard/IME, screen-reader and real-sync limitations
remain in the [acceptance backlog](../ui-ux-audit.md).
