#!/usr/bin/env bash
# Report the health of a deployed DitPath stack.
#
# Read-only: safe to run at any time, and safe to run from cron. Exits non-zero
# when a critical service (db, backend, frontend) is unhealthy, so a monitoring
# check or a post-deploy gate can use the exit code directly.

set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

# Read-only report: --dry-run would suppress every docker call and make a healthy
# stack look like it was never created, so it is deliberately not accepted.
COMMON_OPTS=()

usage() {
  print_help \
    "Report service health, versions, and disk usage for the DitPath stack." \
    "scripts/status.sh [options]" \
    "--skip-disk           omit the slower disk and Docker storage sections"
}

SKIP_DISK=0

while (( $# )); do
  case "$1" in
    --skip-disk) SKIP_DISK=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

require_docker
require_compose_file

failures=()
fail() { failures+=("$1"); }

# --- environment ------------------------------------------------------------

header "Environment"
if [[ -f ${ENV_FILE} ]]; then
  if env_output="$("${SCRIPTS_DIR}/check-env.sh" --quiet 2>&1)"; then
    ok "${ENV_FILE} is valid"
  else
    warn "${ENV_FILE} has problems"
    printf '%s\n' "${env_output}" | sed 's/^/    /' >&2
    fail "environment"
  fi
else
  warn "${ENV_FILE} is missing"
  fail "environment"
fi

data_path="$(env_get POSTGRES_DATA_PATH || true)"
[[ -n ${data_path} ]] || data_path="${ROOT_DIR}/data/postgres"
info "database data directory: ${data_path}"

# --- containers -------------------------------------------------------------

header "Containers"
compose ps -a || true

for service in db backend frontend pgadmin; do
  state="$(container_state "${service}")"
  case ${state} in
    running\ \(health:\ healthy\)|running\ \(health:\ -\)) ok "${service}: ${state}" ;;
    not\ created)
      warn "${service}: ${state}"
      fail "${service}"
      ;;
    *) warn "${service}: ${state}"; fail "${service}" ;;
  esac
done

cloudflared_state="$(container_state cloudflared)"
case ${cloudflared_state} in
  running*) log "cloudflared: ${cloudflared_state}" ;;
  not\ created) log "cloudflared: not created" ;;
  *) warn "cloudflared: ${cloudflared_state}" ;;
esac

pgadmin_config_state="$(container_state pgadmin-config)"
case ${pgadmin_config_state} in
  exited*) log "pgadmin-config: ${pgadmin_config_state} (expected: it is a one-shot renderer)" ;;
  *) log "pgadmin-config: ${pgadmin_config_state}" ;;
esac

# --- endpoints --------------------------------------------------------------

header "Endpoints"
probe() {
  local name="$1" url="$2" critical="$3"
  if http_ok "${url}" 5; then
    ok "${name}: ${url}"
  else
    if (( critical )); then
      warn "${name}: no response from ${url}"
      fail "${name}"
    else
      warn "${name}: no response from ${url}"
    fi
  fi
}

probe "backend API" "http://127.0.0.1:${API_PORT}/v1/health" 1
probe "frontend" "http://127.0.0.1:${FRONTEND_PORT}/" 1
probe "pgAdmin" "http://127.0.0.1:${PGADMIN_PORT}/misc/ping" 0

if [[ ${DRY_RUN} == 0 ]]; then
  if compose exec -T db sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; then
    ok "database: accepting connections"
  else
    warn "database: pg_isready failed"
    fail "database"
  fi
fi

# --- release -----------------------------------------------------------------

header "Release"
if command -v git >/dev/null 2>&1 && ( cd -- "${ROOT_DIR}" && git rev-parse --git-dir >/dev/null 2>&1 ); then
  ref="$( cd -- "${ROOT_DIR}" && git rev-parse --short=12 HEAD )"
  branch="$( cd -- "${ROOT_DIR}" && git rev-parse --abbrev-ref HEAD )"
  info "revision: ${ref} (${branch})"
  if [[ -n "$( cd -- "${ROOT_DIR}" && git status --porcelain --untracked-files=no )" ]]; then
    warn "the working tree has uncommitted changes"
  fi
else
  log "not a git checkout; revision unknown"
fi

if [[ -f ${STATE_FILE} ]]; then
  printf '\n'
  log "last update recorded in ${STATE_FILE}"
  for key in UPDATED_AT NEW_REF PREV_REF PREV_BRANCH PREV_BACKUP SNAPSHOTS; do
    value="$(state_get "${key}" || true)"
    [[ -n ${value} ]] && printf '  %-12s %s\n' "${key}" "${value}"
  done
else
  log "no ${STATE_FILE} yet; it is written by scripts/update.sh"
fi

# --- images -----------------------------------------------------------------

header "Images"
compose images || true

# --- backups and disk -------------------------------------------------------

if (( SKIP_DISK == 0 )); then
  header "Backups"
  newest="$(latest_backup)"
  if [[ -n ${newest} ]]; then
    count="$(list_backups | wc -l | tr -d '[:space:]')"
    info "${count} dump(s) in ${BACKUP_DIR}, total $(human_size "${BACKUP_DIR}")"
    info "newest: $(basename -- "${newest}") ($(human_size "${newest}"))"
    mtime="$(stat -c %Y -- "${newest}" 2>/dev/null || date +%s)"
    age_days=$(( ( $(date +%s) - mtime ) / 86400 ))
    if (( age_days >= 7 )); then
      warn "the newest backup is ${age_days} day(s) old; schedule 'make backup' (see DEPLOYMENT.md)"
    fi
  else
    warn "no dumps found in ${BACKUP_DIR}; run 'make backup'"
  fi

  header "Storage"
  if [[ -e ${data_path} ]]; then
    info "database data: $(human_size "${data_path}") (${data_path})"
  else
    warn "database data directory ${data_path} does not exist"
  fi
  if df -h --output=source,size,used,avail,pcent -- "${data_path}" 2>/dev/null; then
    :
  else
    log "df is unavailable for ${data_path}"
  fi
  printf '\n'
  docker system df || true
fi

# --- verdict ----------------------------------------------------------------

printf '\n'
if (( ${#failures[@]} )); then
  warn "unhealthy: ${failures[*]}"
  exit 1
fi

ok "all critical services are healthy"
exit 0
