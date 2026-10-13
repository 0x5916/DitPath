#!/bin/sh
#
# DitPath PostgreSQL tuner.
#
# The `db` service runs this as its entrypoint, immediately before the official
# PostgreSQL entrypoint. It works out how much memory and how many CPUs this container
# actually has, derives the server settings from that, prints what it decided and why,
# and then hands off to the image's own entrypoint with the derived `-c` flags appended.
# PostgreSQL is started exactly as the image intends: this script does not replace the
# image's initdb, pg_hba.conf or /docker-entrypoint-initdb.d handling, it only supplies
# configuration arguments.
#
# The settings used to be hardcoded for one machine size, which meant every host of a
# different size got numbers that were either wasteful or dangerous, and nothing on the
# running server said where they came from. They are now derived, and logged at startup.
#
# Memory budget, first source that yields a value wins:
#   1. POSTGRES_MEMORY_LIMIT                        explicit; also the container's mem_limit
#   2. cgroup v2 /sys/fs/cgroup/memory.max
#   3. cgroup v1 /sys/fs/cgroup/memory/memory.limit_in_bytes
#   4. POSTGRES_HOST_MEMORY_SHARE (default 50) percent of /proc/meminfo MemTotal, capped
#      at FALLBACK_CEILING_MIB
# Case 4 exists because a container with no memory limit reports the whole machine, which
# on a shared host is not ours to size against. The share applies only in case 4, never on
# top of an explicit or cgroup limit.
#
# Case 4 is also the least trustworthy source: /proc/meminfo is not namespaced, so inside a
# nested container (Docker inside an LXC, which is how this stack is deployed) MemTotal is
# the *physical* host's memory, not this container's. Measured on the project's 4 GiB test
# LXC, a container there reports 31 GiB. The fallback is therefore capped, and warned
# about, rather than trusted.
#
# CPU budget is the minimum of the applicable ceilings and available CPU count:
#   1. POSTGRES_CPU_LIMIT
#   2. cgroup v2 cpu.max
#   3. cgroup v1 cpu.cfs_quota_us / cpu.cfs_period_us
#   4. cpuset.cpus.effective / cpuset.cpus
#   5. nproc
#
# The legacy opencw formulas are conventional "web/OLTP on SSD" heuristics: shared_buffers at a
# quarter of the budget, the planner's cache estimate at three quarters, maintenance_work_mem
# at a sixteenth, work_mem divided by the connection count, wal_buffers at a thirty-second of
# shared_buffers, and parallel worker counts derived from the CPU count. Every value is
# clamped to a sane range so that a tiny budget still produces a server that starts.
#
# In opencw mode, settings describing storage or workload rather than machine size are
# deliberately left alone: checkpoint_completion_target, default_statistics_target,
# random_page_cost, effective_io_concurrency and huge_pages. Revisit those if the backing
# storage changes.
#
# Operator overrides:
#   POSTGRES_TUNE_DISABLE=1    skip the derived values (image defaults, plus anything the
#                              Compose `command:` passes)
#   POSTGRES_TUNE_EXTRA        extra arguments appended last, so they win. Space-separated,
#                              for example: -c work_mem=32MB
#   POSTGRES_MAX_CONNECTIONS   connection ceiling. Demand-driven rather than resource-driven,
#                              but it feeds the work_mem calculation.
#
# `--print` previews settings; `--shm` prints only the Docker shared-memory capacity.
# POSTGRES_TUNE_MODE selects opencw (legacy default), pgtune, or off.
#
# POSIX sh only: the image ships busybox ash, and this runs before the official entrypoint,
# so no bashisms and no arrays.

set -eu

log()  { printf 'opencw-pg-tune: %s\n' "$*"; }
warn() { printf 'opencw-pg-tune: WARNING: %s\n' "$*" >&2; }
die()  { printf 'opencw-pg-tune: ERROR: %s\n' "$*" >&2; exit 1; }
show() { printf 'opencw-pg-tune:   %-32s = %s\n' "$1" "$2"; }

# --- helpers ----------------------------------------------------------------

# First line of a readable file, without leading/trailing whitespace. Empty when unreadable.
# Interior spaces are kept: cpu.max is two fields, "QUOTA PERIOD".
first_line() {
  if [ ! -r "$1" ]; then
    return 0
  fi
  head -n 1 "$1" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' || true
}

# POSIX shell arithmetic treats a leading zero as octal. Normalize validated digits
# before using environment values or cgroup counters in arithmetic expressions.
decimal_number() {
  dn_value=$1
  case ${dn_value} in ''|*[!0-9]*) return 1 ;; esac
  while [ "${dn_value#0}" != "$dn_value" ]; do dn_value=${dn_value#0}; done
  printf '%s\n' "${dn_value:-0}"
}

# Convert a Compose-style byte size ("2g", "512mb", "3000000000") to whole MiB, rounding
# up so a sub-MiB value never becomes zero. Prints the MiB value; non-zero exit when the
# input is not a size we understand. This accepts exactly what Compose accepts for
# mem_limit/shm_size, so the same value can be used by both.
size_to_mib() {
  stm_in=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  case ${stm_in} in
    *b) stm_in=${stm_in%b} ;;
  esac
  case ${stm_in} in
    *p) stm_num=${stm_in%p}; stm_unit=p ;;
    *t) stm_num=${stm_in%t}; stm_unit=t ;;
    *g) stm_num=${stm_in%g}; stm_unit=g ;;
    *m) stm_num=${stm_in%m}; stm_unit=m ;;
    *k) stm_num=${stm_in%k}; stm_unit=k ;;
    *)  stm_num=${stm_in};  stm_unit=b ;;
  esac
  case ${stm_num} in
    ''|*[!0-9]*) return 1 ;;
  esac
  stm_num=$(decimal_number "$stm_num")
  # Bound the input before multiplication, which can otherwise wrap to a plausible
  # positive number. The maximum supported budget is 4 TiB.
  case ${stm_unit} in
    p) stm_max=0 ;; t) stm_max=4 ;; g) stm_max=4096 ;; m) stm_max=4194304 ;;
    k) stm_max=4294967296 ;; b) stm_max=4398046511104 ;;
  esac
  if [ "${#stm_num}" -gt "${#stm_max}" ] || [ "$stm_num" -gt "$stm_max" ]; then
    return 1
  fi
  case ${stm_unit} in
    p) stm_mib=$(( stm_num * 1073741824 )) ;;
    t) stm_mib=$(( stm_num * 1048576 )) ;;
    g) stm_mib=$(( stm_num * 1024 )) ;;
    m) stm_mib=$(( stm_num )) ;;
    k) stm_mib=$(( (stm_num + 1023) / 1024 )) ;;
    b) stm_mib=$(( (stm_num + 1048575) / 1048576 )) ;;
  esac
  # A negative result means the value wrapped, and 4 TiB is beyond anything this stack
  # should be asked to size against. Either way the value is unusable.
  case ${stm_mib} in
    -*) return 1 ;;
  esac
  if [ "$stm_mib" -gt 4194304 ]; then
    return 1
  fi
  printf '%s\n' "$stm_mib"
}

# clamp VALUE MIN MAX -> stdout
clamp() {
  cl_val=$1
  if [ "$cl_val" -lt "$2" ]; then
    cl_val=$2
  fi
  if [ "$cl_val" -gt "$3" ]; then
    cl_val=$3
  fi
  printf '%s\n' "$cl_val"
}

# Number of CPUs in a cpuset list such as "0-3,8". Prints 0 when nothing parses.
count_cpuset() {
  cc_total=0
  cc_old_ifs=$IFS
  IFS=,
  for cc_part in $1; do
    case ${cc_part} in
      *-*)
        cc_lo=${cc_part%-*}
        cc_hi=${cc_part#*-}
        case ${cc_lo} in ''|*[!0-9]*) continue ;; esac
        case ${cc_hi} in ''|*[!0-9]*) continue ;; esac
        cc_lo=$(decimal_number "$cc_lo")
        cc_hi=$(decimal_number "$cc_hi")
        [ "$cc_hi" -ge "$cc_lo" ] || continue
        cc_total=$(( cc_total + cc_hi - cc_lo + 1 ))
        ;;
      ''|*[!0-9]*) ;;
      *) cc_total=$(( cc_total + 1 )) ;;
    esac
  done
  IFS=$cc_old_ifs
  printf '%s\n' "$cc_total"
}

# The image's own entrypoint. Everything else (initdb, pg_hba.conf, initdb.d) depends on
# it, so this is resolved explicitly rather than assumed.
find_entrypoint() {
  if command -v docker-entrypoint.sh >/dev/null 2>&1; then
    command -v docker-entrypoint.sh
    return 0
  fi
  if [ -x /usr/local/bin/docker-entrypoint.sh ]; then
    printf '%s\n' /usr/local/bin/docker-entrypoint.sh
    return 0
  fi
  return 1
}

# --- detection --------------------------------------------------------------

# Ceiling for the guess made when nothing declares this container's memory: a nested
# container's /proc/meminfo reports the physical host, so that guess is not trusted beyond a
# size this stack could plausibly want. Declaring POSTGRES_MEMORY_LIMIT is how you go bigger.
FALLBACK_CEILING_MIB=4096

# Sets MEM_MIB and MEM_SOURCE.
detect_memory() {
  MEM_MIB=0
  MEM_SOURCE=

  if [ -n "${POSTGRES_MEMORY_LIMIT:-}" ]; then
    if dm_mib=$(size_to_mib "$POSTGRES_MEMORY_LIMIT"); then
      if [ "$dm_mib" -gt 0 ]; then
        MEM_MIB=$dm_mib
        MEM_SOURCE="POSTGRES_MEMORY_LIMIT=${POSTGRES_MEMORY_LIMIT}"
        return 0
      fi
    else
      warn "POSTGRES_MEMORY_LIMIT='${POSTGRES_MEMORY_LIMIT}' is not a size (use 2g, 512mb or a byte count); ignoring it"
    fi
  fi

  dm_value=$(first_line /sys/fs/cgroup/memory.max)
  if [ -n "$dm_value" ] && [ "$dm_value" != max ]; then
    if dm_mib=$(size_to_mib "$dm_value"); then
      if [ "$dm_mib" -gt 0 ]; then
        MEM_MIB=$dm_mib
        MEM_SOURCE='cgroup v2 memory.max'
        return 0
      fi
    fi
  fi

  dm_value=$(first_line /sys/fs/cgroup/memory/memory.limit_in_bytes)
  if [ -n "$dm_value" ]; then
    if dm_mib=$(size_to_mib "$dm_value"); then
      # cgroup v1 spells "unlimited" as a value near the top of the address space.
      if [ "$dm_mib" -gt 0 ] && [ "$dm_mib" -lt 1048576 ]; then
        MEM_MIB=$dm_mib
        MEM_SOURCE='cgroup v1 memory.limit_in_bytes'
        return 0
      fi
    fi
  fi

  dm_share=${POSTGRES_HOST_MEMORY_SHARE:-50}
  case ${dm_share} in
    ''|*[!0-9]*)
      warn "POSTGRES_HOST_MEMORY_SHARE='${dm_share}' is not a whole number; using 50"
      dm_share=50
      ;;
  esac
  dm_share=$(decimal_number "$dm_share")
  if [ "${#dm_share}" -gt 3 ] || [ "$dm_share" -lt 1 ] || [ "$dm_share" -gt 100 ]; then
    warn "POSTGRES_HOST_MEMORY_SHARE=${dm_share} is outside 1..100; using 50"
    dm_share=50
  fi

  dm_total_kb=$(awk '/^MemTotal:/ { print $2; exit }' /proc/meminfo 2>/dev/null || true)
  case ${dm_total_kb:-} in
    ''|*[!0-9]*) dm_total_kb=0 ;;
  esac
  dm_total_kb=$(decimal_number "$dm_total_kb")
  if [ "$dm_total_kb" -gt 0 ]; then
    # Multiply before dividing so a small host share does not lose precision.
    dm_guess=$(( dm_total_kb * dm_share / 100 / 1024 ))
    if [ "$dm_guess" -gt 0 ]; then
      if [ "$dm_guess" -gt "$FALLBACK_CEILING_MIB" ]; then
        MEM_MIB=$FALLBACK_CEILING_MIB
        MEM_SOURCE="MemTotal ${dm_share}% capped at ${FALLBACK_CEILING_MIB} MiB (no limit declared)"
        warn "no container memory limit is set, and /proc/meminfo reports ${dm_guess} MiB (${dm_share}% of MemTotal). In a nested container MemTotal is usually the host's memory rather than this container's, so the budget is capped at ${FALLBACK_CEILING_MIB} MiB. Set POSTGRES_MEMORY_LIMIT to this container's real share to size for more."
      else
        MEM_MIB=$dm_guess
        MEM_SOURCE="MemTotal ${dm_share}% (no container limit declared)"
        warn "no container memory limit is set, so the budget is ${dm_share}% of /proc/meminfo MemTotal (${MEM_MIB} MiB). On an LXC or nested-container host that figure can be the physical machine's; set POSTGRES_MEMORY_LIMIT if it is larger than this container should use."
      fi
      return 0
    fi
  fi

  MEM_MIB=0
  MEM_SOURCE='none'
  return 1
}

# Apply the tightest applicable quota, affinity, or explicit ceiling.
limit_cpu_count() {
  if [ "$CPU_COUNT" -eq 0 ] || [ "$1" -lt "$CPU_COUNT" ]; then
    CPU_COUNT=$1
    CPU_SOURCE=$2
  fi
}

# Sets CPU_COUNT and CPU_SOURCE. Always yields at least 1.
detect_cpus() {
  CPU_COUNT=0
  CPU_SOURCE=

  dc_limit=${POSTGRES_CPU_LIMIT:-}
  case ${dc_limit} in
    ''|0|0.0|0.00) dc_limit= ;;
    *[!0-9.]*|*.*.*|.*|*.)
      warn "POSTGRES_CPU_LIMIT='${dc_limit}' is not a CPU count (use 2 or 1.5); ignoring it"
      dc_limit=
      ;;
  esac
  if [ -n "$dc_limit" ]; then
    dc_whole=${dc_limit%%.*}
    dc_frac=
    case ${dc_limit} in
      *.*) dc_frac=${dc_limit#*.} ;;
    esac
    case ${dc_whole:-} in ''|*[!0-9]*) dc_whole=0 ;; esac
    # Note the empty default: "${dc_frac:-0}" would never match the empty branch below,
    # leaving dc_frac unset and making the numeric tests below fail.
    case ${dc_frac:-} in ''|*[!0-9]*) dc_frac=0 ;; esac
    dc_whole=$(decimal_number "$dc_whole")
    dc_frac=$(decimal_number "$dc_frac")
    if [ "${#dc_whole}" -le 9 ] && { [ "$dc_whole" -gt 0 ] || [ "$dc_frac" != 0 ]; }; then
      CPU_COUNT=$dc_whole
      if [ "$dc_frac" != 0 ]; then
        CPU_COUNT=$(( CPU_COUNT + 1 ))
      fi
      CPU_SOURCE="POSTGRES_CPU_LIMIT=${dc_limit}"
    elif [ "$dc_whole" != 0 ] || [ "$dc_frac" != 0 ]; then
      warn "POSTGRES_CPU_LIMIT='${dc_limit}' is not a CPU count (use 2 or 1.5); ignoring it"
    fi
  fi

  dc_value=$(first_line /sys/fs/cgroup/cpu.max)
  if [ -n "$dc_value" ]; then
    dc_quota=${dc_value% *}
    dc_period=${dc_value#* }
    case ${dc_quota} in ''|*[!0-9]*) dc_quota=0 ;; esac
    case ${dc_period} in ''|*[!0-9]*) dc_period=0 ;; esac
    dc_quota=$(decimal_number "$dc_quota")
    dc_period=$(decimal_number "$dc_period")
    if [ "$dc_quota" -gt 0 ] && [ "$dc_period" -gt 0 ]; then
      limit_cpu_count $(( (dc_quota + dc_period - 1) / dc_period )) 'cgroup v2 cpu.max'
    fi
  fi

  dc_quota=$(first_line /sys/fs/cgroup/cpu/cpu.cfs_quota_us)
  dc_period=$(first_line /sys/fs/cgroup/cpu/cpu.cfs_period_us)
  case ${dc_quota:-} in ''|*[!0-9]*) dc_quota=0 ;; esac
  case ${dc_period:-} in ''|*[!0-9]*) dc_period=0 ;; esac
  dc_quota=$(decimal_number "$dc_quota")
  dc_period=$(decimal_number "$dc_period")
  if [ "$dc_quota" -gt 0 ] && [ "$dc_period" -gt 0 ]; then
    limit_cpu_count $(( (dc_quota + dc_period - 1) / dc_period )) 'cgroup v1 cpu.cfs_quota_us'
  fi

  for dc_file in /sys/fs/cgroup/cpuset.cpus.effective /sys/fs/cgroup/cpuset/cpuset.cpus; do
    dc_value=$(first_line "$dc_file")
    if [ -n "$dc_value" ]; then
      dc_count=$(count_cpuset "$dc_value")
      if [ "$dc_count" -gt 0 ]; then
        limit_cpu_count "$dc_count" "$dc_file"
      fi
    fi
  done

  dc_count=$( (command -v nproc >/dev/null 2>&1 && nproc) || getconf _NPROCESSORS_ONLN 2>/dev/null || printf '1' )
  case ${dc_count:-} in ''|*[!0-9]*) dc_count=1 ;; esac
  dc_count=$(decimal_number "$dc_count")
  if [ "$dc_count" -lt 1 ]; then
    dc_count=1
  fi
  limit_cpu_count "$dc_count" 'nproc (available CPUs)'
  return 0
}

# --- derivation -------------------------------------------------------------

# Sets MAX_CONNS from POSTGRES_MAX_CONNECTIONS.
resolve_max_connections() {
  rm_raw=${POSTGRES_MAX_CONNECTIONS:-100}
  case ${rm_raw} in
    ''|*[!0-9]*)
      warn "POSTGRES_MAX_CONNECTIONS='${rm_raw}' is not a whole number; using 100"
      rm_raw=100
      ;;
  esac
  rm_raw=$(decimal_number "$rm_raw")
  rm_bounded=$rm_raw
  [ "${#rm_bounded}" -le 4 ] || rm_bounded=1000
  MAX_CONNS=$(clamp "$rm_bounded" 10 1000)
  if [ "$MAX_CONNS" != "$rm_raw" ]; then
    warn "POSTGRES_MAX_CONNECTIONS=${rm_raw} is outside 10..1000; using ${MAX_CONNS}"
  fi
}

# Derives every setting and appends the -c arguments to TUNE_ARGS.
compute_settings() {
  # The fixed 128 MiB buffer floor needs headroom for other PostgreSQL allocations.
  [ "$MEM_MIB" -ge 512 ] || die "${MEM_MIB} MiB memory budget is below the supported 512 MiB minimum; increase the container limit or disable automatic tuning"
  SB_MIB=$(clamp $(( MEM_MIB / 4 )) 128 8192)
  ECS_MIB=$(clamp $(( MEM_MIB * 3 / 4 )) "$SB_MIB" 16384)
  MWM_MIB=$(clamp $(( MEM_MIB / 16 )) 64 2048)
  WM_KB=$(clamp $(( MEM_MIB * 1024 / (3 * MAX_CONNS) )) 1024 65536)
  WB_MIB=$(clamp $(( SB_MIB / 32 )) 1 16)
  MAX_WAL_MIB=$(clamp $(( MEM_MIB / 8 )) 1024 8192)
  MIN_WAL_MIB=$(clamp $(( MAX_WAL_MIB / 4 )) 256 2048)

  MWP=$(clamp "$CPU_COUNT" 2 16)
  MPW=$(clamp "$CPU_COUNT" 2 16)
  MPWG=$(clamp $(( CPU_COUNT / 2 )) 1 "$MPW")
  MPMW=$(clamp $(( CPU_COUNT / 2 )) 1 "$MPW")

  log "detected ${MEM_MIB} MiB memory (from ${MEM_SOURCE}) and ${CPU_COUNT} CPU(s) (from ${CPU_SOURCE})"

  add_setting max_connections "$MAX_CONNS"
  show 'max_connections' "${MAX_CONNS} (POSTGRES_MAX_CONNECTIONS, not resource-derived)"
  add_setting shared_buffers "${SB_MIB}MB"
  show 'shared_buffers' "${SB_MIB}MB (budget / 4, clamped to 128MB..8192MB)"
  add_setting effective_cache_size "${ECS_MIB}MB"
  show 'effective_cache_size' "${ECS_MIB}MB (budget * 3 / 4)"
  add_setting maintenance_work_mem "${MWM_MIB}MB"
  show 'maintenance_work_mem' "${MWM_MIB}MB (budget / 16, clamped to 64MB..2048MB)"
  add_setting work_mem "${WM_KB}kB"
  show 'work_mem' "${WM_KB}kB (budget / (3 * max_connections), clamped to 1MB..64MB)"
  add_setting wal_buffers "${WB_MIB}MB"
  show 'wal_buffers' "${WB_MIB}MB (shared_buffers / 32, clamped to 1MB..16MB)"
  add_setting min_wal_size "${MIN_WAL_MIB}MB"
  show 'min_wal_size' "${MIN_WAL_MIB}MB (max_wal_size / 4)"
  add_setting max_wal_size "${MAX_WAL_MIB}MB"
  show 'max_wal_size' "${MAX_WAL_MIB}MB (budget / 8, clamped to 1024MB..8192MB)"
  add_setting max_worker_processes "$MWP"
  show 'max_worker_processes' "${MWP} (CPUs, clamped to 2..16)"
  add_setting max_parallel_workers "$MPW"
  show 'max_parallel_workers' "${MPW} (CPUs, clamped to 2..16)"
  add_setting max_parallel_workers_per_gather "$MPWG"
  show 'max_parallel_workers_per_gather' "${MPWG} (CPUs / 2)"
  add_setting max_parallel_maintenance_workers "$MPMW"
  show 'max_parallel_maintenance_workers' "${MPMW} (CPUs / 2)"

  # Storage and workload assumptions rather than machine size, so they stay fixed.
  add_setting checkpoint_completion_target 0.9
  add_setting default_statistics_target 100
  add_setting random_page_cost 1.1
  add_setting effective_io_concurrency 200
  add_setting huge_pages off
  log 'kept fixed: checkpoint_completion_target=0.9 default_statistics_target=100 random_page_cost=1.1 effective_io_concurrency=200 huge_pages=off'

  check_shared_memory "$MPWG" "$WM_KB"
}

# Parallel queries carve segments out of /dev/shm, which Compose fixes at container
# creation (shm_size), so it cannot be derived here. Warn when the derived worker counts
# could ask for more than is available. Everything is allocated lazily, so a generous
# shm_size costs nothing until it is used.
check_shared_memory() {
  csm_gather=$1
  csm_work_kb=$2
  if [ "${print_only:-0}" = 1 ]; then
    csm_available=$SHM_MIB
  else
    csm_available=$(df -m /dev/shm 2>/dev/null | awk '$NF == "/dev/shm" { print $2; exit }' || true)
  fi
  case ${csm_available:-} in
    ''|*[!0-9]*) return 0 ;;
  esac
  csm_needed=$(( csm_gather * (csm_work_kb / 1024 + 1) * 2 ))
  if [ "$csm_available" -lt "$csm_needed" ]; then
    warn "/dev/shm is ${csm_available} MiB but the derived settings can ask for roughly ${csm_needed} MiB; raise POSTGRES_SHM_SIZE if queries fail with 'could not resize shared memory segment'"
  fi
}

# --- argument assembly ------------------------------------------------------

append_arg() {
  TUNE_ARGS="${TUNE_ARGS}${TUNE_ARGS:+ }$1"
}

add_setting() {
  append_arg -c
  append_arg "$1=$2"
}

# Resolve modes without changing existing installations that omit the new selector.
resolve_mode() {
  TUNE_MODE=${POSTGRES_TUNE_MODE:-opencw}
  case $TUNE_MODE in opencw|pgtune|off) ;; *) die 'POSTGRES_TUNE_MODE must be opencw, pgtune or off' ;; esac
  case ${POSTGRES_TUNE_DISABLE:-0} in
    0|false|'') ;;
    1|true)
      case ${POSTGRES_TUNE_MODE:-off} in off|'') ;; *) die 'POSTGRES_TUNE_DISABLE conflicts with POSTGRES_TUNE_MODE; select off instead' ;; esac
      TUNE_MODE=off ;;
    *) die 'POSTGRES_TUNE_DISABLE must be 0 or 1' ;;
  esac
  if [ "$TUNE_MODE" = pgtune ]; then
    MEM_MIB=$(size_to_mib "${POSTGRES_MEMORY_LIMIT:-}") || die 'PGTune requires POSTGRES_MEMORY_LIMIT, for example 2g'
    [ "$MEM_MIB" -ge 512 ] || die 'PGTune requires a database RAM budget of at least 512 MiB'
    MEM_SOURCE="POSTGRES_MEMORY_LIMIT=${POSTGRES_MEMORY_LIMIT}"
    case ${POSTGRES_CPU_LIMIT:-0} in
      *[!0-9.]*|*.*.*|.*|*.) die 'POSTGRES_CPU_LIMIT must be a CPU count such as 2 or 1.5' ;;
    esac
    rm_cpu_input=${POSTGRES_CPU_LIMIT:-0}
    rm_cpu=$(decimal_number "${rm_cpu_input%%.*}") || die 'POSTGRES_CPU_LIMIT must be a CPU count such as 2 or 1.5'
    [ "${#rm_cpu}" -le 9 ] || die 'POSTGRES_CPU_LIMIT is too large'
  fi
}

resolve_shm() {
  if [ -n "${POSTGRES_SHM_SIZE:-}" ]; then
    SHM_MIB=$(size_to_mib "$POSTGRES_SHM_SIZE") || die 'POSTGRES_SHM_SIZE must be a byte size'
    [ "$SHM_MIB" -gt 0 ] || die 'POSTGRES_SHM_SIZE must be greater than zero'
    SHM_SIZE=$POSTGRES_SHM_SIZE
  elif [ "$TUNE_MODE" = pgtune ]; then
    SHM_MIB=$(clamp $(( MEM_MIB / 8 )) 64 2048)
    SHM_SIZE="${SHM_MIB}m"
  else
    SHM_MIB=2048
    SHM_SIZE=2gb
  fi
}

# --- main -------------------------------------------------------------------

TUNE_ARGS=
print_only=0
shm_only=0

for arg in "$@"; do
  case ${arg} in
    --print) print_only=1 ;;
    --shm) shm_only=1 ;;
    --help|-h)
      printf 'usage: %s [--print|--shm] [postgres arguments...]\n' "$0"
      exit 0
      ;;
  esac
done

resolve_mode
resolve_shm
if [ "$shm_only" = 1 ]; then printf '%s\n' "$SHM_SIZE"; exit 0; fi
log "mode: ${TUNE_MODE}; Docker /dev/shm capacity: ${SHM_SIZE}"
if [ "$TUNE_MODE" = off ]; then
  log 'derived settings disabled; using the image defaults'
elif [ "$TUNE_MODE" = pgtune ]; then
  detect_cpus
  . "$(dirname -- "$0")/pgtune.sh"
  compute_pgtune_settings
  check_shared_memory "$MPWG" "$WM_KB"
else
  if detect_memory; then
    detect_cpus
    resolve_max_connections
    compute_settings
  else
    warn 'could not determine how much memory this container has; using the image defaults'
  fi
fi

if [ -n "${POSTGRES_TUNE_EXTRA:-}" ]; then
  log "appending POSTGRES_TUNE_EXTRA: ${POSTGRES_TUNE_EXTRA}"
  append_arg "$POSTGRES_TUNE_EXTRA"
fi

# TUNE_ARGS is a space-separated argument string, split into separate arguments for
# --print and exec below. Every value in it is generated here (or comes from
# POSTGRES_TUNE_EXTRA), never from a filename, so splitting it is the intent and
# globbing must stay off.
set -f

if [ "$print_only" = 1 ]; then
  printf '%s\n' "$TUNE_ARGS"
  exit 0
fi

ENTRYPOINT=$(find_entrypoint) ||
  die 'cannot find docker-entrypoint.sh; refusing to start PostgreSQL without the image initialisation it performs'

# Word splitting TUNE_ARGS is intended: it holds a list of arguments, not one value.
# shellcheck disable=SC2086
exec "$ENTRYPOINT" "$@" $TUNE_ARGS
