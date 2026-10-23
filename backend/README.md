# OpenCW backend development

The Go API entrypoint is [cmd/api-server/main.go](cmd/api-server/main.go). The local [Compose stack](docker-compose.yaml) and [example.env](example.env) are for development; production uses the [root deployment procedure](../DEPLOYMENT.md). Follow the Go version in [go.mod](go.mod).

## Local setup

Run from `backend/`:

```bash
cp example.env .env
openssl rand -base64 32
```

Fill `JWT_SECRET` with the generated value and supply `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; startup validates them. Development database defaults are in the template. Never source `.env` as a shell script.

```bash
docker compose up --build -d
curl http://127.0.0.1:8080/v1/health
```

Compose runs the API, PostgreSQL, and pgAdmin. It overrides the API's database host to `db`; the database uses a named `pgdata` volume. pgAdmin binds to loopback. Image versions and ports are defined in Compose. Database tuning shares the root [tuner](../db/README.md); optional `POSTGRES_*` overrides belong in `backend/.env`.

To run Go on the host instead, start `docker compose up -d db`, keep `DB_HOST=localhost` in `.env`, and run `go run ./cmd/api-server`. Development mode loads `.env` when present and also supports directly injected environment variables; malformed or unreadable dotenv files stop startup. It enables profiling; keep its `/debug/pprof/*` routes private. The [production Dockerfile](Dockerfile) builds a static binary and sets `GIN_MODE=release`, which disables profiling.

### Authentication source attribution

`AUTH_TRUSTED_PROXY_CIDRS` is an optional comma-separated CIDR allowlist for the public login/registration source resolver. It defaults to empty in the [development template](example.env) and [Compose passthrough](docker-compose.yaml), giving direct-peer attribution with no trusted proxies. Startup validates it before connecting to the database; malformed CIDRs, empty list elements, and trust-all prefixes fail startup. It does not change Gin proxy behavior for other routes or provide runtime quota/concurrency tuning.

Keep the setting empty until the owner approves the exact transport-peer CIDRs and verifies that every listed proxy constructs or sanitizes the complete `X-Forwarded-For` chain. Private/Docker ranges and Cloudflare-specific headers do not imply trust. Production allowlist activation requires separate explicit authorization; [deployment](../DEPLOYMENT.md#authentication-source-attribution) owns that setup. With an empty allowlist, users behind the same proxy share its 10 login and 3 registration admissions per rolling minute. The [API contract](API.md#authentication-resource-admission) owns responses and precedence; the [approved specification](docs/auth-resource-limits-spec.md) owns policy and acceptance requirements.

## Verification and contracts

```bash
go test ./...
go vet ./...
go test -race -p 1 ./internal/authlimits ./internal/utils ./internal/middlewares ./internal/server ./internal/handlers/v1 ./internal/handlers/v2 ./internal/training
```

The [email-verification](internal/handlers/v1/email_verification_test.go), [refresh-rotation](internal/handlers/v1/auth_test.go), and [registered auth-route integration tests](internal/server/auth_limits_test.go) require `OPENCW_TEST_DATABASE_DSN` pointing to an already-migrated, disposable PostgreSQL database with the current indexes. They use isolated fixtures and no live email calls. An unset DSN skips database cases; skips do not satisfy the [email race](docs/email-verification-race-spec.md#acceptance-tests) or [auth resource-limit](docs/auth-resource-limits-spec.md#acceptance-tests) acceptance gates.

The [password reservation tests](internal/utils/password_test.go) include lifecycle/cancellation checks, injected concurrency workers, and a real Argon2 round-trip control. [Limiter](internal/authlimits/limiter_test.go) and [source](internal/authlimits/source_test.go) unit tests use isolated policies and clocks; real-router tests verify shared registration/login/password-change work, no rejected-request side effects, response precedence, existing outcomes, and CORS. The packet also requires existing backend regressions and the relevant [frontend verification](../frontend/README.md) for localized error mappings. Record command exit codes and pass/skip counts; test source presence alone is not acceptance evidence.

[V1 API](API.md) covers authentication, settings, training, legacy progress, and forum routes, including V1-only session history and change downloads. [Training synchronization](docs/training-events-v2.md) defines schema-1/schema-2 events, signed download checkpoints, snapshots, settings, and the three temporary V2 aliases. The [approved cross-device specification](docs/training-history-v1-spec.md) records implemented storage, bootstrap, and [frontend synchronization](../frontend/docs/learning.md); V2 removal still requires its compatibility/release gate. [Session validation](internal/common/training_sessions.go), [strict event validation](internal/handlers/v2/training_strict.go), [request schemas](internal/common/input.go), [response schemas](internal/common/response.go), and [router registration](internal/server/router.go) define the wire contracts.

History tests use the same disposable database opt-in. The [migration preservation test](internal/databases/history_migration_test.go) explicitly runs additive migration/re-migration; run it first against a fresh test database. Then run backend tests with `-p 1` and the same DSN to exercise [session writes/rollback](internal/handlers/v2/session_storage_test.go), [bootstrap/pagination](internal/handlers/v2/session_history_test.go), [change-feed/bootstrap/concurrency](internal/handlers/v2/training_changes_test.go), [strict retries/rollback](internal/handlers/v2/training_strict_test.go), and [registered V1 routes](internal/server/session_routes_test.go). These checks use isolated fixtures; [frontend gates](../frontend/README.md) separately verify account partitions, outbox/download transactions, imports, and browser behavior. They do not alter a production database or deploy services.

Backend startup runs GORM migrations and required indexes, and aborts before serving on any migration/index error. The [hardening contract](docs/backend-hardening-spec.md) adds a default-zero non-null OTP failure counter; use a disposable database migrated from the current models for its [guess-budget](internal/handlers/v1/verification_attempts_test.go), [session-race](internal/handlers/v1/sessions_test.go), [body-limit](internal/server/auth_json_test.go), and bounded-history tests. Run database lock-observation suites sequentially (`-p 1`) so unrelated tests cannot supply misleading lock evidence. An unset test DSN must not be reported as a passed database acceptance gate. Preserve data before changing revisions; image rollback does not reverse a schema migration. Local `docker compose down -v` removes both PostgreSQL and pgAdmin named volumes.
