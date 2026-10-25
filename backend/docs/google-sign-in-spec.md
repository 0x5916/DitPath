# Google sign-in specification

Status: approved on 2026-10-25. The owner explicitly authorized implementation using `user_identities`, including the Google integration and optional configuration wiring described here. Implementation and acceptance evidence are tracked below. Production migration, credentials, and deployment remain separate from this authorization. [Agent rules](../../AGENTS.md) govern implementation and verification.

## Intended behavior and scope

Add Google's standard sign-in button to Login and Register. Returning Google users receive the existing OpenCW access/refresh token pair. New Google users choose an OpenCW username before an account is created. Keep the static Svelte frontend, Go API, existing password sign-in, and immutable account UUIDs used by training synchronization.

Use the Google Identity Services (GIS) JavaScript popup/callback integration. Load Google's hosted `https://accounts.google.com/gsi/client` only on configured authentication pages in the browser. Request identity only; no Google API access, Google refresh tokens, One Tap, automatic sign-in, or OAuth client secret is needed for this flow. Use the existing Go JWT library and standard library; add no package dependencies. Approval must include the hosted GIS script as an external browser integration.

External identity is the verified issuer and signed token's `sub`, never its email or display name. Google is the first provider in a separate identity table so additional providers do not require columns on `users`. Do not automatically link to an existing password account. A verified-email ownership conflict asks the person to use their existing sign-in method. Explicit account linking, adding a password to a Google-only account, and account recovery are separate future packets. This means existing password users cannot switch their current account to Google through this proposal.

## API contract

Both endpoints require `Content-Type: application/json`, a nonempty allowed browser `Origin`, and `X-OpenCW-Auth: google`. Use the existing complete-body 16 KiB cap and error envelope. Never accept credentials from query strings, form submissions, or redirects. All responses use `Cache-Control: no-store`.

| Endpoint                        | JSON body                         | Success                                                                                                           | Admission                                                   |
| ------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `POST /v1/auth/google`          | `credential`, `nonce`             | `200`, existing [AuthTokenPairResponse](../internal/common/response.go), for a registered Google subject          | Existing login source quota and shared process quota        |
| `POST /v1/auth/google/register` | `credential`, `nonce`, `username` | `200`, existing token pair, after account creation; an already-registered subject signs into its original account | Existing registration source quota and shared process quota |

`credential` is the Google ID token, at most 12 KiB. `nonce` is 32 cryptographically random bytes encoded as unpadded base64url; the browser generates it per mounted sign-in flow, passes it to GIS, and retains it only in memory. The server requires the signed nonce claim to equal the submitted value. This nonce comparison supplements the required Origin/header protection; it is not a server-issued, single-use challenge. Like other bearer credentials, an intercepted valid token may be replayed until expiry. A server challenge/replay store is outside this packet.

Validate `username` using the existing [registration validator](../internal/utils/validation.go). Ignore submitted usernames for an already-registered Google subject. Verify the Google credential again on every request, including username retries; an expired credential requires another Google sign-in. No account, refresh token, or training partition is created by a username-required response.

| Condition                                                                                    | Response                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Integration disabled                                                                         | `503 GOOGLE_SIGN_IN_DISABLED`                                             |
| Missing, null, malformed, or unapproved Origin; absent/wrong custom header                   | `403 GOOGLE_REQUEST_REJECTED`                                             |
| Unsupported media type                                                                       | `415 GOOGLE_JSON_REQUIRED`                                                |
| Oversized body / malformed input                                                             | Existing `413 REQUEST_BODY_TOO_LARGE` / `400 INVALID_REQUEST_BODY`        |
| Malformed, invalid, expired, wrong-audience/issuer/algorithm, or nonce-mismatched credential | `401 GOOGLE_CREDENTIAL_INVALID`                                           |
| Valid unknown subject on the sign-in endpoint                                                | `409 GOOGLE_SIGNUP_REQUIRED`                                              |
| New account conflicts with an existing verified email owner                                  | `409 GOOGLE_ACCOUNT_CONFLICT`                                             |
| New username conflict                                                                        | Existing `409 USERNAME_ALREADY_IN_USE`                                    |
| Google keys unavailable or verification capacity occupied                                    | `503 GOOGLE_SIGN_IN_UNAVAILABLE`, `Retry-After: 1`                        |
| Request quota/store refusal                                                                  | Existing auth admission responses and calculated retry headers            |
| Database/token issuance failure                                                              | Existing database/token error codes; no partial account/identity creation |

Precedence: disabled integration, Origin/header/media-type protection, existing source/request admission, body/input validation, Google verification capacity, credential verification, then account outcomes. A verified-email conflict is checked during registration; sign-in for a valid unknown identity first returns `GOOGLE_SIGNUP_REQUIRED`. A soft-deleted identity or an identity owned by a soft-deleted account returns `409 GOOGLE_ACCOUNT_CONFLICT` on either endpoint, without offering registration. Return no email, subject, or account-existence details before successful credential verification. Add all new machine codes to the existing localized error mapping.

## Verification and resource limits

Require an RS256 signature using Google's public keys, `iss` equal to `accounts.google.com` or `https://accounts.google.com`, `aud` equal to the one configured web client ID, required unexpired `exp`, a plausible `iat` with at most 60 seconds of future skew, and a nonempty subject of at most 255 bytes. If `azp` is present, require the configured client ID. Require a syntactically valid email within existing bounds and `email_verified: true` when creating a new account. Never trust the browser's decoded claims or fetch a URL named in a JWT header.

Fetch only `https://www.googleapis.com/oauth2/v3/certs`, with HTTPS verification, no redirects, a three-second timeout, a 64 KiB response cap, and at most 16 cached RSA signing keys. Bound the `kid` header to 128 bytes. Honor upstream freshness up to 24 hours; missing/invalid freshness permits use for this verification only. Never use expired cached keys. Coalesce refreshes across requests, and allow at most one refresh attempt per minute, including unknown-key requests and failed fetches. A missing key in a successfully refreshed set is an invalid credential; inability to obtain a usable key set is unavailable. A legitimate rotation inside the refresh cooldown may temporarily return unavailable.

Share one process-wide verifier, cache, and immediate-refusal gate of four active verifications. Do not queue work or acquire Argon2 reservations for Google authentication. Preserve the existing [source attribution and quota policy](auth-resource-limits-spec.md): Google sign-in shares password login's 10/source/minute budget; Google registration shares password registration's 3/source/minute budget; all share 60/process/minute. Each HTTP request counts once, including the sign-in request before username selection and all registration retries. Preserve cancellation and refusal side-effect guarantees. No process-cluster-wide resource or replay guarantee is claimed.

## Account persistence and password behavior

Keep [User](../internal/models/user.go) as the OpenCW account and add [UserIdentity](../internal/models/user_identity.go) for external sign-in methods. Use the existing [Base](../internal/models/base.go) UUID and timestamp conventions:

| Column                                   | Constraint / meaning                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`                                     | UUID primary key                                                                            |
| `user_id`                                | Required UUID foreign key to `users.id`, indexed, with `ON DELETE CASCADE`                  |
| `provider`                               | Required, nonempty server-selected provider key, at most 32 ASCII bytes; initially `google` |
| `issuer`                                 | Required, nonempty canonical issuer namespace, at most 2048 bytes                           |
| `subject`                                | Required, nonempty provider account identifier, at most 255 bytes; case-sensitive           |
| `created_at`, `updated_at`, `deleted_at` | Existing timestamp and soft-deletion conventions                                            |

Enforce `UNIQUE (issuer, subject)` across all rows, including soft-deleted identities. Enforce `UNIQUE (user_id, provider) WHERE deleted_at IS NULL` for at most one active identity per provider on an account. Existing password users have no identity rows. Store neither Google credentials nor Google names/profile images. Do not attach an identity through email lookup.

Provider and issuer come exclusively from the server's implemented provider policy. Normalize Google's two accepted issuer spellings to `https://accounts.google.com` after token validation, before lookup or persistence. Never derive provider policy, endpoints, or key URLs from client input. Look up identities including soft-deleted rows so a reserved identity cannot be reassigned.

Create the user, identity, and initial refresh token in one transaction; roll back all three on failure. Database constraints, not a preflight lookup, arbitrate duplicate identities/usernames/verified emails. Concurrent registration of the same identity resolves to the original account without creating another UUID. Re-read the live identity and its owning account under the existing [account lock](../internal/utils/user_transaction.go) before token issuance; a soft-deleted identity or owner cannot be revived or reassigned.

Future external providers add rows to this table plus their own verifier, endpoints, configuration, and UI. Each needs approved protocol, issuer/subject, email-trust, and acceptance rules. Explicit linking must require proof of both the existing account and the new provider identity; never merge accounts by matching email. Future unlink/replacement must serialize on the same account lock, preserve historical identity ownership, and prevent removing the final usable sign-in method. Linking/unlinking is not implemented by this Google packet. Passwords remain in the existing column; future passkeys belong in a dedicated credential table rather than an external-identity row.

New Google-only users have an empty `password` sentinel. Password login returns generic `401 INVALID_CREDENTIALS` for these users before Argon2 comparison. Password change returns `409 PASSWORD_NOT_AVAILABLE` after existing authentication/body validation and before password-work admission. Add additive `password_enabled: boolean` to `GET /v1/user/me`; settings shows a localized Google sign-in notice instead of the password form when false. Existing password accounts retain current behavior. Do not treat an empty password as a credential or invent a hidden random password.

Copy the validated Google email at creation. Mark it locally verified only when Google is authoritative: Gmail, or a verified hosted-domain account. Other Google accounts retain local `email_verified=false` and use the existing email verification flow. As in password registration, precheck for an existing verified owner even when creating an unverified account. This precheck describes the observed state; the partial unique index guarantees concurrent exclusion only between locally verified rows. Retain the current exact-value verified-email uniqueness policy; matching unverified email rows may remain separate accounts and are never merged. No new email normalization or ownership claim is introduced.

After creation, resolve sign-in solely by canonical issuer and subject. Google email changes must not overwrite the local address or verification status. Existing local email changes do not detach Google identity. Preserve existing refresh rotation, logout, local storage rollback, session fencing, account UUID partitions, and explicit guest-history import.

## Configuration and frontend acceptance

Introduce optional backend `GOOGLE_CLIENT_ID` and frontend build-time `PUBLIC_GOOGLE_CLIENT_ID`, with empty defaults and matching values when enabled. Backend audience validation never uses a request-supplied client ID. A nonempty value must be a valid Google web client ID. For Google routes in every runtime mode, allow exact origins from nonempty `CORS_ORIGINS`, otherwise only `https://opencw.net`. Localhost origins must be explicitly configured. Do not inherit the current development-mode allow-all behavior. When enabling Google, reject malformed, wildcard, or null allowlist entries at startup. Permit HTTPS origins and explicit HTTP localhost origins only, without paths, credentials, queries, or fragments. Allow the custom header only for these origins on Google routes, including preflight, and enforce the same allowlist again in the handlers. Preserve existing CORS behavior for other clients and routes.

When the frontend ID is empty, render the existing forms and do not load GIS. When configured, render Google's official button alongside them. New users see one username field after Google authentication; do not request a local password. Keep the token/nonce only in memory until submission, cancellation, route disposal, or expiry. Reuse [auth session persistence](../../frontend/src/lib/auth.ts), and fence callbacks and pending username completion against route disposal, newer login attempts, logout, and cross-tab account changes. Handle SDK failures, canceled popups, duplicate submissions, and blocked storage without trapping the forms or activating stale credentials.

Update all five source message catalogs. Check keyboard navigation, visible focus, 44px targets, mobile/tablet/desktop layouts, both themes, and all locales. Existing password forms must remain usable when Google fails. Auth/API responses and the GIS script must stay outside the service-worker cache.

Repository implementation approval includes optional environment templates, Docker build arguments, and Compose passthrough for the two client-ID settings, plus setup documentation. Actual migration, live credentials, Cloud Console changes, deployment, and production header/origin changes need separate authorization. Activation requires an owner-supplied web client ID, OAuth branding, and authorized JavaScript origins. Popup/cross-origin headers must be verified in the deployed browser; do not weaken them speculatively.

## Acceptance gates and packet boundary

The approved implementation packet covers Google identity verification, persistence, browser sign-in and username completion, password capability, optional configuration wiring, and their tests. Do not present mocked tests as evidence of a successful live Google sign-in.

- Verifier tests use local RSA keys, a fake clock, and injected HTTP transport. Cover invalid signatures/algorithms/claims/nonces, missing/oversized headers and claims, rotating/expired keys, blocked redirects, timeout/body/key caps, unavailable Google, refresh coalescing/cooldown, and four-verifier concurrency/cancellation.
- Registered-router tests cover Origin/header/media-type/body precedence, CORS preflight, existing source quotas, no denied-request side effects, disabled mode, and every new error envelope. Do not call Google or email providers in tests.
- Disposable PostgreSQL tests cover new/returning identities, canonical Google issuer aliases, explicit username selection, duplicate-identity races, conflict rollback, soft-deleted identities/owners, issuer-and-subject uniqueness, one active identity per account/provider, absence of email linking, verified versus third-party email behavior, Google-only password refusal, password-capability responses, and existing password/refresh regressions. Assert provider policy is server-selected and future provider namespaces cannot collide with Google. Skipped database tests leave acceptance incomplete.
- Frontend tests cover credential exchange, username completion, failure recovery, blocked storage, stale SDK callbacks, competing authentication attempts, and preservation of the existing immutable-account synchronization partition.
- Run `go test ./...`, `go vet ./...`, focused race tests, and frontend verify/lint/build with repository-required runtimes. Record exit codes, pass/skip counts, browser coverage, and `git status --short`. A real Google sign-in with the configured client ID is required before claiming live integration works.

## Implementation and local validation

Implementation is present in the identity model/migration, Google handlers and route protection, process-shared verifier, frontend authentication flow, five locale catalogs, and optional configuration wiring. No new package dependencies were added. On 2026-10-25, local verification with Go 1.27.3, Node 26.12.1, and an isolated PostgreSQL 18.6 database recorded:

- `go test -count=1 -p 1 -json ./...`: exit 0, 1,225 test/subtest records (220 top-level tests), zero failures or skips. The additive migration/preservation test and registered Google success flow ran against the disposable database.
- Focused `go test -race`: verifier 55 records, Google handlers/constraints 42 records, and Google router 11 records; all exit 0, with zero failures or skips. The handler suite covers concurrent registration, identity reservation, account-lock rechecks, and rollback after token-write failure. Focused configuration race checks also exited 0.
- `go vet ./...`: exit 0. The first full database run exposed three existing fixtures that compare UTC timestamp representations; running the test process with `TZ=UTC` resolved them without changing application behavior.
- Frontend `npm run verify`: exit 0, 545 tests in 44 files, zero type errors/warnings, and all 560 message keys validated across five catalogs. Final `npm run lint` and `npm run build` exited 0. Svelte autofixer found no Google component issues; route suggestions concerned existing intentional effects.
- Headless browser checks: six scenarios passed with the Google SDK/API stubbed, including new/returning accounts, canonical username persistence, Google-only settings, cancellation, SDK failure, and stale callbacks. Login and username completion fit 30 locale/viewport/theme combinations, with keyboard checks and no uncaught page errors. A separate production-static-build check passed with Google disabled: the password form remained visible and no Google controls or SDK requests appeared.
- Root and development Compose configuration checks, documentation link checks, formatting, and `git diff --check` passed. Final working-tree status was captured with the change.

The disposable database and temporary frontend servers were removed after verification. Application databases, live credentials, Google Cloud settings, and deployed services were not changed. A live Google sign-in using an owner-configured client ID and authorized origins remains an acceptance gate before claiming production integration works.

## References

Google's [callback integration and CSRF guidance](https://developers.google.com/identity/gsi/web/guides/integrate) supports the selected browser-to-API flow. Its [ID-token verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) defines identity and email authority. The [JavaScript API](https://developers.google.com/identity/gsi/web/reference/js-reference) describes nonce and official button rendering; [setup guidance](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) covers client IDs, allowed origins, and browser headers. [OpenID Connect claim stability](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability) defines issuer-plus-subject identity for OIDC providers. The repository-specific schema, quotas, transaction behavior, error codes, and packet boundaries above are approved OpenCW decisions.
