#!/usr/bin/env bash
# Run the backend Go suite against a throwaway, isolated PostgreSQL container.
#
# Why: the PostgreSQL-backed integration tests are skipped unless
# OPENCW_TEST_DATABASE_DSN points at an already-migrated, disposable database
# (see backend/README.md). This script creates that database, bootstraps the
# current schema through the repository's own migration test, runs the suite,
# and removes the container and all of its data afterwards.
#
# Safety properties:
#   * A uniquely named container, a random password, and an ephemeral loopback
#     port. Nothing is read from, written to, or bound over an existing
#     development/production database, and the root/backend .env files are
#     never loaded or modified.
#   * The data directory lives on tmpfs, so it disappears with the container.
#   * The script refuses to continue if the assigned port is 5432 or if the
#     container name already exists.
#   * Before any test writes, the script checks that the new container's public
#     schema is empty. After migration it checks that the schema was created
#     inside that same container, which proves the DSN reached it.
#   * `docker rm -f` runs from an EXIT trap; `--keep` is the explicit opt-out.
#
# Usage: backend/scripts/test-postgres.sh [--verbose] [--race] [--keep] [--host-tz]

set -euo pipefail

BACKEND_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${OPENCW_TEST_POSTGRES_IMAGE:-postgres:18.6-alpine3.24}"
DB_NAME="opencw_test"
DB_USER="opencw_test"

VERBOSE=0
RACE=0
KEEP=0
HOST_TZ=0

usage() {
  cat <<'EOF'
Run the OpenCW backend Go suite against a disposable PostgreSQL container.

Usage
  backend/scripts/test-postgres.sh [options]

Options
  --verbose   add -v (report every test and skip)
  --race      run the documented race subset with the same DSN
  --keep      keep the container for debugging; prints the DSN file path
  --host-tz   use the host timezone instead of TZ=UTC
  -h, --help  show this help

Environment
  OPENCW_TEST_POSTGRES_IMAGE  image to run (default postgres:18.6-alpine3.24)

The DSN lives in a private temporary file. It is never printed, and the
container is removed on exit unless --keep is given.
EOF
}

while (( $# )); do
  case "$1" in
    --verbose) VERBOSE=1 ;;
    --race) RACE=1 ;;
    --keep) KEEP=1 ;;
    --host-tz) HOST_TZ=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v go >/dev/null || { echo "go is required" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencw-test-pg.XXXXXX")"
chmod 700 "$RUN_DIR"
NAME="opencw-test-pg-$(date +%Y%m%d%H%M%S)-$$-${RANDOM}"
DSN_FILE="$RUN_DIR/dsn"
PASSWORD_FILE="$RUN_DIR/password"
CREATED=0
CLEANED=0

cleanup() {
  local code=$?
  if (( CLEANED )); then
    exit "$code"
  fi
  CLEANED=1
  if (( CREATED )) && (( ! KEEP )); then
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    rm -rf "$RUN_DIR"
  elif (( CREATED )); then
    echo "kept container: $NAME"
    echo "kept DSN file:  $DSN_FILE (mode 0600; remove it and the container when finished)"
    echo "remove with:    docker rm -f $NAME"
  else
    rm -rf "$RUN_DIR"
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

if docker container inspect "$NAME" >/dev/null 2>&1; then
  echo "refusing to reuse existing container: $NAME" >&2
  exit 1
fi

umask 077
openssl rand -hex 24 > "$PASSWORD_FILE"

echo "starting disposable PostgreSQL ($IMAGE) as $NAME"
docker run -d --name "$NAME" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$(cat "$PASSWORD_FILE")" \
  -e POSTGRES_DB="$DB_NAME" \
  -e PGDATA=/var/lib/postgresql/18/docker \
  --tmpfs /var/lib/postgresql:rw,size=1g \
  -p 127.0.0.1::5432 \
  --health-cmd "pg_isready -U $DB_USER -d $DB_NAME" \
  --health-interval 2s \
  --health-timeout 5s \
  --health-retries 40 \
  --label opencw.test=go-postgres \
  "$IMAGE" >/dev/null
CREATED=1

health=starting
for _ in $(seq 1 60); do
  health="$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo missing)"
  [[ $health == healthy ]] && break
  sleep 1
done
if [[ $health != healthy ]]; then
  echo "container did not become healthy (status: $health)" >&2
  docker logs --tail 60 "$NAME" >&2 || true
  exit 1
fi

BINDING="$(docker port "$NAME" 5432/tcp)"
PORT="${BINDING##*:}"
if [[ ! $PORT =~ ^[0-9]+$ ]] || (( PORT == 5432 )); then
  echo "refusing unexpected host port: ${BINDING:-<none>}" >&2
  exit 1
fi
if [[ $BINDING != 127.0.0.1:* ]]; then
  echo "refusing non-loopback binding: $BINDING" >&2
  exit 1
fi

printf 'host=127.0.0.1 port=%s user=%s password=%s dbname=%s sslmode=disable TimeZone=UTC' \
  "$PORT" "$DB_USER" "$(cat "$PASSWORD_FILE")" "$DB_NAME" > "$DSN_FILE"

echo "container: $NAME"
echo "target:    127.0.0.1:$PORT (db $DB_NAME, user $DB_USER, tmpfs data)"

TABLES_BEFORE="$(docker exec "$NAME" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "select count(*) from information_schema.tables where table_schema='public';")"
if [[ ${TABLES_BEFORE//[[:space:]]/} != 0 ]]; then
  echo "refusing non-empty database: $TABLES_BEFORE public tables already exist" >&2
  exit 1
fi
echo "verified: new container, empty public schema, loopback-only mapping"

DSN="$(cat "$DSN_FILE")"
cd "$BACKEND_DIR"

ENVIRONMENT=(env -u OPENCW_TEST_DATABASE_DSN)
if (( ! HOST_TZ )); then
  ENVIRONMENT+=(TZ=UTC)
fi

echo "bootstrapping schema through TestHistoryMigrationPreservesData"
"${ENVIRONMENT[@]}" OPENCW_TEST_DATABASE_DSN="$DSN" \
  go test -count=1 -run '^TestHistoryMigrationPreservesData$' ./internal/databases

TABLES_AFTER="$(docker exec "$NAME" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "select count(*) from information_schema.tables where table_schema='public';")"
INDEX_PRESENT="$(docker exec "$NAME" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "select count(*) from pg_indexes where schemaname='public' and indexname='idx_users_verified_email';")"
if [[ ${TABLES_AFTER//[[:space:]]/} -lt 1 || ${INDEX_PRESENT//[[:space:]]/} != 1 ]]; then
  echo "migration landed somewhere else: container tables=$TABLES_AFTER index=$INDEX_PRESENT" >&2
  exit 1
fi
echo "verified: schema and required index exist inside $NAME (DSN target proven)"

if (( RACE )); then
  TEST_ARGS=(-count=1 -race -p 1
    ./internal/authlimits ./internal/utils ./internal/middlewares ./internal/server
    ./internal/handlers/v1 ./internal/handlers/v2 ./internal/training)
else
  TEST_ARGS=(-count=1 -p 1 ./...)
fi
if (( VERBOSE )); then
  TEST_ARGS+=(-v)
fi

echo "running: go test ${TEST_ARGS[*]}"
"${ENVIRONMENT[@]}" OPENCW_TEST_DATABASE_DSN="$DSN" go test "${TEST_ARGS[@]}"
echo "all requested tests passed against the disposable database"
