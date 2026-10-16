# DitPath V1 API

The backend registers `/v1` and `/v2`. This reference covers every V1 route; [V2 training synchronization](docs/training-events-v2.md) has a separate contract. Requests with bodies use JSON. Protected routes require `Authorization: Bearer ACCESS_TOKEN` and an existing user.

The [router](internal/server/router.go) defines route protection. Exact JSON fields and validation tags are in [request schemas](internal/common/input.go); response types are in [response schemas](internal/common/response.go). Handlers linked below define status codes and side effects.

## Authentication and health

| Method and path                         | Access        | Request                                                   | Success                                                  |
| --------------------------------------- | ------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `GET /v1/health`                        | Public        | None                                                      | 200: `status` and Unix `timestamp`                       |
| `POST /v1/auth/register`                | Public        | `username`, `email`, `password`                           | 200: `access_token`, `refresh_token`                     |
| `POST /v1/auth/login`                   | Public        | `identifier`, `password`; identifier is username or email | 200: token pair                                          |
| `POST /v1/auth/refresh`                 | Refresh token | `refresh_token`                                           | 200: new token pair; revokes the submitted refresh token |
| `POST /v1/auth/logout`                  | Refresh token | `refresh_token`                                           | 200: `message`; revokes the matching refresh token       |
| `POST /v1/auth/send-verification-email` | Bearer        | None                                                      | 200: `message`                                           |
| `POST /v1/auth/verify-email`            | Bearer        | `code`                                                    | 200: `message`                                           |
| `GET /v1/hello`                         | Bearer        | None                                                      | 200: `message`                                           |

Registration accepts a 3–16 character username using ASCII letters, digits, `_`, and `-`, beginning and ending with a letter or digit. Email must be valid and at most 254 characters; password must be 8–256 characters. A verified email cannot be claimed by another live user.

Issued access tokens are HS256 JWTs valid for 15 minutes. Issued refresh tokens are opaque 64-character hexadecimal strings valid for 30 days; the database stores their SHA-256 hashes. Refresh and logout do not require an access bearer token. Clients must replace both tokens after refreshing. Logout revokes the submitted refresh token but does not revoke an already-issued access JWT. See [auth handler](internal/handlers/v1/auth.go), [token helpers](internal/utils/token.go), and [username validator](internal/utils/validation.go).

Example registration body:

```json
{
  "username": "operator1",
  "email": "operator@example.com",
  "password": "example-password"
}
```

A token-pair response contains `access_token` and `refresh_token`; send the returned opaque refresh value unchanged to refresh/logout. Keep bearer and refresh tokens private. Refresh rotation and credential-based token issuance lock the live account and recheck current token/password state. A database transaction begin/commit failure returns `500 INTERNAL_SERVER_ERROR` without a successful token pair.

Authentication and account JSON consumers enforce a complete **16 KiB** encoded-body limit, including unknown-length/chunked bodies and trailing content. Oversize bodies return `413 REQUEST_BODY_TOO_LARGE` with `Cache-Control: no-store` before password work or mutations. Exactly 16 KiB remains eligible for ordinary validation. Public login/registration quota admission still precedes this check; protected routes authenticate/load the user first. See the [body binder](internal/handlers/v1/auth_json.go) and [hardening contract](docs/backend-hardening-spec.md).

### Authentication resource admission

Public login and registration use the [approved password work and auth throttling policy](docs/auth-resource-limits-spec.md). A source may receive 10 login admissions and 3 registration admissions in a rolling 60 seconds; both endpoints also share 60 admissions per process in that interval. The [public admission middleware](internal/middlewares/auth_rate_limit.go) resolves the source and applies the [request limiter](internal/authlimits/limiter.go) before JSON validation or account lookup. Every admission counts, including malformed bodies, successful and failed authentication, conflicts, internal failures, and a later password-capacity refusal. Source-resolution failures and request quota/store denials consume no admission; success and cancellation after admission do not refund quota. An admission exactly 60 seconds old has expired.

After body validation, login and registration acquire one of two shared password-work reservations before any account-specific lookup or conflict check. Saturation refuses immediately with no waiting queue, giving syntactically valid known/unknown identifiers the same capacity response without lookup. The [password service](internal/utils/password.go) also gates all password helpers and authenticated password changes. A password change holds one reservation across old-password comparison and replacement hashing. Reservations release before final account/password persistence or token issuance; cancellation suppresses later steps after it is observed. Existing password parameters, validation, credential/conflict outcomes, and successful responses remain.

| Admission refusal                                                 | Status and code              | Message                                                      | Headers                                                                   |
| ----------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Source/endpoint or combined request quota exhausted               | `429 AUTH_RATE_LIMITED`      | Too many authentication requests. Please wait and try again. | Ceiling-rounded positive integer `Retry-After`; `Cache-Control: no-store` |
| Password-work saturation or a new source cannot fit after pruning | `503 AUTH_CAPACITY_EXCEEDED` | Authentication is temporarily busy. Please try again.        | `Retry-After: 1`; `Cache-Control: no-store`                               |
| Safely validated transport source unavailable                     | `500 INTERNAL_SERVER_ERROR`  | Internal server error                                        | `Cache-Control: no-store`                                                 |

Public precedence is source resolution, request quota/store admission, complete-body size checking, JSON validation, password reservation, then existing authentication outcomes. Thus over-quota malformed bodies receive `429`, admitted malformed bodies receive `400`, and admitted valid requests at work saturation receive `503` while retaining their request charge. Request quota exhaustion takes precedence over a full source store. Protected password changes retain bearer authentication, user loading, and body validation before password-work admission.

Source identity uses the canonical TCP peer by default. Only peers covered by the optional `AUTH_TRUSTED_PROXY_CIDRS` setting may supply `X-Forwarded-For`; all header fields and chain elements are validated by the [auth-only resolver](internal/authlimits/source.go). Other forwarding/platform headers and Gin shortcuts do not supply quota identity. The setting defaults to empty, affects only these public auth routes, and is configured in the [backend guide](README.md#authentication-source-attribution) or [deployment guide](../DEPLOYMENT.md#authentication-source-attribution).

These budgets are per process: restart resets history and extra instances multiply limits. Users sharing an IP, NAT, or untrusted proxy peer share source quotas. Health, refresh, logout, email verification, password changes, other methods, unknown routes, and preflights do not consume public request quotas. Body-size and OTP guessing limits apply separately as described here; public admission controls do not bound total process memory or all database work.

## Email verification

Verification, email changes, code issuance, and failed-delivery cleanup serialize on the live account row in PostgreSQL. They use the authenticated account ID to read its current email and verification state under that lock. The [email transaction helper](internal/handlers/v1/email_verification.go) owns this behavior; the [approved race specification](docs/email-verification-race-spec.md) owns its acceptance requirements.

`POST /v1/auth/verify-email` keeps the existing six-character numeric validation in the [request schema](internal/common/input.go). It accepts only the newest pending OTP for that account's current exact email, ordered by creation time and ID. Pending means unconsumed and not soft-deleted. The matching row must have `expired_at > clock_timestamp()` when consumed; equality is expired. Consumption and setting `email_verified=true` commit together. The verified-email unique index prevents two live accounts from verifying the same exact address.

After the body-size check, verification guards run in this order: missing live account (`401 USER_NOT_FOUND`), already verified (`400 EMAIL_ALREADY_VERIFIED`), another verified owner (`409 EMAIL_VERIFIED_BY_ANOTHER_ACCOUNT`), invalid body (`400 INVALID_REQUEST_BODY`), then OTP eligibility. Missing OTPs and wrong, superseded, or invalidated codes use `400 VERIFICATION_CODE_INVALID` while the current OTP budget allows; a matching newest pending code that has expired uses `400 VERIFICATION_CODE_EXPIRED`. Exhausted OTPs return the refusal below even when the submitted digits match. Earlier guards retain precedence for stale submissions. A concurrent verified-owner conflict rolls back consumption and returns the same `409`; other verification database failures use `500 DATABASE_FAILURE`.

Each OTP has a persistent five-failure budget. Syntactically valid wrong guesses against the newest, unexpired pending OTP commit one failure: the first four return invalid-code status; the fifth and subsequent requests return `429 VERIFICATION_ATTEMPTS_EXCEEDED`, `Cache-Control: no-store`, and positive ceiling-rounded `Retry-After` for the remaining issuance cooldown (minimum one). A new issuance replaces that exhausted OTP and starts at zero; malformed bodies, missing OTPs, and expired non-exhausted OTPs do not spend a guess. Exhaustion retains the newest row so older pending codes never become eligible. Counter storage/commit failures return `500 DATABASE_FAILURE`, with no false successful verification. See [attempt regression tests](internal/handlers/v1/verification_attempts_test.go).

`PUT /v1/user/email` atomically changes the address, clears verification, and invalidates every unconsumed account OTP across addresses. Consumed history remains. Changing A to B and back to A does not restore an invalidated row. Its guard order is invalid body, missing live account, unchanged locked current email (`400 EMAIL_UNCHANGED`), then verified-owner conflict. Owner-query failures use `500 DATABASE_FAILURE`; duplicate-key update conflicts use `409 EMAIL_ALREADY_IN_USE`; other email-update transaction failures use `500 INTERNAL_SERVER_ERROR`.

`POST /v1/auth/send-verification-email` checks the locked current account, verified ownership, then a one-minute cooldown per account across addresses. History includes soft-deleted issuances and provider failures. Any positive cooldown returns `429 VERIFICATION_RATE_LIMITED` with ceiling-rounded `Retry-After` seconds, at least one. An allowed issuance invalidates earlier pending rows and inserts a new code expiring in ten minutes in one transaction. Database failures use `500 DATABASE_FAILURE`; generation failures use `500 INTERNAL_SERVER_ERROR`.

Delivery starts after issuance commits and targets that issuance's email, even if a later email change invalidates its code. Provider success returns `200`; failure returns `500 VERIFICATION_SEND_FAILED` and attempts bounded cleanup of only the issued, still-pending row. Cleanup failure retains the send-failure response and the cooldown. Verification success describes its committed operation; clients reconciling concurrent address changes must reload account state.

Invalidation applies to OTP rows. A newly issued code may reuse old digits; a submission matching the newest usable row is accepted as that new proof. Clients still send only `code`; existing stale/expired codes remain, with the additional attempts-exhausted outcome above. See the [auth handler](internal/handlers/v1/auth.go) and [user handler](internal/handlers/v1/user.go).

## User and settings

| Method and path          | JSON body                                    | Success                                                          |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------------- |
| `GET /v1/user/me`        | None                                         | 200: `UserInfoResponse`                                          |
| `PUT /v1/user/callsign`  | `call_sign`                                  | 200: `message`                                                   |
| `PUT /v1/user/email`     | `email`                                      | 200: `message`; clears verification and invalidates pending OTPs |
| `PUT /v1/user/password`  | `old_password`, `new_password`               | 200: `message`                                                   |
| `GET /v1/settings/all`   | None                                         | 200: `cw_settings`, `page_settings`                              |
| `GET /v1/settings/cw`    | None                                         | 200: CW settings                                                 |
| `GET /v1/settings/page`  | None                                         | 200: page settings                                               |
| `POST /v1/settings/cw`   | `char_wpm`, `eff_wpm`, `freq`, `start_delay` | 200: `message`                                                   |
| `POST /v1/settings/page` | `language`, `cur_lesson`                     | 200: `message`                                                   |

All routes above require bearer authentication. Call sign is nonempty and at most 254 characters. Password changes verify the old password; both fields require 8–256 characters. On success, the password and revocation of every active account refresh token commit together. The caller must sign in again; the frontend clears its local session after parsing success. Existing access JWTs retain their 15-minute expiry. A stale concurrent password/login snapshot cannot overwrite the winning password or create a post-change refresh session; it returns `401 INVALID_CREDENTIALS`. Shared account locking also ensures a refresh successor committed before a password change is revoked, and a refresh after that change fails. See [session transactions](internal/handlers/v1/sessions.go) and [tests](internal/handlers/v1/sessions_test.go). CW speed fields each accept 5–50, frequency 300–2000 Hz, and start delay 0–10 seconds. V1 does not enforce `eff_wpm <= char_wpm`. Page settings require a nonempty language and nonzero lesson; the schema does not define a locale allowlist or lesson upper bound.

CW responses use `char_wpm`, `eff_wpm`, `freq`, and `start_delay`; page responses use `language` and `cur_lesson`. Existing settings include `updated_at`; absent settings return model defaults, with the individual CW/page fallback using the input shape without that timestamp. The combined settings response includes both response shapes. User info includes nullable `call_sign`, `username`, `email`, `email_verified`, and `created_at`. See [user handler](internal/handlers/v1/user.go), [settings handler](internal/handlers/v1/settings.go), and [CW defaults](internal/models/cw_settings.go) and [page defaults](internal/models/page_settings.go).

## Legacy progress

| Method and path       | Request                                                                   | Success                           |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| `GET /v1/cw/progress` | Optional `limit`, `cursor`, or `year` summary mode                        | 200: bounded page or year summary |
| `PUT /v1/cw/progress` | `lesson`, `char_wpm`, `eff_wpm`, `accuracy`, optional `client_created_at` | 201: `message`                    |

Both require bearer authentication. Lesson must be nonzero; speeds each accept 5–50 and accuracy 0–1. `client_created_at` is a JSON timestamp. Response entries contain `lesson` as a string, speed fields, accuracy, server `created_at`, and nullable `client_created_at`. Pages default to and allow at most 100 records, ordered by server `created_at,id` descending, with `data`, `limit`, and nullable `next_cursor`. Treat cursors as opaque. `year=1..9999` selects summary mode: `days` contains complete UTC-day counts for that year (at most 366 entries), and `recent` contains the newest 20 records overall. Summary mode cannot combine with `limit`/`cursor`; invalid or duplicate arguments return `400 INVALID_QUERY_PARAMETER`. The profile consumes this summary so its heatmap covers the full selected year. There is no registered bulk-progress route. See [progress handler](internal/handlers/v1/progress.go).

## Forum

| Method and path                      | Access          | Request                                       | Success                                                                 |
| ------------------------------------ | --------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /v1/forum/threads`              | Public          | Query: optional `category`, `limit`, `cursor` | 200: `data`, `total`, `limit`, nullable `next_cursor`                   |
| `GET /v1/forum/threads/:id`          | Public          | UUID path                                     | 200: `data` thread                                                      |
| `GET /v1/forum/threads/:id/replies`  | Public          | UUID path; optional `limit`, `cursor`         | 200: bounded flat `data`, `total`, `total_rows`, `limit`, `next_cursor` |
| `POST /v1/forum/threads`             | Verified bearer | `category`, `title`, `body`                   | 201: `data` thread                                                      |
| `POST /v1/forum/threads/:id/replies` | Verified bearer | `body`, optional `parent_id`                  | 201: `data` reply                                                       |
| `DELETE /v1/forum/threads/:id`       | Author bearer   | UUID path                                     | 200: `message`                                                          |
| `DELETE /v1/forum/replies/:id`       | Author bearer   | UUID path                                     | 200: `message`                                                          |

Categories are `general`, `help`, `showcase`, and `feedback`. Title length is 3–200; thread/reply body length is 1–10000. `parent_id` must reference a live reply in the same thread. Thread pages default to 20 results, accept limits 1–100, and sort newest first. Treat cursors as opaque and send `next_cursor` back unchanged. `total` counts matching live threads independently of the current cursor.

Creation is limited to five requests per user per minute across threads and replies, returning 429 with `Retry-After`. Deletes require ownership and soft-delete content. Reply pages include deletion tombstones with `is_deleted=true` and null body/author, including deleted leaves, preserving stable cursor traversal. Pages are chronological by `created_at,id` ascending, default/max 100; invalid/duplicate arguments return `400 INVALID_QUERY_PARAMETER`. `total` counts live replies and `total_rows` includes tombstones. Live-page totals can change between requests. Parent context is scoped to the same thread and contains a public author and excerpt of at most 160 characters; deleted parents expose neither. Thread responses include IDs, category/title/body, nullable author, counts, and timestamps; reply responses include nullable parent ID, body/author, `is_deleted`, empty `children` arrays, and optional `parent_context`. The frontend renders bounded chronological pages with explicit navigation and readable parent context. Exact shapes are in [response schemas](internal/common/response.go). See [forum handler](internal/handlers/v1/forum.go) and [creation limiter](internal/middlewares/forum_rate_limit.go).

## Errors and browser access

Errors use `{"code":"MACHINE_CODE","error":"Human-readable message"}`. Handle machine codes instead of matching message text. The complete code catalog is [common/error.go](internal/common/error.go); route-specific outcomes are in the handlers. Typical statuses are 400 for invalid bodies/queries, 401 for missing or invalid authentication, 403 for unverified posting or ownership failures, 404 for missing content, 409 for conflicts, 413 for oversized auth/account JSON bodies, 429 for rate/guess limits, 500 for internal/storage failures, and 503 for authentication capacity refusal. The [client error mapping](../frontend/src/lib/errorLocalization.ts) localizes auth admission, oversized-body, and verification-exhaustion codes in all five catalogs without automatic credential retries or registration resubmission.

In release mode the CORS middleware allows configured `CORS_ORIGINS`, falling back to `https://opencw.net` when the allowlist is empty. Non-release mode permits origins. Allowed origins receive credentials, method/header permissions, exposed `Retry-After`, and a 204 preflight response. CORS is browser policy; it does not replace bearer authentication. Production disables development profiling routes.
