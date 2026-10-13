#!/usr/bin/env bash
# Restore a DitPath database dump created by scripts/backup.sh.
#
# Destructive by design: the default mode drops and recreates the target
# database so the restore is a clean replacement rather than a merge into
# whatever happens to be there. A pre-restore backup is always taken first
# (unless --no-backup), and the operator has to confirm by typing the database
# name.

set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

DUMP_FILE=''
GLOBALS_FILE=''
MODE='recreate'
WITH_GLOBALS=1
NO_BACKUP=0
KEEP="${BACKUP_RETENTION:-14}"

usage() {
  print_help \
    "Restore a DitPath database dump. Overwrites the target database." \
    "scripts/restore.sh [FILE] [options]" \
    "FILE                  dump to restore (.sql.gz or .sql); default: newest in ${BACKUP_DIR}" \
    "--file PATH           same as the positional FILE" \
    "--globals PATH        restore roles/grants from a pg_dumpall --globals-only dump" \
    "--no-globals          do not look for a companion .globals.sql.gz next to FILE" \
    "--append              apply the dump on top of the existing schema instead of recreating it" \
    "--no-backup           skip the automatic pre-restore backup (not recommended)" \
    "--keep N              retention after a successful restore; 0 disables pruning (default ${KEEP})"
}

while (( $# )); do
  case "$1" in
    --file)
      shift
      [[ $# ]] || die "--file needs a path"
      DUMP_FILE="$1"
      ;;
    --globals)
      shift
      [[ $# ]] || die "--globals needs a path"
      GLOBALS_FILE="$1"
      ;;
    --no-globals) WITH_GLOBALS=0 ;;
    --append) MODE='append' ;;
    --no-backup) NO_BACKUP=1 ;;
    --keep)
      shift
      [[ $# && $1 =~ ^[0-9]+$ ]] || die "--keep needs a non-negative integer"
      KEEP="$1"
      ;;
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      [[ -z ${DUMP_FILE} ]] || die "unexpected argument: $1 (try --help)"
      DUMP_FILE="$1"
      ;;
  esac
  shift
done

KEEP="$(parse_nonnegative_integer "${KEEP}" 'restore retention')"
require_docker
require_compose_file
require_env_file

db_name="$(env_get POSTGRES_DB || true)"
[[ -n ${db_name} ]] || die "POSTGRES_DB is not set in ${ENV_FILE}"

# --- resolve the dump -------------------------------------------------------

resolve_file() {
  local candidate="$1"
  if [[ -f ${candidate} ]]; then
    printf '%s\n' "${candidate}"
  elif [[ -f ${ROOT_DIR}/${candidate} ]]; then
    printf '%s\n' "${ROOT_DIR}/${candidate}"
  elif [[ -f ${BACKUP_DIR}/${candidate} ]]; then
    printf '%s\n' "${BACKUP_DIR}/${candidate}"
  else
    return 1
  fi
}

if [[ -z ${DUMP_FILE} ]]; then
  DUMP_FILE="$(latest_backup)"
  [[ -n ${DUMP_FILE} ]] ||
    die "no dumps in ${BACKUP_DIR}; pass a file: scripts/restore.sh /path/to/opencw_<date>.sql.gz"
else
  DUMP_FILE="$(resolve_file "${DUMP_FILE}")" || die "cannot find dump '${DUMP_FILE}'"
fi

if [[ -n ${GLOBALS_FILE} ]]; then
  GLOBALS_FILE="$(resolve_file "${GLOBALS_FILE}")" || die "cannot find globals dump '${GLOBALS_FILE}'"
fi

# A companion globals dump sits next to the chosen dump (in backups/globals) when
# backup.sh wrote one.
if (( WITH_GLOBALS )) && [[ -z ${GLOBALS_FILE} ]]; then
  sibling="$(companion_globals_for "${DUMP_FILE}")"
  if [[ -f ${sibling} ]]; then
    GLOBALS_FILE="${sibling}"
  fi
fi

stage_dir='' recovery_backup='' recovery_pin='' retention_lock=''
cleanup_restore() {
  [[ -z ${stage_dir} ]] || rm -rf -- "${stage_dir}"
  [[ -z ${retention_lock} ]] || rmdir -- "${retention_lock}" 2>/dev/null || true
  [[ -z ${recovery_pin} || ! -f ${recovery_pin} ]] ||
    warn "recovery backup retained: ${recovery_backup}; remove ${recovery_pin} only after recovery"
  return 0
}
trap cleanup_restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stage_sql() {
  [[ -f $1 && -r $1 && -s $1 ]] || die "dump is missing, unreadable, or empty: $1"
  case "$1" in
    *.gz) gzip -dc -- "$1" > "$2" || die "cannot decompress dump: $1" ;;
    *) cat -- "$1" > "$2" || die "cannot read dump: $1" ;;
  esac
  [[ -s $2 ]] || die "dump contains no SQL: $1"
}

if [[ ${DRY_RUN} == 0 ]]; then
  stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/opencw-restore.XXXXXX")" || die "cannot create restore staging directory"
  stage_sql "${DUMP_FILE}" "${stage_dir}/data.sql"
  if [[ -n ${GLOBALS_FILE} ]]; then
    stage_sql "${GLOBALS_FILE}" "${stage_dir}/globals.sql"
    # Preserve pg_dumpall's quoted identifiers verbatim. A delimiter absent from
    # the input lets existing roles be skipped without masking other SQL errors.
    role_tag='$opencw_restore$'
    while grep -Fq -- "${role_tag}" "${stage_dir}/globals.sql"; do role_tag="${role_tag%\$}_\$"; done
    final_newline=1
    [[ -z $(tail -c 1 -- "${stage_dir}/globals.sql") ]] || final_newline=0
    awk -v role_tag="${role_tag}" -v final_newline="${final_newline}" -f "${SCRIPTS_DIR}/lib/prepare-globals.awk" \
      "${stage_dir}/globals.sql" > "${stage_dir}/prepared-globals.sql"
  fi
  db_state="$(container_state db)"
  case ${db_state} in
    running*) ;;
    *) die "the 'db' service is ${db_state}; start it first with: docker compose up -d db" ;;
  esac
  db_name="$(compose exec -T db sh -c 'printf "%s\n" "$POSTGRES_DB"')" || die "cannot read the running database name"
  [[ -n ${db_name} ]] || die "the running db service has no POSTGRES_DB"
else
  dry_pipe "stage and validate nonempty data/globals before confirmation or database changes"
fi

# --- confirm ----------------------------------------------------------------

info "dump:     ${DUMP_FILE} ($(human_size "${DUMP_FILE}"))"
if [[ -n ${GLOBALS_FILE} ]]; then
  info "globals:  ${GLOBALS_FILE}"
else
  info "globals:  none"
fi
info "target:   database '${db_name}' in the 'db' service"

if [[ ${MODE} == 'recreate' ]]; then
  warn "the database '${db_name}' will be DROPPED and recreated, then loaded from the dump"
else
  warn "the dump will be applied ON TOP of the existing '${db_name}' schema"
fi

typed_confirm "${db_name}" "This replaces data in the running DitPath stack."

# --- pre-restore backup -----------------------------------------------------

if (( NO_BACKUP )); then
  warn "--no-backup: skipping the pre-restore backup"
elif [[ ${DRY_RUN} == 1 ]]; then
  dry_pipe "${SCRIPTS_DIR}/backup.sh --keep 0 --print-path   # retain recovery through restore"
else
  info "taking a pre-restore backup first"
  recovery_backup="$(BACKUP_PIN=1 "${SCRIPTS_DIR}/backup.sh" --keep 0 --print-path)" ||
    die "the pre-restore backup failed; not touching the database"
  recovery_pin="${recovery_backup}.restore-pin"
  [[ -f ${recovery_backup} && -s ${recovery_backup} ]] || die "pre-restore backup is missing; not touching the database"
  [[ -f ${recovery_pin} ]] || die "pre-restore backup protection is missing; not touching the database"
  info "recovery backup: ${recovery_backup}"
fi

# --- restore ----------------------------------------------------------------

if [[ ${DRY_RUN} == 1 ]]; then
  [[ -z ${GLOBALS_FILE} ]] || dry_pipe "apply staged globals, ignoring only duplicate-role errors, before restoring data"
  if [[ ${MODE} == 'recreate' ]]; then
    dry_pipe "(cd ${ROOT_DIR} && docker compose -f ${COMPOSE_FILE} exec -T db sh -c 'dropdb -U \"\$POSTGRES_USER\" --if-exists --force \"\$POSTGRES_DB\" && createdb -U \"\$POSTGRES_USER\" -O \"\$POSTGRES_USER\" \"\$POSTGRES_DB\"')"
  fi
  extra=''
  [[ ${MODE} == 'recreate' ]] && extra=' --single-transaction'
  dry_pipe "compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1${extra} -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"' < staged-data.sql"
  dry_pipe "after successful verification, prune backups with retention ${KEEP}"
  exit 0
fi

# Owners and grants in the data dump may reference these roles. Prepare them
# before dropping the existing database so globals errors remain recoverable.
if [[ -n ${GLOBALS_FILE} ]]; then
  log "restoring roles and grants from ${GLOBALS_FILE}"
  compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres' \
    < "${stage_dir}/prepared-globals.sql" >/dev/null || die "globals restore failed; database was not recreated"
fi

if [[ ${MODE} == 'recreate' ]]; then
  log "dropping and recreating '${db_name}'"
  compose exec -T db sh -c \
    'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"' ||
    die "could not recreate the database"
fi

log "loading ${DUMP_FILE}"
if [[ ${MODE} == 'recreate' ]]; then
  # --single-transaction keeps a failed restore from leaving the database in a
  # half-loaded state.
  if ! compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    < "${stage_dir}/data.sql" >/dev/null; then
    die "restore failed; recovery backup: ${recovery_backup:-none (--no-backup)}"
  fi
else
  if ! compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    < "${stage_dir}/data.sql" >/dev/null; then
    die "restore failed; recovery backup: ${recovery_backup:-none (--no-backup)}"
  fi
fi

# --- verify -----------------------------------------------------------------

table_count="$(compose exec -T db sh -c \
  "psql -tA -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"select count(*) from information_schema.tables where table_schema = 'public'\"" |
  tr -d '[:space:]')"

if [[ ${table_count} =~ ^[0-9]+$ ]] && (( table_count > 0 )); then
  ok "restore complete: ${table_count} table(s) in the public schema of '${db_name}'"
else
  die "restore verification found no public tables; recovery backup: ${recovery_backup:-none (--no-backup)}"
fi

if (( NO_BACKUP == 0 )); then
  rm -f -- "${recovery_pin}"
  if (( KEEP > 0 )) && mkdir -- "${BACKUP_DIR}/.backup.lock" 2>/dev/null; then
    retention_lock="${BACKUP_DIR}/.backup.lock"
    prune_backups "${KEEP}"
  elif (( KEEP > 0 )); then
    warn "retention deferred because another backup holds ${BACKUP_DIR}/.backup.lock"
  fi
fi
info "restart the backend so it reconnects with a fresh connection pool: docker compose restart backend"
