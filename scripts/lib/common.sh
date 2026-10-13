#!/usr/bin/env bash
# scripts/lib/common.sh - shared helpers for the DitPath operational scripts.
#
# This file is sourced, never executed directly:
#
#   source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
#
# Design notes
# ------------
# * ${ENV_FILE} is parsed, never sourced. example.env ships
#   `RESEND_FROM_EMAIL=DitPath <no-reply@example.com>`; sourcing that file would
#   try to execute `DitPath` as a command.
# * Database credentials are read from inside the containers (the `db` service
#   has $POSTGRES_USER / $POSTGRES_DB in its environment) instead of being
#   re-exported on the host, so secrets never enter this process.
# * Everything that mutates state goes through run() or compose() so a single
#   --dry-run flag suppresses all of it.
#
# Requires bash 4+ (the deployment target is Linux). GNU find/sort/stat are used
# in a few places; they are guaranteed on the documented LXC/Debian target.

if [[ -z ${BASH_VERSION:-} ]]; then
  echo "scripts/lib/common.sh: requires bash, not sh" >&2
  exit 1
fi
if (( BASH_VERSINFO[0] < 4 )); then
  echo "scripts/lib/common.sh: requires bash 4 or newer (this is ${BASH_VERSION})" >&2
  exit 1
fi

# --- paths ------------------------------------------------------------------

COMMON_SH_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd -- "${COMMON_SH_DIR}/.." && pwd)"
ROOT_DIR="$(cd -- "${SCRIPTS_DIR}/.." && pwd)"

ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
[[ ${ENV_FILE} == /* ]] || ENV_FILE="${PWD}/${ENV_FILE}"
export ENV_FILE
EXAMPLE_ENV_FILE="${ROOT_DIR}/example.env"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yaml"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
STATE_FILE="${STATE_FILE:-${ROOT_DIR}/.deploy-state}"

# Published ports and endpoints probed by deploy.sh, update.sh and status.sh.
# API_PORT and FRONTEND_PORT mirror the fixed bindings in docker-compose.yaml;
# PGADMIN_PORT is resolved after env_get is available, because .env can override it.
API_PORT="${API_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# --- logging ----------------------------------------------------------------

if [[ -t 2 ]]; then
  C_RESET=$'\033[0m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
else
  C_RESET='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE=''
fi

_script_name() { basename -- "${0:-opencw}"; }

# Stream for informational output. Scripts that emit machine-readable data on
# stdout (backup.sh --print-path) move the log stream to stderr so a caller
# capturing stdout cannot mistake a log line for data.
LOG_STREAM="${LOG_STREAM:-1}"

log()    { printf '%s[%s]%s %s\n' "${C_DIM}" "$(_script_name)" "${C_RESET}" "$*" >&"${LOG_STREAM}"; }
info()   { printf '%s[%s]%s %s\n' "${C_BLUE}" "$(_script_name)" "${C_RESET}" "$*" >&"${LOG_STREAM}"; }
ok()     { printf '%s[%s]%s %s\n' "${C_GREEN}" "$(_script_name)" "${C_RESET}" "$*" >&"${LOG_STREAM}"; }
header() { printf '\n%s%s%s\n' "${C_BLUE}" "$*" "${C_RESET}" >&"${LOG_STREAM}"; }
warn()   { printf '%s[%s] warning:%s %s\n' "${C_YELLOW}" "$(_script_name)" "${C_RESET}" "$*" >&2; }
die()    { printf '%s[%s] error:%s %s\n' "${C_RED}" "$(_script_name)" "${C_RESET}" "$*" >&2; exit 1; }

# Canonical decimal arithmetic, including inputs such as 08. Bound option
# values before Bash arithmetic can overflow or interpret them as octal.
parse_nonnegative_integer() {
  local value="$1" label="$2"
  [[ ${value} =~ ^[0-9]+$ ]] || die "${label} must be a nonnegative whole number"
  while [[ ${#value} -gt 1 && ${value} == 0* ]]; do value="${value#0}"; done
  (( ${#value} <= 9 )) || die "${label} is too large (maximum 999999999)"
  printf '%s' "${value}"
}

# --- help -------------------------------------------------------------------

# Common options advertised by --help. Scripts that do not implement one of these
# narrow the list, so the help text can never advertise a flag the argument
# parser would reject: read-only scripts drop both, backup.sh keeps only
# --dry-run.
COMMON_OPTS=('--dry-run' '--yes')

# print_help <description> <usage> [option line...]
print_help() {
  local description="$1" usage="$2" opt
  shift 2
  printf '%s\n\n' "${description}"
  printf 'Usage: %s\n' "${usage}"
  printf '\nOptions:\n'
  if (( $# )); then
    printf '  %s\n' "$@"
  fi
  printf '  -h, --help            show this help and exit\n'
  if (( ${#COMMON_OPTS[@]} )); then
    printf '\nCommon options:\n'
    for opt in "${COMMON_OPTS[@]}"; do
      case ${opt} in
        --dry-run) printf '  --dry-run             print the commands that would run, change nothing\n' ;;
        --yes) printf '  --yes                 assume "yes" for confirmation prompts\n' ;;
        *) printf '  %s\n' "${opt}" ;;
      esac
    done
  fi
}

# --- flags ------------------------------------------------------------------

DRY_RUN="${DRY_RUN:-0}"
ASSUME_YES="${ASSUME_YES:-0}"

_quote_cmd() {
  local out='' arg
  for arg in "$@"; do
    printf -v out '%s%q ' "${out}" "${arg}"
  done
  printf '%s' "${out% }"
}

# Run a command, or just print it under --dry-run.
run() {
  if [[ ${DRY_RUN} == 1 ]]; then
    printf '%s[dry-run]%s %s\n' "${C_DIM}" "${C_RESET}" "$(_quote_cmd "$@")" >&"${LOG_STREAM}"
    return 0
  fi
  "$@"
}

# Describe a shell pipeline that cannot be expressed as an argv list.
dry_pipe() { printf '%s[dry-run]%s %s\n' "${C_DIM}" "${C_RESET}" "$1" >&"${LOG_STREAM}"; }

# confirm <prompt> - returns 0 only on an explicit yes.
confirm() {
  local reply
  if [[ ${ASSUME_YES} == 1 ]]; then
    log "auto-confirmed (--yes): $1"
    return 0
  fi
  [[ -t 0 ]] || die "no TTY available to confirm: $1; re-run with --yes"
  read -r -p "$1 [y/N] " reply || true
  [[ ${reply} =~ ^[Yy]$ ]]
}

# typed_confirm <word> <prompt> - destructive-action gate that requires the
# operator to type <word> exactly.
typed_confirm() {
  local expected="$1" prompt="$2" reply
  if [[ ${ASSUME_YES} == 1 ]]; then
    log "auto-confirmed (--yes): ${prompt}"
    return 0
  fi
  [[ -t 0 ]] || die "no TTY available to confirm: ${prompt}; re-run with --yes"
  printf '%s\n' "${prompt}"
  read -r -p "Type '${expected}' to continue: " reply || true
  [[ ${reply} == "${expected}" ]] || die "aborted (expected '${expected}')"
}

# --- prerequisites ----------------------------------------------------------

require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v -- "${cmd}" >/dev/null 2>&1 || die "required command not found: ${cmd}"
  done
}

require_docker() {
  require_cmd docker
  docker info >/dev/null 2>&1 ||
    die "cannot talk to the Docker daemon (is it running, and is this user allowed to use it?)"
  docker compose version >/dev/null 2>&1 ||
    die "the Docker Compose v2 plugin is required ('docker compose version' failed)"
}

require_compose_file() {
  [[ -f ${COMPOSE_FILE} ]] || die "missing ${COMPOSE_FILE}; run this from a checkout of the repository"
}

require_env_file() {
  [[ -f ${ENV_FILE} ]] || die "missing ${ENV_FILE}; create it with: cp ${EXAMPLE_ENV_FILE} ${ENV_FILE}"
}

require_git_checkout() {
  require_cmd git
  ( cd -- "${ROOT_DIR}" && git rev-parse --git-dir >/dev/null 2>&1 ) ||
    die "${ROOT_DIR} is not a git checkout"
}

# --- compose ----------------------------------------------------------------

# Run docker compose against the root stack. The subshell `cd` keeps the
# directory-derived project name stable ("opencw") no matter where the caller
# was invoked from. Use the same environment file the scripts validate.
compose() {
  local shm tuning_help=''
  # update --ref can check out a revision predating --shm while this function stays loaded.
  if [[ -f ${ROOT_DIR}/db/tune.sh ]]; then
    tuning_help="$(/bin/sh "${ROOT_DIR}/db/tune.sh" --help)" || return 1
  fi
  case ${tuning_help} in
    *--shm*) shm="$(postgres_tune --shm)" || return 1 ;;
    *) shm="$(env_get POSTGRES_SHM_SIZE || true)"; shm="${shm:-2gb}" ;;
  esac
  if [[ ${DRY_RUN} == 1 ]]; then
    printf '%s[dry-run]%s (cd %s && %s)\n' \
      "${C_DIM}" "${C_RESET}" "$(_quote_cmd "${ROOT_DIR}")" \
      "$(_quote_cmd env "OPENCW_POSTGRES_SHM_SIZE=${shm}" docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@")" >&"${LOG_STREAM}"
    return 0
  fi
  ( cd -- "${ROOT_DIR}" && OPENCW_POSTGRES_SHM_SIZE="${shm}" docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@" )
}

# Image references the Compose configuration resolves, one per line. This
# includes images merely pulled from a registry (postgres, pgadmin4, cloudflared).
list_stack_images() { compose config --images; }

# Just the images Compose builds from source in this checkout, i.e. the ones an
# update actually replaces and the only ones worth snapshotting for a rollback.
# Local builds can carry RepoDigests with Docker's containerd image store. Select
# build services from normalized Compose output, then let Compose resolve their
# explicit image tags or project-derived default names.
built_stack_images() {
  local config images project service image resolved name
  config="$(compose config)" || return 1
  images="$(list_stack_images)" || return 1
  while IFS='|' read -r project service image; do
    [[ -n ${service} ]] || continue
    if [[ -z ${image} ]]; then
      resolved=''
      while IFS= read -r name; do
        case ${name} in
          "${project}-${service}"|"${project}-${service}:latest"|"${project}_${service}"|"${project}_${service}:latest")
            resolved="${name}"; break ;;
        esac
      done <<< "${images}"
      [[ -n ${resolved} ]] || return 1
      image="${resolved}"
    fi
    printf '%s\n' "${image}"
  done < <(printf '%s\n' "${config}" | awk '
    function emit() { if (build) print project "|" service "|" image }
    /^name:/ {
      project = $0
      sub(/^name: */, "", project)
      gsub(/["\047]/, "", project)
    }
    /^services:/ { in_services = 1; next }
    in_services && /^[^[:space:]]/ { emit(); in_services = 0 }
    in_services && /^  [^[:space:]]/ {
      emit()
      service = $0
      sub(/^  /, "", service)
      sub(/:.*/, "", service)
      gsub(/["\047]/, "", service)
      build = 0; image = ""
    }
    in_services && /^    build:/ { build = 1 }
    in_services && /^    image:/ {
      image = $0
      sub(/^    image: */, "", image)
      gsub(/["\047]/, "", image)
    }
    END { if (in_services) emit() }
  ')
}

git_in_root() { ( cd -- "${ROOT_DIR}" && git "$@" ); }

# --- .env access ------------------------------------------------------------

# Read a value from ${ENV_FILE} without executing the file. Handles an optional
# `export ` prefix, quoted values, inline comments, CRLF endings and (like
# Compose) lets process values override the last file definition. Returns non-zero when the key is
# absent; an empty value (`KEY=`) is returned as an empty string.
env_get() {
  local key="$1" value mode
  [[ ${key} =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 1
  if declare -p "${key}" >/dev/null 2>&1; then printf '%s' "${!key}"; return 0; fi
  [[ -f ${ENV_FILE} ]] || return 1
  value="$(awk -v key="${key}" '
    { sub(/\r$/, "") }
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" {
      found = 1; value = $0
      sub(/^[^=]*=[[:space:]]*/, "", value)
      quote = substr(value, 1, 1); decoded = ""
      if (quote == "\047" || quote == "\042") {
        for (i = 2; i <= length(value); i++) {
          c = substr(value, i, 1)
          if (c == quote) break
          if (c == "\\" && i < length(value)) {
            nextc = substr(value, i + 1, 1)
            if (nextc == quote || (quote == "\042" && nextc == "\\")) { c = nextc; i++ }
            else if (quote == "\042" && nextc ~ /^[nrt]$/) {
              c = nextc == "n" ? "\n" : (nextc == "r" ? "\r" : "\t"); i++
            }
          }
          decoded = decoded c
        }
        value = decoded
      } else {
        sub(/[[:space:]]+#.*$/, "", value)
        sub(/[[:space:]]+$/, "", value)
      }
    }
    END { if (!found) exit 1; printf "%s\n%s", (quote == "\047" ? "literal" : "expand"), value }
  ' "${ENV_FILE}")" || return 1
  mode="${value%%$'\n'*}"; value="${value#*$'\n'}"
  if [[ ${mode} == expand && ${value} == *'$'* ]]; then
    if [[ ${2:-} == literal ]]; then
      warn "${key} tuning input must be literal; environment interpolation is not supported"
      return 2
    fi
    # Reuse Compose for its parameter/default expansion rather than evaluate
    # shell code or maintain a second interpolation implementation. No daemon
    # is needed for config; never log the resolved environment (it has secrets).
    command -v docker >/dev/null 2>&1 || { warn "resolving ${key} interpolation requires Docker Compose"; return 1; }
    value="$(cd -- "${ROOT_DIR}" && docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --environment 2>/dev/null)" ||
      { warn "cannot resolve ${key} with Docker Compose"; return 1; }
    value="$(printf '%s\n' "${value}" | awk -v key="${key}" 'index($0, key "=") == 1 { found = 1; value = substr($0, length(key) + 2) } END { if (!found) exit 1; printf "%s", value }')" || return 1
  fi
  printf '%s' "${value}"
}

# Export only tuning inputs, parsed as data. Preview, validation and Compose share this path.
postgres_tune() (
  local key value status
  for key in POSTGRES_TUNE_MODE POSTGRES_MEMORY_LIMIT POSTGRES_CPU_LIMIT \
    POSTGRES_MAX_CONNECTIONS POSTGRES_HOST_MEMORY_SHARE POSTGRES_TUNE_DISABLE \
    POSTGRES_TUNE_EXTRA POSTGRES_SHM_SIZE POSTGRES_TUNE_PROFILE \
    POSTGRES_TUNE_STORAGE POSTGRES_TUNE_DB_SIZE; do
    if value="$(env_get "$key" literal)"; then
      export "$key=$value"
    else
      status=$?
      [[ ${status} == 1 ]] || return "${status}"
      unset "$key"
    fi
  done
  /bin/sh "${ROOT_DIR}/db/tune.sh" "$@"
)

# env_set <key> <value> - rewrite <key> in ${ENV_FILE}, or append it when absent.
# Duplicate definitions collapse into a single line placed where the last one
# was, which keeps the result consistent with the "last definition wins" rule
# env_get and Compose both follow. Safe for values containing /, & and spaces
# (unlike sed), and written through a temp file so a failure cannot truncate the
# original.
env_set() {
  local key="$1" value="$2" tmp
  [[ -f ${ENV_FILE} ]] || die "cannot set ${key}: ${ENV_FILE} does not exist"
  if [[ ${DRY_RUN} == 1 ]]; then
    printf '%s[dry-run]%s set %s in %s to a %s-character value\n' \
      "${C_DIM}" "${C_RESET}" "${key}" "${ENV_FILE}" "${#value}"
    return 0
  fi
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")" || die "cannot create a temp file next to ${ENV_FILE}"
  if ! awk -v key="${key}" -v val="${value}" '
        $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" {
          last = NR
          next
        }
        { keep[NR] = $0 }
        END {
          if (last == 0) {
            # Key absent: keep every existing line, then append the new one.
            for (i = 1; i <= NR; i++) {
              if (i in keep) print keep[i]
            }
            print key "=" val
          } else {
            for (i = 1; i <= NR; i++) {
              if (i == last) print key "=" val
              else if (i in keep) print keep[i]
            }
          }
        }
      ' "${ENV_FILE}" > "${tmp}"; then
    rm -f -- "${tmp}"
    die "failed to update ${ENV_FILE}"
  fi
  chmod --reference="${ENV_FILE}" "${tmp}" 2>/dev/null || true
  mv -f -- "${tmp}" "${ENV_FILE}"
}

# Decode a base64 value and report the decoded length in bytes. The decode flag
# differs between implementations (GNU coreutils uses --decode, BSD uses -d), so
# probe for a working one instead of assuming. Without this, a wrong flag would
# silently report 0 bytes and fail a perfectly good secret.
_base64_decode_flag() {
  command -v base64 >/dev/null 2>&1 || return 1
  if printf 'AA==' | base64 --decode >/dev/null 2>&1; then
    printf -- '--decode'
  elif printf 'AA==' | base64 -d >/dev/null 2>&1; then
    printf -- '-d'
  else
    return 1
  fi
}

base64_decoded_bytes() {
  local value="$1" flag
  if flag="$(_base64_decode_flag)"; then
    printf '%s' "${value}" | base64 "${flag}" 2>/dev/null | wc -c | tr -d '[:space:]'
  elif command -v openssl >/dev/null 2>&1; then
    printf '%s' "${value}" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d '[:space:]'
  else
    return 1
  fi
}

# --- ports ------------------------------------------------------------------

# Resolve PGADMIN_PORT the way Compose does: an explicit environment value wins,
# then the value in .env, then 5050. Without the .env lookup, changing
# PGADMIN_PORT there would leave the pgAdmin probes in deploy.sh, update.sh and
# status.sh hitting the old port and reporting a healthy service as down.
if [[ -z ${PGADMIN_PORT:-} && -f ${ENV_FILE} ]]; then
  PGADMIN_PORT="$(env_get PGADMIN_PORT || true)"
fi
PGADMIN_PORT="${PGADMIN_PORT:-5050}"

# --- HTTP probing -----------------------------------------------------------

# http_ok <url> [timeout] - true when the URL answers with a success status.
http_ok() {
  local url="$1" timeout="${2:-5}"
  # The return code is the signal. curl's own diagnostics are suppressed because
  # polling a service that is still starting would otherwise spam stderr with
  # "Recv failure: Connection reset by peer" on every attempt.
  if command -v curl >/dev/null 2>&1; then
    curl -fs -o /dev/null --max-time "${timeout}" "${url}" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null --tries=1 --timeout="${timeout}" "${url}" 2>/dev/null
  else
    die "need curl or wget to probe ${url}"
  fi
}

# --- container / service waits ---------------------------------------------

# container_state <service> - "not created", or "<status> (health: <health>)".
# Uses -a so one-shot services that have already run (pgadmin-config) report
# "exited" rather than looking like they were never started.
container_state() {
  local service="$1" cid state health
  # sed rather than `head -n 1`: head would close the pipe early and, under
  # `set -o pipefail`, trip the caller on a perfectly healthy stack.
  cid="$(compose ps -aq "${service}" 2>/dev/null | sed -n '1p' || true)"
  if [[ -z ${cid} ]]; then
    printf 'not created\n'
    return 0
  fi
  state="$(docker inspect -f '{{.State.Status}}' "${cid}" 2>/dev/null || printf 'unknown')"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "${cid}" 2>/dev/null || printf 'unknown')"
  printf '%s (health: %s)\n' "${state}" "${health}"
}

# wait_service_healthy <service> [timeout] - wait for running + healthy (a
# service without a healthcheck counts as healthy once it is running).
wait_service_healthy() {
  local service="$1" timeout start now cid state health restarts initial_restarts='' observed_cid=''
  timeout="$(parse_nonnegative_integer "${2:-180}" timeout)" || return 1
  if [[ ${DRY_RUN} == 1 ]]; then
    printf '%s[dry-run]%s wait for service %s to become healthy\n' "${C_DIM}" "${C_RESET}" "${service}" >&"${LOG_STREAM}"
    return 0
  fi
  start="$(date +%s)"
  while :; do
    cid="$(compose ps -aq "${service}" 2>/dev/null | sed -n '1p' || true)"
    if [[ -n ${cid} ]]; then
      state="$(docker inspect -f '{{.State.Status}}' "${cid}" 2>/dev/null || true)"
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${cid}" 2>/dev/null || true)"
      case ${state} in
        running)
          case ${health} in
            healthy|none)
              ok "${service} is running (health: ${health})"
              return 0
              ;;
            unhealthy)
              warn "${service} reported unhealthy"
              return 1
              ;;
          esac
          ;;
        exited|dead)
          warn "${service} has exited; see: docker compose logs ${service}"
          return 1
          ;;
      esac
      # Historical restarts do not invalidate a currently healthy container.
      restarts="$(docker inspect -f '{{.RestartCount}}' "${cid}" 2>/dev/null || true)"
      if [[ ${restarts} =~ ^[0-9]+$ ]]; then
        if [[ ${cid} != "${observed_cid}" ]]; then
          observed_cid="${cid}"; initial_restarts="${restarts}"
        elif (( restarts - initial_restarts >= 2 )); then
          warn "${service} is crash-looping (two restarts during this check); see: docker compose logs ${service}"
          return 1
        fi
      fi
    fi
    now="$(date +%s)"
    if (( now - start >= timeout )); then
      warn "timed out after ${timeout}s waiting for ${service} to become healthy"
      return 1
    fi
    sleep 2
  done
}

# wait_http <name> <url> [timeout] - poll an endpoint until it answers.
wait_http() {
  local name="$1" url="$2" timeout start now
  timeout="$(parse_nonnegative_integer "${3:-180}" timeout)" || return 1
  if [[ ${DRY_RUN} == 1 ]]; then
    printf '%s[dry-run]%s wait for %s at %s\n' "${C_DIM}" "${C_RESET}" "${name}" "${url}" >&"${LOG_STREAM}"
    return 0
  fi
  start="$(date +%s)"
  while :; do
    if http_ok "${url}" 3; then
      ok "${name} is responding (${url})"
      return 0
    fi
    now="$(date +%s)"
    if (( now - start >= timeout )); then
      warn "${name} did not respond within ${timeout}s (${url})"
      return 1
    fi
    sleep 2
  done
}

# --- backups ----------------------------------------------------------------

ensure_backup_dir() {
  [[ -d ${BACKUP_DIR} ]] || run mkdir -p -- "${BACKUP_DIR}"
  [[ ${DRY_RUN} == 1 || -d ${BACKUP_DIR} ]] || die "cannot create ${BACKUP_DIR}"
}

# Companion pg_dumpall --globals-only dumps live in a subdirectory on purpose:
# list_backups() only looks at the top level, so a roles/grants dump can never be
# offered as a restorable database dump or counted against the retention limit.
globals_dir() { printf '%s/globals\n' "${BACKUP_DIR}"; }

# Path of the globals dump that belongs to a given database dump.
companion_globals_for() {
  local dump="$1" name
  name="$(basename -- "${dump}")"
  name="${name%.gz}"
  name="${name%.sql}"
  printf '%s/globals/%s.globals.sql.gz\n' "$(dirname -- "${dump}")" "${name}"
}

# Newest dump first, one absolute path per line. Top level only, and only real
# database dumps.
list_backups() {
  [[ -d ${BACKUP_DIR} ]] || return 0
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'opencw_*.sql.gz' -printf '%T@ %p\n' 2>/dev/null |
    sort -rn | cut -d' ' -f2-
}

latest_backup() { list_backups | sed -n '1p'; }

# prune_backups <keep> - delete all but the newest <keep> dumps. Only files
# matching opencw_*.sql.gz are considered, so unrelated files are never touched.
prune_backups() {
  local keep file globals seen=0 pruned=0 protected=0
  keep="$(parse_nonnegative_integer "$1" retention)" || return 1
  if (( keep == 0 )); then log "retention disabled (--keep 0)"; return 0; fi
  while IFS= read -r file; do
    [[ -n ${file} ]] || continue
    seen=$(( seen + 1 ))
    (( seen > keep )) || continue
    if [[ -e ${file}.restore-pin ]]; then protected=$(( protected + 1 )); continue; fi
    globals="$(companion_globals_for "${file}")"
    run rm -f -- "${file}" "${globals}"
    log "pruned ${file} and its companion globals"
    pruned=$(( pruned + 1 ))
  done < <(list_backups)

  if (( pruned == 0 )); then
    log "retention: ${seen} dump(s) kept (limit ${keep}, ${protected} protected beyond limit), nothing to prune"
  else
    ok "retention: kept $(( seen - pruned )) dump(s) (limit ${keep}, ${protected} protected beyond limit), pruned ${pruned}"
  fi
}

human_size() {
  local path="$1"
  if [[ ! -e ${path} ]]; then
    printf 'missing'
    return 0
  fi
  du -sh "${path}" 2>/dev/null | cut -f1 || printf 'unavailable'
}

# --- state file -------------------------------------------------------------
# Small "previous release" record written by update.sh, read by status.sh.

state_set() {
  local key="$1" value="$2" tmp
  if [[ ${DRY_RUN} == 1 ]]; then
    printf '%s[dry-run]%s record %s=%s in %s\n' "${C_DIM}" "${C_RESET}" "${key}" "${value}" "${STATE_FILE}"
    return 0
  fi
  tmp="$(mktemp "${STATE_FILE}.XXXXXX")" || die "cannot create a temp file next to ${STATE_FILE}"
  if [[ -f ${STATE_FILE} ]]; then
    grep -vE "^${key}=" -- "${STATE_FILE}" > "${tmp}" || true
  fi
  printf '%s=%s\n' "${key}" "${value}" >> "${tmp}"
  chmod 0644 "${tmp}" 2>/dev/null || true
  mv -f -- "${tmp}" "${STATE_FILE}"
}

state_get() {
  local key="$1"
  [[ -f ${STATE_FILE} ]] || return 1
  sed -n -E -e "s/^${key}=//p" "${STATE_FILE}" | tail -n 1
}

# --- misc -------------------------------------------------------------------

now_utc() { date -u +%Y%m%dT%H%M%SZ; }

# Retag an image reference with a new tag, e.g.
#   tag_snapshot_ref opencw-backend:latest pre-20260928T101500Z
#   -> opencw-backend:pre-20260928T101500Z
tag_snapshot_ref() {
  local image="$1" tag="$2" name last
  name="${image%%@*}"
  last="${name##*/}"
  if [[ ${last} == *:* ]]; then
    printf '%s:%s\n' "${name%:*}" "${tag}"
  else
    printf '%s:%s\n' "${name}" "${tag}"
  fi
}
