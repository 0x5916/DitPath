#!/usr/bin/env bash
# First-time deployment of the DitPath stack.
#
# Bootstraps .env from example.env, offers to generate the JWT secret, validates
# the file against DEPLOYMENT.md's requirements, builds and starts the stack, and
# waits until every service actually answers before declaring success.

set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

TIMEOUT=240

usage() {
  print_help \
    "Build and start the DitPath stack for the first time." \
    "scripts/deploy.sh [options]" \
    "--timeout SECONDS     how long to wait for each service (default ${TIMEOUT})" \
    "--yes                 do not prompt; accept the .env bootstrap and JWT generation"
}

while (( $# )); do
  case "$1" in
    --timeout)
      shift
      [[ $# && $1 =~ ^[0-9]+$ ]] || die "--timeout needs a number of seconds"
      TIMEOUT="$1"
      ;;
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

TIMEOUT="$(parse_nonnegative_integer "${TIMEOUT}" '--timeout')"
require_docker
require_compose_file

# --- 1. .env bootstrap ------------------------------------------------------

if [[ ! -f ${ENV_FILE} ]]; then
  [[ -f ${EXAMPLE_ENV_FILE} ]] || die "missing ${EXAMPLE_ENV_FILE}; cannot bootstrap ${ENV_FILE}"
  if confirm "No ${ENV_FILE} found. Copy ${EXAMPLE_ENV_FILE} to ${ENV_FILE}?"; then
    run cp -- "${EXAMPLE_ENV_FILE}" "${ENV_FILE}"
    ok "created ${ENV_FILE}"
  else
    die "refusing to continue without ${ENV_FILE}"
  fi
fi

# --- 2. JWT secret ----------------------------------------------------------

if [[ ${DRY_RUN} == 0 && -z "$(env_get JWT_SECRET || true)" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    if confirm "JWT_SECRET is empty. Generate one with 'openssl rand -base64 32' and save it to ${ENV_FILE}?"; then
      env_set JWT_SECRET "$(openssl rand -base64 32)"
      ok "wrote a fresh JWT_SECRET to ${ENV_FILE}"
    fi
  else
    warn "openssl is not installed; generate JWT_SECRET elsewhere and paste it into ${ENV_FILE}"
  fi
fi

# --- 3. validation ----------------------------------------------------------

# Validation is read-only, so it also runs under --dry-run: it is the part of a
# deploy that is most likely to stop you.
info "validating ${ENV_FILE}"
"${SCRIPTS_DIR}/check-env.sh" || die "fix the problems above, then re-run scripts/deploy.sh"

data_path="$(env_get POSTGRES_DATA_PATH || true)"
if [[ -z ${data_path} ]]; then
  warn "POSTGRES_DATA_PATH is unset; Compose will use ${ROOT_DIR}/data/postgres for the database"
else
  log "database data directory: ${data_path}"
fi

# --- 4. build and start -----------------------------------------------------

info "building and starting the stack"
if ! compose up -d --build; then
  die "'docker compose up -d --build' failed; read the output above, then check 'docker compose ps' and 'docker compose logs'"
fi

# --- 5. verify --------------------------------------------------------------

if [[ ${DRY_RUN} == 1 ]]; then
  dry_pipe "wait for db/backend/frontend/pgadmin to become healthy"
  exit 0
fi

info "waiting for services to become healthy (timeout ${TIMEOUT}s each)"
failed=0
wait_service_healthy db "${TIMEOUT}" || failed=1
wait_service_healthy backend "${TIMEOUT}" || failed=1
wait_service_healthy frontend "${TIMEOUT}" || failed=1
wait_service_healthy pgadmin "${TIMEOUT}" || failed=1
# Only probe over HTTP once the containers themselves are up. Probing an endpoint
# whose container has already failed just burns the full timeout.
if (( failed )); then
  warn "skipping the HTTP probes because a container did not become healthy"
else
  wait_http "backend API" "http://127.0.0.1:${API_PORT}/v1/health" "${TIMEOUT}" || failed=1
  wait_http "frontend" "http://127.0.0.1:${FRONTEND_PORT}/" "${TIMEOUT}" || failed=1
  wait_http "pgAdmin" "http://127.0.0.1:${PGADMIN_PORT}/misc/ping" "${TIMEOUT}" || true
fi

if (( failed )); then
  warn "some services did not come up cleanly"
  printf '\nInspect the current state with:\n  docker compose ps\n  docker compose logs --tail=50\n' >&2
  exit 1
fi

# --- 6. summary -------------------------------------------------------------

printf '\n'
ok "DitPath is up"
printf '\n'
printf '  Frontend       http://localhost:%s\n' "${FRONTEND_PORT}"
printf '  Backend API    http://localhost:%s/v1\n' "${API_PORT}"
printf '  Health check   http://localhost:%s/v1/health\n' "${API_PORT}"
printf '  pgAdmin        http://127.0.0.1:%s  (loopback only)\n' "${PGADMIN_PORT}"
printf '\n'
printf 'Next steps:\n'
printf '  make status                       confirm health and disk usage\n'
printf '  make backup                       take a first backup\n'
printf '  scripts/update.sh --help          see how updates work\n'
