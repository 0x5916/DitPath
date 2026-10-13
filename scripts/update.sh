#!/usr/bin/env bash
# Update a deployed DitPath stack safely.
#
# Sequence: snapshot the running images and the current commit, take a database
# backup, move to the target revision, rebuild, and verify that every service
# answers. If verification fails the operator gets exact rollback commands, and
# with --auto-rollback the previous images are restored automatically.
#
# Note: the backend runs GORM AutoMigrate at startup (backend/internal/databases/db.go)
# and those migrations are forward-only, so rolling the images back does not undo
# schema changes. The pre-update backup is the reliable way back.

set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

REF=''
NO_BACKUP=0
AUTO_ROLLBACK=0
TIMEOUT=240
KEEP="${BACKUP_RETENTION:-14}"

SNAPSHOTS=()
PREV_REF=''
PREV_BRANCH=''
PREV_BACKUP=''

usage() {
  print_help \
    "Pull the latest code, rebuild, and verify the stack came back healthy." \
    "scripts/update.sh [options]" \
    "--ref REF             update to REF (branch, tag or commit) instead of pulling the current branch" \
    "--no-backup           skip the pre-update database backup" \
    "--auto-rollback       restore the previous images automatically if verification fails" \
    "--timeout SECONDS     how long to wait for each service (default ${TIMEOUT})" \
    "--keep N              retention for the pre-update backup (default ${KEEP})"
}

while (( $# )); do
  case "$1" in
    --ref)
      shift
      [[ $# && -n $1 && $1 != -* ]] || die "--ref needs a branch, tag or commit"
      REF="$1"
      ;;
    --no-backup) NO_BACKUP=1 ;;
    --auto-rollback) AUTO_ROLLBACK=1 ;;
    --timeout)
      shift
      [[ $# && $1 =~ ^[0-9]+$ ]] || die "--timeout needs a number of seconds"
      TIMEOUT="$1"
      ;;
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
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

TIMEOUT="$(parse_nonnegative_integer "${TIMEOUT}" '--timeout')"
KEEP="$(parse_nonnegative_integer "${KEEP}" '--keep')"
require_docker
require_compose_file
require_git_checkout
require_env_file
"${SCRIPTS_DIR}/check-env.sh" || die "fix the environment before updating"

git_step() {
  local description="$1"
  shift
  if [[ ${DRY_RUN} == 1 ]]; then
    printf '%s[dry-run]%s git -C %s %s\n' "${C_DIM}" "${C_RESET}" "${ROOT_DIR}" "$(_quote_cmd "$@")"
    return 0
  fi
  log "${description}"
  ( cd -- "${ROOT_DIR}" && git "$@" )
}

# --- rollback helpers -------------------------------------------------------

verify_services() {
  local verified=1 service
  for service in db backend frontend pgadmin; do
    wait_service_healthy "${service}" "${TIMEOUT}" || verified=0
  done
  if (( verified )); then
    wait_http "backend API" "http://127.0.0.1:${API_PORT}/v1/health" "${TIMEOUT}" || verified=0
    wait_http "frontend" "http://127.0.0.1:${FRONTEND_PORT}/" "${TIMEOUT}" || verified=0
    wait_http "pgAdmin" "http://127.0.0.1:${PGADMIN_PORT}/misc/ping" "${TIMEOUT}" || true
  else
    warn "skipping the HTTP probes because a container did not become healthy"
  fi
  (( verified ))
}

canonical_image_ref() {
  local image="$1"
  [[ ${image##*/} == *:* || ${image} == *@* ]] || image+=':latest'
  printf '%s' "${image}"
}

verify_restored_images() {
  local containers pair expected cid configured actual matched
  containers="$(compose ps -aq)" || return 1
  for pair in "${SNAPSHOTS[@]}"; do
    expected="$(docker image inspect -f '{{.Id}}' "${pair##*|}")" || return 1
    [[ -n ${expected} ]] || return 1
    matched=0
    while IFS= read -r cid; do
      [[ -n ${cid} ]] || continue
      configured="$(docker inspect -f '{{.Config.Image}}' "${cid}")" || return 1
      [[ $(canonical_image_ref "${configured}") == "$(canonical_image_ref "${pair%%|*}")" ]] || continue
      matched=1
      actual="$(docker inspect -f '{{.Image}}' "${cid}")" || return 1
      [[ ${actual} == "${expected}" ]] || { warn "${configured} is not running the restored image"; return 1; }
    done <<< "${containers}"
    (( matched )) || { warn "no container found for restored image ${pair%%|*}"; return 1; }
  done
}

snapshot_rollback_lines() {
  local pair
  for pair in "${SNAPSHOTS[@]}"; do
    printf '  %s\n' "$(_quote_cmd docker tag "${pair##*|}" "${pair%%|*}")"
  done
}

print_rollback_help() {
  printf '\n' >&2
  warn "the update did not come up cleanly"
  {
    printf 'Roll back with:\n\n'
    printf '  %s\n' "$(_quote_cmd git -C "${ROOT_DIR}" checkout --detach "${PREV_REF}")"
    if (( ${#SNAPSHOTS[@]} )); then
      snapshot_rollback_lines
    else
      printf '  # no image snapshots were taken (no local images before the rebuild)\n'
    fi
    printf '  %s\n\n' "$(_quote_cmd docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --no-build)"
    if [[ -n ${PREV_BACKUP} ]]; then
      printf 'If the application is broken rather than the images, restore the pre-update dump:\n\n'
      printf '  %s\n\n' "$(_quote_cmd env "ENV_FILE=${ENV_FILE}" "${SCRIPTS_DIR}/restore.sh" --file "${PREV_BACKUP}")"
    fi
    printf 'AutoMigrate runs at backend startup and is forward-only, so an image rollback does\n'
    printf 'not undo schema changes. Re-run with --auto-rollback to do the image part for you.\n\n'
    printf 'The rollback leaves the checkout on a detached HEAD, so before your next update\n'
    printf 'return to a branch (and fix whatever the failure was, e.g. .env):\n\n'
    printf '  %s\n' "$(_quote_cmd git -C "${ROOT_DIR}" checkout "$(resume_branch)")"
  } >&2
}

# Resume this update's branch, or the last recorded branch after a detached rollback.
resume_branch() {
  local branch
  if [[ -n ${PREV_BRANCH} && ${PREV_BRANCH} != HEAD ]]; then
    printf '%s' "${PREV_BRANCH}"
    return 0
  fi
  branch="$(state_get PREV_BRANCH || true)"
  if [[ -z ${branch} || ${branch} == HEAD ]]; then
    printf 'main'
  else
    printf '%s' "${branch}"
  fi
}

fail_update() {
  print_rollback_help

  if (( AUTO_ROLLBACK )) && [[ ${DRY_RUN} == 0 ]]; then
    printf '\n' >&2
    warn "--auto-rollback: restoring the previous release"
    if ! ( cd -- "${ROOT_DIR}" && git checkout --detach "${PREV_REF}" ); then
      die "could not check out ${PREV_REF}; roll back manually using the commands above"
    fi
    local pair
    for pair in "${SNAPSHOTS[@]}"; do
      docker tag "${pair##*|}" "${pair%%|*}" ||
        die "could not restore image ${pair%%|*}; rollback stopped before restarting services"
    done
    if compose up -d --no-build && verify_restored_images && verify_services; then
      ok "the previous images are running and healthy; the database may still carry newer migrations"
      info "review 'docker compose logs --tail=100 backend' and consider scripts/restore.sh"
    else
      warn "the automatic rollback did not complete; use the commands above"
    fi
  fi

  exit 1
}

# --- 1. record the current state and check the preconditions ---------------

if [[ ${DRY_RUN} == 0 ]]; then
  if [[ -n "$( cd -- "${ROOT_DIR}" && git status --porcelain --untracked-files=no )" ]]; then
    die "there are uncommitted changes in ${ROOT_DIR}; commit or stash them first (git -C ${ROOT_DIR} status)"
  fi
fi

PREV_REF="$( cd -- "${ROOT_DIR}" && git rev-parse HEAD )"
PREV_BRANCH="$( cd -- "${ROOT_DIR}" && git rev-parse --abbrev-ref HEAD )"
stamp="$(now_utc)"

info "current revision: ${PREV_REF:0:12} (${PREV_BRANCH})"

# Resolve where we are going before doing any work: a run that cannot move to a
# revision should not snapshot images and take a database backup first. UPSTREAM
# is reused by step 3.
UPSTREAM=''
TARGET_COMMIT=''
TARGET_BRANCH=''
NEW_TRACKING_BRANCH=0
if [[ -z ${REF} ]]; then
  # A detached HEAD has no upstream, so `git pull` cannot work. That is the state
  # a rollback leaves behind, so name the branch to return to rather than
  # reporting a bare missing-upstream error.
  if [[ ${PREV_BRANCH} == HEAD ]]; then
    die "the checkout is in a detached HEAD state (a rollback leaves it that way), which has no upstream to pull. Return to a branch first: git -C ${ROOT_DIR} checkout $(resume_branch)"
  fi
  UPSTREAM="$( cd -- "${ROOT_DIR}" && git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true )"
  if [[ -z ${UPSTREAM} ]]; then
    die "'${PREV_BRANCH}' has no upstream branch; pass a revision explicitly with --ref"
  fi
else
  git_step "fetching requested revision" fetch --all --tags --prune
  target_spec="${REF}"
  if git_in_root show-ref --verify --quiet "refs/heads/${REF}"; then
    TARGET_BRANCH="${REF}"
    target_spec="$(git_in_root rev-parse --abbrev-ref --symbolic-full-name "${REF}@{u}" 2>/dev/null || true)"
    if [[ -z ${target_spec} ]]; then
      target_spec="refs/heads/${REF}"
      if git_in_root show-ref --verify --quiet "refs/remotes/origin/${REF}"; then
        target_spec="origin/${REF}"
      fi
    fi
  elif git_in_root check-ref-format --branch "${REF}" >/dev/null 2>&1 &&
      git_in_root show-ref --verify --quiet "refs/remotes/origin/${REF}"; then
    TARGET_BRANCH="${REF}"
    NEW_TRACKING_BRANCH=1
    target_spec="origin/${REF}"
  fi
  TARGET_COMMIT="$(git_in_root rev-parse --verify --end-of-options "${target_spec}^{commit}" 2>/dev/null)" ||
    die "'${REF}' does not resolve to a commit"
  if [[ -n ${TARGET_BRANCH} && ${NEW_TRACKING_BRANCH} == 0 ]]; then
    git_in_root merge-base --is-ancestor "refs/heads/${TARGET_BRANCH}" "${TARGET_COMMIT}" ||
      die "'${TARGET_BRANCH}' cannot fast-forward to '${target_spec}'; resolve its history before updating"
  fi
fi

# Snapshot the images that are about to be replaced so a rollback has something
# to restore. Compose derives the names; only existing local images can be tagged.
if [[ ${DRY_RUN} == 1 ]]; then
  # Deliberately does not call list_stack_images here: under --dry-run that
  # helper only echoes its own command instead of resolving real image names.
  printf '%s[dry-run]%s for each name from "docker compose config --images": docker tag <image> <image>:pre-%s\n' \
    "${C_DIM}" "${C_RESET}" "${stamp}" >&"${LOG_STREAM}"
else
  while IFS= read -r image; do
    [[ -n ${image} ]] || continue
    if ! docker image inspect "${image}" >/dev/null 2>&1; then
      log "no local image for ${image}; skipping snapshot"
      continue
    fi
    snap="$(tag_snapshot_ref "${image}" "pre-${stamp}")"
    # A failed snapshot is worth a warning, not an abort: the backup in step 2 is
    # the primary safety net and the update itself may still be fine.
    if docker tag "${image}" "${snap}" 2>/dev/null; then
      SNAPSHOTS+=("${image}|${snap}")
      log "snapshot: ${image} -> ${snap}"
    else
      warn "could not snapshot ${image} as ${snap}; rollback will not include it"
    fi
  done < <(built_stack_images)
fi

# --- 2. back up before touching anything ------------------------------------

if (( NO_BACKUP )); then
  warn "--no-backup: skipping the pre-update database backup"
elif [[ ${DRY_RUN} == 1 ]]; then
  dry_pipe "${SCRIPTS_DIR}/backup.sh --keep ${KEEP}"
else
  info "taking a pre-update database backup"
  PREV_BACKUP="$("${SCRIPTS_DIR}/backup.sh" --keep "${KEEP}" --print-path)" ||
    die "the pre-update backup failed; aborting before any change"
  ok "pre-update backup: ${PREV_BACKUP}"
fi

# --- 3. move to the target revision ----------------------------------------

if [[ -n ${REF} ]]; then
  if (( NEW_TRACKING_BRANCH )); then
    git_step "checking out ${REF}" checkout --track -b "${TARGET_BRANCH}" "origin/${TARGET_BRANCH}"
  elif [[ -n ${TARGET_BRANCH} ]]; then
    git_step "checking out ${REF}" checkout "${TARGET_BRANCH}"
    git_step "fast-forwarding ${REF}" merge --ff-only "${TARGET_COMMIT}"
  else
    git_step "checking out ${REF}" checkout --detach "${TARGET_COMMIT}"
  fi
else
  git_step "pulling ${UPSTREAM} (fast-forward only)" pull --ff-only
fi

if [[ ${DRY_RUN} == 1 ]]; then
  new_ref="${PREV_REF}"
else
  new_ref="$( cd -- "${ROOT_DIR}" && git rev-parse HEAD )"
fi

if [[ ${new_ref} == "${PREV_REF}" ]]; then
  log "already at ${new_ref:0:12}; rebuilding in case dependencies or build args changed"
else
  ok "moving ${PREV_REF:0:12} -> ${new_ref:0:12}"
fi

# --- 4. rebuild -------------------------------------------------------------

info "rebuilding and restarting changed services"
if ! compose up -d --build; then
  fail_update
fi

# --- 5. verify --------------------------------------------------------------

if [[ ${DRY_RUN} == 1 ]]; then
  dry_pipe "wait for db/backend/frontend/pgadmin, then probe /v1/health"
else
  info "verifying the stack (timeout ${TIMEOUT}s per service)"
  if ! verify_services; then
    fail_update
  fi
fi

# --- 6. record the release --------------------------------------------------

if (( ${#SNAPSHOTS[@]} )); then
  joined=''
  for pair in "${SNAPSHOTS[@]}"; do
    joined+="${joined:+ }${pair##*|}"
  done
  state_set SNAPSHOTS "${joined}"
else
  state_set SNAPSHOTS ''
fi
state_set PREV_REF "${PREV_REF}"
state_set PREV_BRANCH "${PREV_BRANCH}"
state_set PREV_BACKUP "${PREV_BACKUP}"
state_set NEW_REF "${new_ref}"
state_set UPDATED_AT "$(date -u +%FT%TZ)"

printf '\n'
ok "update complete: ${PREV_REF:0:12} -> ${new_ref:0:12}"
printf '\n'
printf '  Revision    %s\n' "${new_ref}"
printf '  Backup      %s\n' "${PREV_BACKUP:-none (--no-backup)}"
printf '  Rollback    %s\n' "$(_quote_cmd git -C "${ROOT_DIR}" checkout --detach "${PREV_REF}")"
if (( ${#SNAPSHOTS[@]} )); then
  printf '\nImage snapshots kept for rollback (review them with "docker images | grep pre-"):\n'
  snapshot_rollback_lines
fi
printf '\n'
printf 'Check the result with: make status\n'
