# Explicit guest evidence import — 28 October 2026

This P1 packet follows `ed15640` on `dev`. It adds the explicit import action in Settings → Sync & storage → Learning evidence. No backend contract, dependency, schema, deployment or historical training record changes are required.

## Acceptance and behavior

- Signing in alone never copies guest evidence. A separate inline confirmation describes the destination and its lasting consequence; Cancel performs no import.
- This origin's guest evidence ledger has one account destination, including later guest additions. Keeping the chronology together avoids selectively dropping exposure evidence when switching accounts. This constraint is visible before confirmation; it is separate from the existing legacy training-history import.
- Import preserves guest records, native IDs, references, timestamps, assistance and unresolved exposure bounds. It creates no assessment or milestone. Server-only claims are not promoted from guest storage.
- Copies, account outbox entries, destination assignment and per-record journal entries commit in one IndexedDB transaction. A conflict or stale captured authentication session aborts the whole import. Identical account copies can be adopted without another upload; retries do not duplicate evidence.
- Later guest additions require another explicit import into the same account. Another account sees the assigned state and cannot claim the ledger. The journal remains in the evidence database's existing metadata store; no database version change is needed.
- Device import success is distinct from account synchronization. Offline or unavailable-API states retain imported work in the separate evidence outbox.

## Design and verification

Penpot was refined before implementation in the existing learning-evidence page: board `fd9f7595-460b-8009-8008-dae7f21fa63b`, saved version `P1 guest import · separate confirm and cancel actions`. Existing boards and prototype destinations were retained. Firefox Computer Use showed the board and the file's Saved state.

Verification is intentionally limited to the changed packet: six focused import regressions cover preservation/retry/incremental import, competing accounts, atomic rollback, authentication change, adoption of a downloaded record, and rejection of guest/server-claim promotion. Final checks: focused Vitest exited 0 (6/6 tests); localization validation exited 0 (636 keys, five locales); Svelte/worker type checks exited 0 (0 errors, 0 warnings); lint, static build and `git diff --check` exited 0. Both changed Svelte files were analyzed with exit 0 and no issues; existing Settings effect advisories were retained.

Safari on the isolated loopback acceptance app verified: sign-in and Cancel left the target account empty; confirmation copied all 124 synthetic records unchanged, retained all 124 guest originals and queued 124 uploads while the synthetic API returned 503; the remaining import count became zero. A second synthetic account had zero records and no import action, with the assignment explanation visible. German confirmation at 390 CSS px had no horizontal overflow and both actions were 48px tall. The other-account layout was visually inspected in dark theme. The first screenshot from the inactive tab was blank; switching to the acceptance tab corrected capture. Synthetic sign-in was removed after the walkthrough. This is local UI/storage acceptance, not a real-service synchronization claim. The full test suite and backend suite are not rerun for this frontend-only packet.

Remaining P1 implementation: purpose-aware check/review history browsing. Real-service/device acceptance and broader history performance remain separate gates; P2 is not part of this packet.
