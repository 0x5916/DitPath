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

Registration accepts a 3–16 character username using ASCII letters, digits, `_`, and `-`, beginning and ending with a letter or digit. Email must be valid and at most 254 characters; password must be 8–256 characters. Verification uses six numeric characters, expires after 10 minutes, and email requests are limited to one per minute with `Retry-After` on 429. A verified email cannot be claimed by another user. Changing email resets its verification state.

Issued access tokens are HS256 JWTs valid for 15 minutes. Issued refresh tokens are opaque 64-character hexadecimal strings valid for 30 days; the database stores their SHA-256 hashes. Refresh and logout do not require an access bearer token. Clients must replace both tokens after refreshing. Logout revokes the submitted refresh token but does not revoke an already-issued access JWT. See [auth handler](internal/handlers/v1/auth.go), [token helpers](internal/utils/token.go), and [username validator](internal/utils/validation.go).

Example registration body:

```json
{
  "username": "operator1",
  "email": "operator@example.com",
  "password": "example-password"
}
```

A token-pair response contains `access_token` and `refresh_token`; send the returned opaque refresh value unchanged to refresh/logout. Keep bearer and refresh tokens private.

## User and settings

| Method and path          | JSON body                                    | Success                                   |
| ------------------------ | -------------------------------------------- | ----------------------------------------- |
| `GET /v1/user/me`        | None                                         | 200: `UserInfoResponse`                   |
| `PUT /v1/user/callsign`  | `call_sign`                                  | 200: `message`                            |
| `PUT /v1/user/email`     | `email`                                      | 200: `message`; clears email verification |
| `PUT /v1/user/password`  | `old_password`, `new_password`               | 200: `message`                            |
| `GET /v1/settings/all`   | None                                         | 200: `cw_settings`, `page_settings`       |
| `GET /v1/settings/cw`    | None                                         | 200: CW settings                          |
| `GET /v1/settings/page`  | None                                         | 200: page settings                        |
| `POST /v1/settings/cw`   | `char_wpm`, `eff_wpm`, `freq`, `start_delay` | 200: `message`                            |
| `POST /v1/settings/page` | `language`, `cur_lesson`                     | 200: `message`                            |

All routes above require bearer authentication. Call sign is nonempty and at most 254 characters. Password changes verify the old password; both fields require 8–256 characters. CW speed fields each accept 5–50, frequency 300–2000 Hz, and start delay 0–10 seconds. V1 does not enforce `eff_wpm <= char_wpm`. Page settings require a nonempty language and nonzero lesson; the schema does not define a locale allowlist or lesson upper bound.

CW responses use `char_wpm`, `eff_wpm`, `freq`, and `start_delay`; page responses use `language` and `cur_lesson`. Existing settings include `updated_at`; absent settings return model defaults, with the individual CW/page fallback using the input shape without that timestamp. The combined settings response includes both response shapes. User info includes nullable `call_sign`, `username`, `email`, `email_verified`, and `created_at`. See [user handler](internal/handlers/v1/user.go), [settings handler](internal/handlers/v1/settings.go), and [CW defaults](internal/models/cw_settings.go) and [page defaults](internal/models/page_settings.go).

## Legacy progress

| Method and path       | Request                                                                   | Success                                 |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| `GET /v1/cw/progress` | None                                                                      | 200: `data` array of `ProgressResponse` |
| `PUT /v1/cw/progress` | `lesson`, `char_wpm`, `eff_wpm`, `accuracy`, optional `client_created_at` | 201: `message`                          |

Both require bearer authentication. Lesson must be nonzero; speeds each accept 5–50 and accuracy 0–1. `client_created_at` is a JSON timestamp. Response entries contain `lesson` as a string, speed fields, accuracy, server `created_at`, and nullable `client_created_at`. There is no registered bulk-progress route. See [progress handler](internal/handlers/v1/progress.go).

## Forum

| Method and path                      | Access          | Request                                       | Success                                               |
| ------------------------------------ | --------------- | --------------------------------------------- | ----------------------------------------------------- |
| `GET /v1/forum/threads`              | Public          | Query: optional `category`, `limit`, `cursor` | 200: `data`, `total`, `limit`, nullable `next_cursor` |
| `GET /v1/forum/threads/:id`          | Public          | UUID path                                     | 200: `data` thread                                    |
| `GET /v1/forum/threads/:id/replies`  | Public          | UUID path                                     | 200: `data` reply tree, `total`                       |
| `POST /v1/forum/threads`             | Verified bearer | `category`, `title`, `body`                   | 201: `data` thread                                    |
| `POST /v1/forum/threads/:id/replies` | Verified bearer | `body`, optional `parent_id`                  | 201: `data` reply                                     |
| `DELETE /v1/forum/threads/:id`       | Author bearer   | UUID path                                     | 200: `message`                                        |
| `DELETE /v1/forum/replies/:id`       | Author bearer   | UUID path                                     | 200: `message`                                        |

Categories are `general`, `help`, `showcase`, and `feedback`. Title length is 3–200; thread/reply body length is 1–10000. `parent_id` must reference a live reply in the same thread. Thread pages default to 20 results, accept limits 1–100, and sort newest first. Treat cursors as opaque and send `next_cursor` back unchanged. `total` counts matching live threads independently of the current cursor.

Creation is limited to five requests per user per minute across threads and replies, returning 429 with `Retry-After`. Deletes require ownership and soft-delete content. Deleted replies with visible descendants remain as tombstones with `is_deleted=true` and null body/author; deleted leaves disappear. Thread responses include IDs, category/title/body, nullable author, counts, and timestamps; reply responses include nullable parent ID, body/author, `is_deleted`, and nested `children`. Exact shapes are in [response schemas](internal/common/response.go). See [forum handler](internal/handlers/v1/forum.go) and [creation limiter](internal/middlewares/forum_rate_limit.go).

## Errors and browser access

Errors use `{"code":"MACHINE_CODE","error":"Human-readable message"}`. Handle machine codes instead of matching message text. The complete code catalog is [common/error.go](internal/common/error.go); route-specific outcomes are in the handlers. Typical statuses are 400 for invalid bodies/queries, 401 for missing or invalid authentication, 403 for unverified posting or ownership failures, 404 for missing content, 409 for conflicts, 429 for rate limits, and 500 for internal/storage failures.

In release mode the CORS middleware allows configured `CORS_ORIGINS`, falling back to `https://opencw.net` when the allowlist is empty. Non-release mode permits origins. Allowed origins receive credentials, method/header permissions, and a 204 preflight response. CORS is browser policy; it does not replace bearer authentication. Production disables development profiling routes.
