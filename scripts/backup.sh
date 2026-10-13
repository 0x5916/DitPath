#!/usr/bin/env bash
# Create a portable logical backup of the DitPath database.
#
# Uses the same pg_dump pipeline that DEPLOYMENT.md section 6 documents, so the
# documented restore command keeps working, and writes gzip-compressed plain-SQL
# dumps into ${BACKUP_DIR}. Old dumps are rotated afterwards.
#
# Credentials are read from inside the `db` container (POSTGRES_USER /
# POSTGRES_DB are part of its environment), so the host never needs to handle
# them.

set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

# backup.sh never prompts, so it has no --yes.
COMMON_OPTS=('--dry-run')

KEEP="${BACKUP_RETENTION:-14}"
WITH_GLOBALS=1
PRINT_PATH=0

usage() {
  print_help \
    "Dump the DitPath database to ${BACKUP_DIR} and rotate old dumps." \
    "scripts/backup.sh [options]" \
    "--keep N              keep the newest N dumps; 0 disables pruning (default ${KEEP})" \
    "--dir PATH            write dumps to PATH instead of ${BACKUP_DIR}" \
    "--no-globals          skip the companion pg_dumpall --globals-only dump" \
    "--print-path          print the new dump path on stdout and nothing else"
}

while (( $# )); do
  case "$1" in
    --keep)
      shift
      [[ $# && $1 =~ ^[0-9]+$ ]] || die "--keep needs a non-negative integer"
      KEEP="$1"
      ;;
    --dir)
      shift
      [[ $# ]] || die "--dir needs a path"
      BACKUP_DIR="$1"
      ;;
    --no-globals) WITH_GLOBALS=0 ;;
    --print-path) PRINT_PATH=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

KEEP="$(parse_nonnegative_integer "${KEEP}" 'backup retention')"
require_docker
require_compose_file

# --print-path promises a clean stdout, so move the log stream aside before any
# other output is produced.
if (( PRINT_PATH )); then
  LOG_STREAM=2
fi

# The dump has to run against a live server, so refuse early with a clear
# message rather than emitting an empty file.
if [[ ${DRY_RUN} == 0 ]]; then
  db_state="$(container_state db)"
  case ${db_state} in
    running*) ;;
    *) die "the 'db' service is ${db_state}; start it first with: docker compose up -d db" ;;
  esac
fi

ensure_backup_dir

lock_dir='' work_dir='' unpublished_globals='' unpublished_pin=''
cleanup_backup() {
  [[ -z ${unpublished_pin} ]] || rm -f -- "${unpublished_pin}"
  [[ -z ${unpublished_globals} ]] || rm -f -- "${unpublished_globals}"
  [[ -z ${work_dir} ]] || rm -rf -- "${work_dir}"
  [[ -z ${lock_dir} ]] || rmdir -- "${lock_dir}" 2>/dev/null || true
  return 0
}
trap cleanup_backup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ ${DRY_RUN} == 0 ]]; then
  umask 077
  mkdir -- "${BACKUP_DIR}/.backup.lock" 2>/dev/null ||
    die "backup directory is locked; another backup may be running: ${BACKUP_DIR}/.backup.lock"
  lock_dir="${BACKUP_DIR}/.backup.lock"
  work_dir="$(mktemp -d "${BACKUP_DIR}/.backup.XXXXXX")" || die "cannot create backup staging directory"
fi

stamp="$(now_utc)"
target="${BACKUP_DIR}/opencw_${stamp}.sql.gz"
# Timestamps have one-second resolution, so two runs inside the same second would
# otherwise silently overwrite each other. Keep both.
if [[ -e ${target} ]]; then
  n=2
  while [[ -e "${BACKUP_DIR}/opencw_${stamp}-${n}.sql.gz" ]]; do
    n=$(( n + 1 ))
  done
  target="${BACKUP_DIR}/opencw_${stamp}-${n}.sql.gz"
fi
partial="${work_dir:-${BACKUP_DIR}/.backup.XXXXXX}/data.sql"

# Never publish a name that retention/default restore can discover until the
# complete, nonempty SQL has been compressed and validated successfully.
compress_sql() {
  [[ -s $1 ]] || return 1
  gzip -c -- "$1" > "$2" || return 1
  gzip -t -- "$2"
}

if [[ ${DRY_RUN} == 1 ]]; then
  dry_pipe "lock ${BACKUP_DIR}/.backup.lock; stage and validate nonempty SQL/gzip before publishing ${target}"
  dry_pipe "compose exec -T db sh -c 'pg_dump -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\"' > ${partial}"
  if (( WITH_GLOBALS )); then
    dry_pipe "stage and validate pg_dumpall --globals-only before publishing $(companion_globals_for "${target}")"
  fi
  prune_backups "${KEEP}"
else
  info "dumping database to ${target}"
  if ! compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "${partial}"; then
    die "pg_dump failed; no backup published. Check 'docker compose logs db'."
  fi
  compress_sql "${partial}" "${work_dir}/data.sql.gz" || die "empty SQL or failed gzip validation; no backup published"

  if (( WITH_GLOBALS )); then
    globals="$(companion_globals_for "${target}")"
    if compose exec -T db sh -c 'pg_dumpall --globals-only -U "$POSTGRES_USER"' > "${work_dir}/globals.sql" &&
       compress_sql "${work_dir}/globals.sql" "${work_dir}/globals.sql.gz"; then
      mkdir -p -- "$(dirname -- "${globals}")"
      mv -- "${work_dir}/globals.sql.gz" "${globals}"
      unpublished_globals="${globals}"
      log "wrote ${globals}"
    else
      warn "globals dump or validation failed; continuing without a roles/grants dump"
    fi
  fi

  # Protect the returned path even when another dump has a future mtime.
  unpublished_pin="${target}.restore-pin"
  : > "${unpublished_pin}"
  mv -- "${work_dir}/data.sql.gz" "${target}" || die "cannot publish validated backup"
  [[ ${BACKUP_PIN:-0} != 1 ]] || unpublished_pin=''
  unpublished_globals=''
  ok "backup written: ${target} ($(human_size "${target}"))"
  prune_backups "${KEEP}"
fi

if (( PRINT_PATH )); then
  printf '%s\n' "${target}"
fi
