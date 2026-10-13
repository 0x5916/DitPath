# DitPath backend development

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

To run Go on the host instead, start `docker compose up -d db`, keep `DB_HOST=localhost` in `.env`, and run `go run ./cmd/api-server`. Development mode loads `.env` and enables profiling; keep its `/debug/pprof/*` routes private. The [production Dockerfile](Dockerfile) builds a static binary and sets `GIN_MODE=release`, which disables profiling.

## Verification and contracts

```bash
go test ./...
go vet ./...
```

[V1 API](API.md) covers authentication, settings, progress, and forum routes. [V2 training synchronization](docs/training-events-v2.md) defines event ingestion and snapshots. [Request schemas](internal/common/input.go), [response schemas](internal/common/response.go), and [router registration](internal/server/router.go) define the implemented wire contracts.

Backend startup runs GORM migrations. Preserve data before changing revisions; image rollback does not reverse a schema migration. Local `docker compose down -v` removes both PostgreSQL and pgAdmin named volumes.
