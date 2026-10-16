# Email verification race fix API specification

**Status: Approved and implemented.** The user approved this specification and explicitly authorized the backend implementation packet on 2026-10-13 under [AGENTS.md](../../AGENTS.md). The source changes bind verification to the account's current email and serialize verification, email changes, code issuance, and failed-delivery cleanup.

**Follow-up:** The separately authorized [2026-10-16 hardening contract](backend-hardening-spec.md) adds complete auth-body limits, persisted OTP guess budgets, and password-change session revocation. This document retains the original packet’s approval and evidence; [API.md](../API.md) describes current behavior.

## Scope and historical race

Before this packet, the verification handler matched an OTP against the email previously read by [LoadUser](../internal/middlewares/loaduser.go), then set `email_verified` by user ID alone. A concurrent email update could replace that address before the verification write. The former transaction did not protect the earlier email check.

This packet covers verification, email changes, issuance, and failed-delivery cleanup because they share one account and OTP lifecycle. It retains existing tables, routes, fields, error codes, and dependencies. Challenge IDs, failed-attempt budgets, email normalization, session revocation, and deployment changes are separate work.

[API.md](../API.md) owns current route behavior; this document owns the approved invariants and acceptance requirements. The [shared transaction helper](../internal/handlers/v1/email_verification.go), [auth handler](../internal/handlers/v1/auth.go), and [user handler](../internal/handlers/v1/user.go) implement the packet. Exact existing types and codes remain owned by [input.go](../internal/common/input.go), [response.go](../internal/common/response.go), [error.go](../internal/common/error.go), [email_otp.go](../internal/models/email_otp.go), and [user.go](../internal/models/user.go).

## Required invariants

1. Setting `email_verified=true` requires consuming a live, unconsumed OTP for the same account and its **current database email**, before expiry.
2. An email change atomically writes the new address, clears verification, and invalidates all unconsumed account OTPs. Changing A to B and back to A does not reactivate an old OTP row.
3. OTP consumption and user verification both commit or both roll back. Exactly one request can consume a given OTP row.
4. Issuance reads current email under the same database account lock. Middleware supplies authenticated identity, not authoritative email or verification state.
5. The existing [partial unique index](../internal/databases/db.go) remains the final guard against two live verified owners of the same exact email. Unverified accounts may still share an address.

**Pending** means `verified=false` and `deleted_at IS NULL`; a pending row can be expired. **Usable** additionally means it is the newest pending OTP for the current email, its code matches, and expiry is strictly later than consumption time. Email equality retains existing exact-value behavior.

## HTTP contract

| Operation                               | Request                                                                                              | Success after commit                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /v1/auth/verify-email`            | Existing bearer authentication and `{ "code": "123456" }`; existing six-character numeric validation | `200`, `{ "message": "Email verified" }`                                  |
| `PUT /v1/user/email`                    | Existing bearer authentication and `{ "email": "operator@example.com" }`                             | `200`, `{ "message": "Email updated" }`                                   |
| `POST /v1/auth/send-verification-email` | Existing bearer authentication; no required body                                                     | `200`, `{ "message": "Verification email sent" }`, after provider success |

Errors retain `{ "code": "MACHINE_CODE", "error": "Human-readable message" }`. The approved packet adds no status or machine code.

Verification evaluates the following conditions in order. Decode the body before entering the transaction, but defer returning its validation error until after the account guards, preserving existing precedence. No request-body reading occurs while holding the lock.

| Condition                                                                                                          | Response                                      | Committed effect                                    |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------- |
| Authentication fails, or live account disappears before locking                                                    | Existing `401` auth code, or `USER_NOT_FOUND` | None                                                |
| Locked account is already verified                                                                                 | `400 EMAIL_ALREADY_VERIFIED`                  | None; includes replay after successful verification |
| Another live account owns the current address as verified                                                          | `409 EMAIL_VERIFIED_BY_ANOTHER_ACCOUNT`       | None                                                |
| Body/code fails existing validation                                                                                | `400 INVALID_REQUEST_BODY`                    | None                                                |
| No pending current-email OTP, wrong code, superseded/invalidated OTP, or conditional claim fails other than expiry | `400 VERIFICATION_CODE_INVALID`               | Neither consumption nor verification commits        |
| Code matches the newest pending OTP but is expired at consumption                                                  | `400 VERIFICATION_CODE_EXPIRED`               | Neither consumption nor verification commits        |
| Concurrent verified-email uniqueness conflict during the user write                                                | `409 EMAIL_VERIFIED_BY_ANOTHER_ACCOUNT`       | Roll back consumption and user write                |
| Other database failure, including begin, lock, write, or commit                                                    | `500 DATABASE_FAILURE`                        | Roll back where possible; never report success      |

Invalid codes retain `Invalid verification code`; expired codes retain `Verification code expired`. Do not disclose a previous address or distinguish unknown, replaced, and invalidated OTPs. A stale code receives invalid-code status only when earlier account/body guards do not take precedence.

Email-update precedence is invalid body, missing live account, requested email equal to the **locked current** email (`400 EMAIL_UNCHANGED`), then verified-owner conflict (`409 EMAIL_VERIFIED_BY_ANOTHER_ACCOUNT`). Verified-owner query failures retain the existing `500 DATABASE_FAILURE`; a database duplicate-key conflict retains `409 EMAIL_ALREADY_IN_USE`; other email-update transaction failures, including update, invalidation, and commit, use `500 INTERNAL_SERVER_ERROR`. Failure leaves email and OTP state unchanged, except for an ambiguous commit acknowledgement as described below.

Send precedence is missing live account, already verified, verified-owner conflict, then cooldown. Existing `400 EMAIL_ALREADY_VERIFIED`, `409 EMAIL_VERIFIED_BY_ANOTHER_ACCOUNT`, `429 VERIFICATION_RATE_LIMITED`, and `500 VERIFICATION_SEND_FAILED` responses remain. Issuance database failures use `500 DATABASE_FAILURE`; code-generation failures retain `500 INTERNAL_SERVER_ERROR`.

## Shared transaction boundary

Verify, change email, issue OTP, and failed-delivery cleanup must each begin a transaction and select the same live `users` row by authenticated ID with `FOR UPDATE`. Read current email and verification state from that locked row. Always acquire the account lock before OTP locks or mutations.

If no live row remains after middleware authentication, the three public operations return `401 USER_NOT_FOUND` without OTP writes. Failed-delivery cleanup treats a missing live account as a no-op and retains the original send-failure response.

Use PostgreSQL `READ COMMITTED` semantics: a contender waits and then evaluates committed current state. A process mutex is insufficient across API instances. Do not use `SKIP LOCKED` or classify a busy account as missing. Attach the request context to public-operation database work; lock/transaction errors use the operation's database-error response above, not invalid-code responses. Failed-delivery cleanup uses its own bounded context so it can run after request cancellation.

Owner prechecks may read another account but must not lock it while holding the current account lock. The verified-email unique index must exist in the migrated database. Its violation rolls back the transaction and produces the documented conflict; a precheck alone does not enforce cross-account exclusivity. See [PostgreSQL row locking](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS) and [Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED).

### Verify email

1. Lock the live account and apply ordered account/body guards.
2. Select the newest pending OTP for the authenticated ID and locked email, ordered by `created_at DESC, id DESC`. Include expired rows so a matched expired code receives the expired response. Older pending rows from historical issuance races are superseded even if their code matches.
3. If no row exists or the submitted code does not match, return invalid without writes.
4. Conditionally consume by OTP ID, account ID, email, code, `verified=false`, `deleted_at IS NULL`, and `expired_at > clock_timestamp()` evaluated at consumption. Require exactly one affected row. If zero rows are affected, return expired when the matched pending row crossed its expiry, otherwise invalid. Do not use a pre-lock timestamp or transaction-start `now()`; see [PostgreSQL clock functions](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).
5. Conditionally set verification where live user ID, current email equal to the consumed OTP email, and `email_verified=false` still match. Require exactly one affected row; otherwise roll back and return invalid. Keep the email predicate even under serialization to make the invariant explicit at the write.
6. Commit, then emit success. A failed user write or uniqueness check rolls back consumption. Expiry is evaluated at consumption, not response delivery; a later email change can clear verification before this response arrives.

### Change email

After binding, lock the live account and evaluate unchanged-email and ownership checks against its current state. Atomically write the requested email with `email_verified=false` and soft-delete every unconsumed OTP for that account, across all email values. Require one affected user row; zero invalidation rows is valid. Invalidation failure rolls back the email update. Preserve consumed OTP records and never restore invalidated rows when an old address is selected again.

### Issue and deliver a code

Lock the live account before checking verification, ownership, and send history. The cooldown is **one minute per account across addresses**, including invalidated issuance rows and provider failures. Read the most recent issuance with soft-deleted history included. This intentionally prevents address changes or failed delivery from resetting the send budget. For any positive remaining duration, return `429` and ceiling-rounded `Retry-After` seconds, minimum one.

Once allowed, generate the code, invalidate existing unconsumed OTPs, and insert a new OTP for the locked email in one transaction. Sample issuance/expiry timestamps after obtaining the account lock; expiry remains ten minutes. Insert or commit failure must not trigger provider delivery, and a failed transaction preserves the preceding OTP state.

Release the transaction before calling Resend. Delivery uses that committed issuance's email, code, and OTP ID, not a reread of mutable account state. A subsequent change/resend may invalidate the OTP before delivery completes. Provider success still returns `200`; verification subsequently applies current-state and stale-code rules.

On provider failure, return `500 VERIFICATION_SEND_FAILED` and attempt a short cleanup transaction with the same account-first lock order. Invalidate only the issued OTP ID, and only if still undeleted and unconsumed. Zero affected rows is valid. Cleanup must not invalidate a newer/consumed OTP or clear user verification. Cleanup failure is logged without the code and retains the send-failure response; the issued row may remain pending until expiry. The cooldown still applies. This does not promise atomic provider delivery and database commit.

## Compatibility and limitations

Existing clients send only `code` and already handle the reused [invalid/expired machine codes](../../frontend/src/lib/errorLocalization.ts). This packet requires no frontend change. A verification success describes its committed operation; clients reconciling concurrent address changes must reload account state.

Invalidation applies to **OTP records**, not every historical numeric value. A new six-digit code can coincide with old digits. A submission matching the newest usable row is accepted as that new proof, regardless of which message supplied the digits. Tests must not promise universal rejection of all old numeric values. Stronger issuance binding and attempt limits need separate approved contracts.

The approved observable choices are atomic email change/invalidation, newest-pending-only verification, strict expiry at consumption, one verification winner, and a cooldown covering deleted history and provider failures. Existing pending rows need no migration: verification selects only the newest pending current-email row, and an email change invalidates all unconsumed rows.

## Acceptance tests

Use a migrated **disposable PostgreSQL** database configured through `OPENCW_TEST_DATABASE_DSN`, following [existing integration-test setup](../internal/handlers/v1/auth_test.go). Confirm the verified-email unique index exists. Use isolated fixtures and cleanup; tests must not alter production schemas or send real email. Stub provider delivery.

Use separate connections, explicit gates/barriers, and bounded waits. Assert HTTP responses and committed database state, including soft-deleted OTPs. Do not copy an all-workers barrier after `SELECT users ... FOR UPDATE`: its first worker would hold the lock while waiting for workers blocked by it. Gate contenders before locking, or pause only the chosen lock holder and observe the contender attempting the operation before release. Scheduling sleeps are not proof of ordering.

| Scenario                                                             | Required result                                                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal, wrong, expired, malformed, and earlier-guard cases           | Exact responses above; only valid verification consumes a row and verifies the user                                                                           |
| Update commits before Verify; Verify has an old middleware snapshot  | Old-address OTP returns invalid for an otherwise eligible account; new address stays unverified                                                               |
| Verify holds the account lock first; Update waits                    | Verify succeeds for the old address; subsequent Update leaves the new address unverified                                                                      |
| Eight simultaneous verifies of one valid OTP                         | One `200`; seven `400 EMAIL_ALREADY_VERIFIED`; one consumed OTP                                                                                               |
| A to B to A, without a new issuance                                  | Original OTP row stays invalidated; original code cannot verify A                                                                                             |
| New issuance deliberately reuses old digits                          | Only the new usable row is consumed; old row stays invalidated, documenting the code-only limitation                                                          |
| Resend commits before old-code verification                          | Superseded OTP fails; newest code succeeds; include legacy multiple-pending rows and equal timestamps                                                         |
| Concurrent sends inside one cooldown window                          | One issuance/provider call; contenders return `429` with positive ceiling-rounded `Retry-After`; address changes and provider failure do not reset the budget |
| Send waits behind Update with an old middleware snapshot             | Issued OTP and recipient use the locked new address                                                                                                           |
| Issuance commits; provider pauses; Update commits; provider succeeds | Message targets the issued old address; old OTP cannot verify the new address                                                                                 |
| OTP expires while Verify waits for the user lock                     | Matching newest pending code returns expired; neither mutation commits; equality at expiry is expired                                                         |
| Two accounts verify the same unclaimed exact email                   | One success, one `409 EMAIL_VERIFIED_BY_ANOTHER_ACCOUNT`; losing consumption rolls back; no duplicate verified owner                                          |
| Failed-delivery cleanup overlaps newer issuance or verification      | Only its still-pending issued row is invalidated; newer/consumed rows and verified state survive                                                              |
| Consume, user write, invalidation, insert, begin, or commit fails    | Correct `500`, no success response or unauthorized partial effect, no provider call before issuance commit; test cleanup failure separately                   |
| Middleware state disagrees with current row                          | Guards use locked current email/verification, including unchanged-email comparison and a user deleted after middleware loaded it                              |

For lost commit/connection acknowledgements, do not infer that an error proves rollback. Assert no success response and invariant preservation in whichever outcome actually committed. Fault injection must distinguish definite write failure from an unknown commit outcome.

## Implementation and validation

The implementation uses a focused shared transaction/lock helper and typed domain outcomes; HTTP handlers map completed outcomes to responses. Provider I/O stays outside transactions, and delivery is injectable without a new dependency. The [V1 API guide](../API.md) records source behavior.

Acceptance requires the deterministic PostgreSQL cases and existing refresh-rotation test to pass, then recorded `go test ./...`, `go vet ./...`, formatting, and `git status --short`, including exit codes and test counts. A skipped PostgreSQL suite is an unmet concurrency gate, not successful validation.

Validation recorded on 2026-10-13 with Go 1.27.1 and an isolated, migrated PostgreSQL 18.6 fixture: the full backend suite passed 99 test records (27 top-level tests and 72 subtests), with no failures or skips, including the existing refresh-rotation test. `go test -count=1 -json ./...`, `go vet ./...`, and formatting/diff checks exited 0. The [email regression suite](../internal/handlers/v1/email_verification_test.go) covers the acceptance matrix using stubbed delivery, observed database lock waits, and transaction fault injection. Independent source review found no surviving bypass or regression within this packet.

**Approval recorded: 2026-10-13.** The user approved the transaction rules, reused stale-code responses, collision limitation, and cooldown policy, and explicitly authorized one backend implementation packet covering the three email routes, cleanup, helper, API documentation, and tests. This authorization does not include deployment.
