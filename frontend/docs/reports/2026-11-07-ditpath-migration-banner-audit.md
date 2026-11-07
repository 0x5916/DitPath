# DitPath migration banner audit

Date: 2026-11-07. Branch: `feat/ditpath-migration-banner`.

## Purpose

The banner helps existing OpenCW users preserve learning data before the move to
ditpath.com. It must not imply that registration, sign-in, or synchronization
automatically transfers browser-local data.

## Audit findings

### Training history import

- Guest attempts and sessions are stored in the `unclaimed` owner partition.
- [Account import](../../src/lib/data/training-sync-repository.ts) is an **explicit**
  action from Settings. Signing in never calls it.
- The import is idempotent, records a durable installation/kind/record journal,
  detects changed content and rolls back on conflicts, and can target only one
  account.
- It imports native attempts and sessions. Guided sessions still marked
  `in-progress` are imported as `abandoned`; legacy/non-native sessions are
  skipped. Existing import tests cover repeat imports, account isolation,
  conflicts, abandoned state, and preserved unknown end times.

### Learning-evidence import

- Guest evidence is stored in the separate learning-evidence IndexedDB.
- [Evidence import](../../src/lib/data/learning-evidence.ts) is also explicit and
  idempotent. The first account assignment is retained; another account is
  blocked. Server-only milestones are never promoted.
- Existing tests cover repeat imports, one-account assignment, conflict rollback,
  authentication-session changes, and preservation of uncertainty.

### Pending checkpoints — not imported

This is the critical limitation the banner must disclose.

- Guided and practice checkpoints are stored in the learning-evidence IndexedDB
  `meta` store under `checkpoint:*`, partitioned by owner.
- Neither the training import nor the evidence import copies checkpoint entries
  into the account partition.
- The training import converts imported `in-progress` guided sessions to
  `abandoned`. A guided checkpoint references an in-progress session, so it
  cannot simply be copied into an account without changing that contract.
- After signing in, unclaimed checkpoints are not visible because the UI reads
  the current owner partition. They remain on the device but require signing out
  to resume.
- Therefore the banner tells users to finish or save unfinished sessions before
  signing in and explicitly says unfinished sessions are not included in account
  import. It does not promise checkpoint transfer.

### Synchronization states

- Training sync exposes pending uploads, a synchronization error, syncing state,
  and a completed state. Permanently rejected outbox records remain local.
- Learning sync separately exposes pending, rejected, blocked, unavailable,
  syncing, and error states.
- The banner treats pending or failed synchronization as critical, offers the
  existing `syncTrainingNow()` and `syncLearningNow()` retry path, and links to
  `Settings → Sync & storage` for permanent failures or detailed recovery.
- No new synchronization, API, schema, storage-key, or cache behavior was added.

### No-history detection

The banner reads local counts from the current owner's training, evidence, and
checkpoint partitions. If local storage cannot be read, it uses a conservative
generic warning instead of claiming there is no history.

## Messaging matrix

| State                                        | Message                                                                             | Dismissal     |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| Guest, no history                            | Short DitPath announcement with an inline account link                              | Local storage |
| Guest, history or checkpoint                 | Data stays in this browser; register, then import; finish unfinished sessions first | Session only  |
| Signed-in, no history                        | Short signed-in announcement                                                        | Local storage |
| Signed-in, history, no pending sync          | Account can retain synchronized progress; verify latest sessions                    | Local storage |
| Signed-in, unimported device data/checkpoint | Import device history / finish guest sessions before moving                         | Session only  |
| Pending sync                                 | Do not clear browser data or move devices; retry or open sync details               | Session only  |
| Failed/permanent sync                        | Saved records remain local; review sync details before moving                       | Session only  |
| Context unreadable                           | Conservative “check Sync & storage” warning                                         | Session only  |

Critical dismissal keys include the warning signature. The same warning stays
hidden for the current tab session, but a different warning or a new browser
session shows again. Non-critical dismissal is persistent.

## Placement and accessibility

- The banner is rendered once in the root layout, inside the page content.
- It is hidden during guided sessions and on Settings/Login/Register, where the
  user is already taking the relevant action.
- Critical states use `role="alert"` and assertive live announcements; other
  states use `role="status"` and polite announcements.
- The dismiss control is a keyboard-focusable 44×44 px button with an accessible
  label. Actions use existing buttons/links and theme tokens.
- The short no-history state uses an inline link rather than a large action row
  to remain visibly less urgent.

## Compatibility

- No IndexedDB, localStorage, API, service-worker cache, or backend schema
  identifiers were changed.
- The existing explicit import paths remain the only way to move guest training
  and learning evidence into an account.
- No domain redirect or automatic navigation to ditpath.com was added.

## Verification

- Focused state and dismissal tests cover every banner state and the
  data-preservation copy.
- Chromium and WebKit browser tests cover all five locales, persistent and
  session-only dismissal, mobile width, dark theme, keyboard dismissal, hidden
  account/auth routes, guest history, and pending/failed synchronization.
- Full frontend, backend, build, and browser results are recorded in the pull
  request for this branch.
