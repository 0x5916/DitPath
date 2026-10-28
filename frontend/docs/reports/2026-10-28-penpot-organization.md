# Penpot organization — 28 October 2026

[Start here](https://design.penpot.app/#/workspace?team-id=5009c98b-0fb2-816e-8008-d82a38bab0df&file-id=41725af0-a889-809a-8008-d8302a5aefb6&page-id=70d88234-9fff-8034-8008-d9950f5c83f6)
is the authoritative directory. Its eight Present-mode links lead to:

- 01 · Home · Current
- 02a · App · Dated references
- 02b · Training · Dated references
- 03 · Work in progress · Learning evidence
- 04 · Design system
- 90 · Archive · Original Home and refinements
- 91 · Archive · Guided studies
- 92 · Archive · Journey studies

Nine existing pages were retained to preserve page IDs, frame IDs, and links.
The directory replaces competing entry notes; those notes remain to the right,
labelled historical. Approved Home frames are distinguished from browser captures.
Older implementation references keep their recorded revisions rather than claiming
fresh acceptance. Planned learning references and recorded handoffs occupy separate
blocks. Large canvases use bounded rows; original Home screens start at y=320 in
the Home archive and superseded refinements at y=1520.

## Verification and preservation

- All 191 pre-existing top-level boards remain, with the same IDs.
- No top-level board overlaps after organization.
- All 404 recorded internal navigation destinations resolve to preserved boards.
- All eight new directory links resolve to existing pages.
- Directory export visually inspected; no directory text exceeds its board bounds.
- Two retired localhost preview links now open the archived guided study. Their
  original URLs are retained as plugin metadata on the affected shapes.
- No screen design content was deleted. Guide text, status labels, positions and
  navigation references were updated; the actual Home layouts were preserved.

Versions saved: `Before full file organization · 28 Oct` and
`Organized · Current, planned and archived · 28 Oct`.
Penpot was left focused on the new Start here directory.

The Plugin API does not expose page reordering; Safari computer-use access was
not approved. Physical sidebar order is therefore unchanged. Numbered names and
the linked directory provide the intended navigation order without recreating pages.

Only these organization notes and the two Home handoff reports changed locally
in this pass. Pre-existing frontend changes remain untouched. Documentation
formatting and `git diff --check` exited 0. No runtime tests were run for this
Penpot/documentation-only pass (0 tests); prior frontend results remain in their
own report. Working-tree status was captured, including existing uncommitted
catalog/component/style changes. No push, merge or deployment occurred.
