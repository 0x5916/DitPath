# Account deletion API proposal

**Status: Proposed, 2026-10-24. Pending owner approval and explicit implementation authorization under [AGENTS.md](../../AGENTS.md).** This document proposes an irreversible account deletion flow. No deletion endpoint, schema migration, authentication change, or deployment is implemented by this packet.

## Current behavior and proposed result

The [router](../internal/server/router.go) supports account updates and logout, but no account deletion. [Users](../internal/models/user.go) contain identity and password data; the [base model](../internal/models/base.go) enables GORM soft deletion. A normal GORM `Delete` would retain those values and would not execute PostgreSQL delete cascades. The browser's [cache clearing](../../frontend/src/lib/data/training-db.ts) also preserves pending uploads and device-only history; it is not account deletion.

The proposed Settings → Account action permanently removes the signed-in account, its cloud settings and training history, and its sessions on every device. It erases that user's forum text while preserving other people's contributions. The confirmation must state these effects and that recovery is unavailable. Device-only history stays separate.

## Proposed request and responses

`DELETE /v1/user/me` requires the existing bearer authentication and loaded account. Accept only a JSON object containing a nonempty `password` of at most 256 characters and `confirmation`; the latter must equal the literal `DELETE`. Never accept a target account ID, username, or email. Retain the existing [auth JSON body limit](../internal/handlers/v1/auth_json.go), add endpoint-specific rejection of unknown fields or additional JSON values, and never log the body or password.

Require the current password again even with a valid access token. Use the shared [password-work reservation](../internal/utils/password.go), release it before the deletion transaction, and recheck the password-hash snapshot under the account lock. A concurrent password change invalidates this authorization. Proposed deletion admission is five requests per authenticated account per rolling minute, backed by a bounded process-local limiter; instances multiply this budget, as with the current [resource-limit policy](auth-resource-limits-spec.md). These are proposed policy values requiring approval.

| Response                     | Required behavior                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `204`                        | Transaction committed; no identity or token in the response.                                                                                |
| `400 INVALID_REQUEST_BODY`   | Malformed/unknown fields or confirmation mismatch; no password work or deletion.                                                            |
| `401 INVALID_CREDENTIALS`    | Password mismatch or changed credentials; no deletion. Existing authentication errors apply to invalid/missing tokens or an absent account. |
| `413 REQUEST_BODY_TOO_LARGE` | Existing auth-body limit exceeded; no password work.                                                                                        |
| `429 AUTH_RATE_LIMITED`      | Proposed deletion admission exhausted; return `Retry-After`.                                                                                |
| `503 AUTH_CAPACITY_EXCEEDED` | Existing shared password-work capacity exhausted; no deletion.                                                                              |
| `500 ACCOUNT_DELETE_FAILED`  | Transaction failed and rolled back; do not report success.                                                                                  |

The operation is idempotent in effect: retries cannot recreate an account or delete another account. It does not promise identical responses after deletion: a repeated request with the old token receives `401` because the user no longer exists. A lost success response is an uncertain outcome; the client must not treat an arbitrary `401` as proof of deletion or automatically resend stored passwords. Explain that the session ended and allow a fresh sign-in attempt to establish whether the account still exists.

## Data transaction and forum policy

Hard-delete the [user](../internal/models/user.go), [CW settings](../internal/models/cw_settings.go), [page settings](../internal/models/page_settings.go), [legacy progress](../internal/models/progress.go), [training events/profile](../internal/models/training_event.go), [sessions/sync state/change payloads](../internal/models/training_session.go), and all active, revoked, expired, or soft-deleted [refresh tokens](../internal/models/refresh_token.go). Explicitly hard-delete all [email OTP](../internal/models/email_otp.go) rows with this `user_id`, including verified and soft-deleted rows: that model has no declared user relationship to cascade. Do not delete another account's rows merely because it shares an unverified email address. Unbound legacy OTPs have no provable account ownership and need a separately reviewed expiry/retention policy.

Verify actual database foreign keys and historical rows, not only GORM annotations. Use unscoped deletion where soft-delete columns exist; ensure cascades cover every live and soft-deleted owned row. Hard deletion releases username, verified email, and call-sign uniqueness for later registration with a new UUID. Do not retain a recoverable user tombstone or password hash.

**Proposed forum policy requiring explicit approval:** erase the deleted user's titles and bodies, detach authorship, and keep only structural placeholders needed by other people's replies. The [current forum model](../internal/models/forum.go) has non-null author IDs with cascading user deletion; hard-deleting a thread would also delete other people's replies. The [current soft-delete handlers](../internal/handlers/v1/forum.go) retain original text and hide deleted threads, so they cannot meet this policy unchanged.

This proposal therefore includes a reviewed migration making forum author IDs nullable with `ON DELETE SET NULL`, plus an explicit thread content-deletion timestamp. Before deleting the user, wipe their thread titles/bodies, mark their live threads as content-deleted, and wipe their reply bodies while marking replies deleted. Apply this to already soft-deleted content too. Preserve thread/reply IDs and relationships, and preserve all other authors' text. Existing soft-deleted threads remain hidden. Live thread placeholders expose `is_deleted: true`, empty title/body, and null author; clients display localized “Deleted thread”/“Deleted account” text. Existing deleted-reply responses continue returning null body and author. Reject new replies to a content-deleted thread with proposed `409 THREAD_CLOSED` while leaving existing discussion readable.

Update thread [wire types](../internal/common/response.go) and [frontend types/renderers](../../frontend/src/lib/api.ts) together: current thread pages dereference the author as non-null. Test thread lists, details, parent context, counts, pagination, and nested replies. Approving deletion must explicitly approve this forum contract and migration; no cascading removal of other users' contributions is implied.

## Revocation and concurrent work

Use the existing [locked-user transaction](../internal/utils/user_transaction.go) as the outer serialization boundary; always lock the user before history state and dependent rows. Existing [token issuance](../internal/utils/token.go), [refresh/password transactions](../internal/handlers/v1/sessions.go), and email changes already use that boundary. History currently uses a separate [sync-state lock](../internal/training/history_store.go); implementation must reconcile lock order and fence every account writer, including legacy progress, settings, forum writes, imports, and history bootstrap, against deletion. Re-read account existence inside the write transaction; a middleware-captured user alone is insufficient.

When deletion commits, all later protected authorization fails through [LoadUser](../internal/middlewares/loaduser.go), including V2 aliases. Refresh tokens are gone; a login/refresh already underway must either finish before deletion and have its issued token removed, or fail afterward. No late request may recreate the user, settings, history state, or forum ownership. Requests and response bytes already in transit cannot be recalled; no additional successful authorization is allowed after commit. A transaction failure preserves the entire pre-deletion account, including forum content and usable sessions.

## Client completion and local data

Capture the auth session and `account:<UUID>` owner before requesting deletion. Prevent double submission and account switching from applying a delayed result to a newer login. After confirmed `204`, stop that owner's active sessions, queued writes, sync/download work, and cross-tab producers, then invalidate credentials with the existing [session fencing](../../frontend/src/lib/auth.ts).

In one owner-scoped IndexedDB transaction, erase this account's attempts, sessions, mastery, pending/permanent-failure outbox rows, cursors, and sync metadata using the [owned-store schema](../../frontend/src/lib/data/training-schema.ts). Remove import assignments pointing to this owner so erased account identifiers are not retained; leave the original unclaimed records unchanged and require a fresh explicit import decision for any later account. Preserve other account partitions, device-only/legacy history, and installation identity. Never call whole-database deletion or the current all-account cache clearer. Reset account-derived playback/lesson preferences to defaults without clearing device theme or language preference; current [CW settings storage](../../frontend/src/lib/storageKeys.ts) is shared and must be handled deliberately.

Broadcast completion to other open tabs so credentials and owner caches cannot be repopulated by stale work. Offline devices cannot be remotely erased by this API: after reconnect they must reject revoked authentication and offer local removal without re-uploading to a new account. Confirm server deletion separately from browser cleanup. If local removal fails, retain a durable owner-specific cleanup marker, keep credentials unusable, show a retry action, and never claim that this browser's data was cleared. Cancelled confirmation, offline requests, or unconfirmed server failures must not erase local history.

## Acceptance and release requirements

- Registered-router tests cover successful self-deletion, required password/confirmation, authentication failure, admission/capacity/body limits, and rollback at every dependent deletion step. No cross-account targeting or body/password logging is possible.
- Disposable PostgreSQL tests inspect unscoped rows and actual foreign keys after deletion, including old soft-deleted data, OTPs, change-feed payloads, settings, and all tokens. A second account and its data remain untouched; re-registration uses a different UUID.
- Race tests coordinate deletion with password/email changes, login, refresh, verification, settings, both training namespaces, bootstrap, legacy progress, and forum creation. Assert lock order, no deadlocks/resurrection, and immediate subsequent token rejection across devices.
- Forum tests prove authored text and identity are absent from lists, details, parent snippets, and soft-deleted rows; other people's replies and links remain readable. Client rendering handles null authors and closed-thread errors.
- Browser tests cover guest/unclaimed preservation, multiple accounts/tabs, pending and failed uploads, active training, changed auth sessions, lost responses, offline state, and failed/retried local cleanup. Verify all five locales and keyboard/mobile confirmation behavior.
- Run frontend verify/lint/build and backend tests/vet plus required database/race suites; record counts, skips, exit codes, and git status. Unset database fixtures do not satisfy acceptance.

Before rollout, approve the forum migration/contract and document the real backup/log retention period and restoration procedure. Do not promise immediate removal from immutable backups or previously delivered email; restores must not reactivate deleted identities. No deployment or database-changing command is authorized by this proposal.
