#!/usr/bin/env bash
# Validate the root .env against the requirements documented in DEPLOYMENT.md.
#
# Reports every problem it finds in one pass instead of stopping at the first
# one, so a half-configured file can be fixed in a single round trip. Warnings
# describe values that work but are likely to bite later (weak secrets, an empty
# tunnel token, disabled email delivery).
#
# Used directly (`make check`) and by deploy.sh, update.sh and status.sh.

set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

# Read-only validation: neither --dry-run nor --yes means anything here.
COMMON_OPTS=()

QUIET=0

usage() {
  print_help \
    "Validate ${ENV_FILE} against the requirements in DEPLOYMENT.md." \
    "scripts/check-env.sh [--quiet]" \
    "--quiet               print nothing when the file is valid" \
    "--env-file PATH       validate PATH instead of ${ENV_FILE}"
}

while (( $# )); do
  case "$1" in
    --quiet) QUIET=1 ;;
    --env-file)
      shift
      [[ $# ]] || die "--env-file needs a path"
      ENV_FILE="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

if [[ ! -f ${ENV_FILE} ]]; then
  die "no ${ENV_FILE}; create it with: cp ${EXAMPLE_ENV_FILE} ${ENV_FILE}"
fi

problems=()
warnings=()

# Required for `docker compose` interpolation in the root docker-compose.yaml.
# RESEND_API_KEY / RESEND_FROM_EMAIL are not just for email delivery:
# backend/internal/configs/config.go declares them `required:"true"` and calls
# os.Exit(1) when validation fails, so an empty value crash-loops the backend.
REQUIRED=(
  POSTGRES_USER
  POSTGRES_PASSWORD
  POSTGRES_DB
  JWT_SECRET
  RESEND_API_KEY
  RESEND_FROM_EMAIL
  CORS_ORIGINS
  PUBLIC_API_BASE
  PGADMIN_DEFAULT_EMAIL
  PGADMIN_DEFAULT_PASSWORD
)

value_of() { env_get "$1" || true; }

# Bytes for a Compose-style size (2g, 512m, 3000000000), or empty when the value is not a
# size. Used to compare two sizes, which is how the db service's shared memory is checked
# against its memory limit below.
bytes_of() {
  local value digits unit multiplier=1
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ -n ${value} ]] || return 0
  [[ ${value} =~ ^([0-9]+)([bkmgtp]|([bkmgtp])b)?$ ]] || return 0
  digits="${BASH_REMATCH[1]}"
  unit="${BASH_REMATCH[3]:-${BASH_REMATCH[2]}}"
  while [[ ${#digits} -gt 1 && ${digits} == 0* ]]; do digits="${digits#0}"; done
  # Refuse overflow before multiplication; a valid-looking size must not wrap.
  (( ${#digits} <= 18 )) || return 0
  case "${unit}" in
    k) multiplier=1024 ;;
    m) multiplier=1048576 ;;
    g) multiplier=1073741824 ;;
    t) multiplier=1099511627776 ;;
    p) multiplier=1125899906842624 ;;
  esac
  (( 10#${digits} <= 9223372036854775807 / multiplier )) || return 0
  printf '%s' "$(( 10#${digits} * multiplier ))"
}

for key in "${REQUIRED[@]}"; do
  [[ -n "$(value_of "${key}")" ]] || problems+=("${key} is missing or empty")
done

# --- format checks (only meaningful once the value is present) ---------------

jwt="$(value_of JWT_SECRET)"
if [[ -n ${jwt} ]]; then
  if [[ ! ${jwt} =~ ^[A-Za-z0-9+/]+={0,2}$ || $(( ${#jwt} % 4 )) -ne 0 ]]; then
    problems+=("JWT_SECRET is not valid base64 (generate one with: openssl rand -base64 32)")
  else
    bytes="$(base64_decoded_bytes "${jwt}" || printf '0')"
    if (( bytes < 32 )); then
      problems+=("JWT_SECRET decodes to ${bytes} bytes; the backend expects at least 32")
    fi
  fi
fi

cors="$(value_of CORS_ORIGINS)"
if [[ -n ${cors} && ${cors} != *"://"* ]]; then
  problems+=("CORS_ORIGINS must be a comma-separated list of origins, e.g. https://ditpath.example.com")
fi

api_base="$(value_of PUBLIC_API_BASE)"
if [[ -n ${api_base} && ${api_base} != http*://* ]]; then
  problems+=("PUBLIC_API_BASE must be an absolute URL, e.g. https://api.ditpath.example.com/v1")
fi

pgadmin_email="$(value_of PGADMIN_DEFAULT_EMAIL)"
if [[ -n ${pgadmin_email} && ${pgadmin_email} != *"@"* ]]; then
  problems+=("PGADMIN_DEFAULT_EMAIL must be an email address (it is the pgAdmin login, not a PostgreSQL role)")
fi

# --- PostgreSQL resource tuning (all optional) -------------------------------
# db/tune.sh and Compose both read these. A typo does not stop the stack: the tuner warns
# and falls back to auto-detection, so the only visible symptom would be settings that
# quietly differ from what .env asks for. Check the shape here instead.

for key in POSTGRES_MEMORY_LIMIT POSTGRES_CPU_LIMIT POSTGRES_SHM_SIZE; do
  value="$(value_of "${key}")"
  [[ -n ${value} ]] || continue
  value_lc="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  if [[ ${key} == POSTGRES_CPU_LIMIT ]]; then
    if [[ ! ${value_lc} =~ ^[0-9]+(\.[0-9]+)?$ ]] ||
        ! parse_nonnegative_integer "${value_lc%%.*}" POSTGRES_CPU_LIMIT >/dev/null 2>&1; then
      problems+=("${key} must be a CPU count such as 2 or 1.5 (0 means no limit)")
    fi
  else
    [[ -n "$(bytes_of "${value_lc}")" ]] ||
      problems+=("${key} must be a byte size such as 512mb or 2g (0 means no limit)")
  fi
done

max_conns="$(value_of POSTGRES_MAX_CONNECTIONS)"
max_conns_decimal=''
if [[ -n ${max_conns} ]] && ! max_conns_decimal="$(parse_nonnegative_integer "${max_conns}" POSTGRES_MAX_CONNECTIONS 2>/dev/null)"; then
  problems+=("POSTGRES_MAX_CONNECTIONS must be a whole number no larger than 999999999")
fi

mem_share="$(value_of POSTGRES_HOST_MEMORY_SHARE)"
mem_share_decimal=''
if [[ -n ${mem_share} ]] && ! mem_share_decimal="$(parse_nonnegative_integer "${mem_share}" POSTGRES_HOST_MEMORY_SHARE 2>/dev/null)"; then
  problems+=("POSTGRES_HOST_MEMORY_SHARE must be a whole percentage between 1 and 100")
elif [[ -n ${mem_share_decimal} ]] && (( mem_share_decimal < 1 || mem_share_decimal > 100 )); then
  problems+=("POSTGRES_HOST_MEMORY_SHARE is ${mem_share}, which is outside 1..100")
fi

tune_disable="$(value_of POSTGRES_TUNE_DISABLE)"
case "${tune_disable}" in
  ''|0|1|true|false) ;;
  *) problems+=("POSTGRES_TUNE_DISABLE must be 0 or 1") ;;
esac

# Validate through the same calculator used at startup and by make tune.
if ! tuning_output="$(postgres_tune --print 2>&1)"; then
  problems+=("${tuning_output}")
fi

# --- warnings ---------------------------------------------------------------

if [[ -z "$(value_of CLOUDFLARED_TUNNEL_TOKEN)" ]]; then
  printf -v msg \
    'CLOUDFLARED_TUNNEL_TOKEN is empty: cloudflared has no "profiles:" key, so it starts with\nthe default stack and will restart-loop without a token. Set it in .env, or stop the\nservice with: docker compose stop cloudflared'
  warnings+=("${msg}")
fi

if [[ -z "$(value_of POSTGRES_DATA_PATH)" ]]; then
  warnings+=("POSTGRES_DATA_PATH is unset; Compose falls back to ./data/postgres inside the repo")
fi

pg_password="$(value_of POSTGRES_PASSWORD)"
if [[ -n ${pg_password} && ${#pg_password} -lt 16 ]]; then
  warnings+=("POSTGRES_PASSWORD is shorter than 16 characters")
fi

# /dev/shm is charged to the container's memory limit, so a shared-memory demand larger
# than the limit surfaces as an out-of-memory kill under parallel queries rather than as a
# start-up error. Verified on Docker 26 and Docker 29: such a container does start.
shm_bytes="$(bytes_of "$(value_of POSTGRES_SHM_SIZE)")"
mem_bytes="$(bytes_of "$(value_of POSTGRES_MEMORY_LIMIT)")"
if [[ -n ${mem_bytes} && ${tune_disable} != 1 && ${tune_disable} != true && "$(value_of POSTGRES_TUNE_MODE)" != off ]] && (( mem_bytes > 0 && mem_bytes < 536870912 )); then
  problems+=("POSTGRES_MEMORY_LIMIT must be at least 512 MiB for automatic tuning")
fi
if [[ -n ${shm_bytes} && -n ${mem_bytes} ]] && (( mem_bytes > 0 && shm_bytes > mem_bytes )); then
  printf -v msg \
    'POSTGRES_SHM_SIZE (%s) is larger than POSTGRES_MEMORY_LIMIT (%s). /dev/shm is counted\nagainst the container memory limit, so the database can be killed out of memory under\nparallel queries. Keep POSTGRES_SHM_SIZE at or below the memory limit.' \
    "$(value_of POSTGRES_SHM_SIZE)" "$(value_of POSTGRES_MEMORY_LIMIT)"
  warnings+=("${msg}")
fi

# The server caps total connections; the backend pool is one client of it. A pool larger
# than the ceiling shows up later as "too many clients already" under load.
if [[ -n ${max_conns_decimal} ]]; then
  pool_conns="$(value_of DB_MAX_OPEN_CONNS)"
  pool_conns="${pool_conns:-25}"
  pool_conns_decimal="$(parse_nonnegative_integer "${pool_conns}" DB_MAX_OPEN_CONNS 2>/dev/null || true)"
  if [[ -n ${pool_conns_decimal} ]] && (( max_conns_decimal < pool_conns_decimal )); then
    warnings+=("POSTGRES_MAX_CONNECTIONS (${max_conns}) is below DB_MAX_OPEN_CONNS (${pool_conns}); the backend pool alone could exhaust the server's connections")
  fi
fi

pgadmin_password="$(value_of PGADMIN_DEFAULT_PASSWORD)"
if [[ -n ${pgadmin_password} && ${#pgadmin_password} -lt 12 ]]; then
  warnings+=("PGADMIN_DEFAULT_PASSWORD is shorter than 12 characters")
fi

if [[ -n ${api_base} && ${api_base} =~ ^https?://(localhost|127\.0\.0\.1) ]]; then
  printf -v msg \
    'PUBLIC_API_BASE is %s, which is baked into the frontend bundle at build time.\nBrowsers will only resolve it on the machine running this stack.' \
    "${api_base}"
  warnings+=("${msg}")
fi

# --- report -----------------------------------------------------------------

if (( ${#problems[@]} )); then
  printf '%s%s has %d problem(s):%s\n' "${C_RED}" "${ENV_FILE}" "${#problems[@]}" "${C_RESET}" >&2
  i=1
  for problem in "${problems[@]}"; do
    printf '  %d. %s\n' "${i}" "${problem}" >&2
    i=$(( i + 1 ))
  done
fi

if (( ${#warnings[@]} )); then
  printf '%s%s has %d warning(s):%s\n' "${C_YELLOW}" "${ENV_FILE}" "${#warnings[@]}" "${C_RESET}" >&2
  nl=$'\n'
  for warning in "${warnings[@]}"; do
    # Each warning is one array entry; continuation lines of a multi-line
    # message keep the list indentation.
    printf '  - %s\n' "${warning//${nl}/${nl}    }" >&2
  done
fi

if (( ${#problems[@]} )); then
  printf '\nSee the "Clone and configure" section of DEPLOYMENT.md.\n' >&2
  exit 1
fi

if (( QUIET == 0 )); then
  ok "${ENV_FILE} is valid (${#warnings[@]} warning(s))"
fi

exit 0
