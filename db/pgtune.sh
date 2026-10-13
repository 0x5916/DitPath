#!/bin/sh
# POSIX port of PGTune's PostgreSQL 18/Linux calculations, pinned to:
# https://github.com/le0pard/pgtune/blob/171f1295abd64ec022c7313725db03a191a77db8/src/features/configuration/configurationSlice.js
# Copyright (c) 2014 Oleksii Vasyliev. MIT license: PGTUNE-LICENSE.
# Sourced by tune.sh; uses its add_setting/show/log/die helpers.

pgtune_setting() {
  add_setting "$1" "$2"
  show "$1" "$2"
}

# Preserve upstream's whole-kB rounding when RAM is not divisible by 16 MiB.
pgtune_memory_setting() {
  if [ $(( $2 % 1024 )) -eq 0 ]; then
    pgtune_setting "$1" "$(( $2 / 1024 ))MB"
  else
    pgtune_setting "$1" "${2}kB"
  fi
}

compute_pgtune_settings() {
  [ "$MEM_MIB" -ge 512 ] || die "${MEM_MIB} MiB memory budget is below the supported 512 MiB minimum"
  pg_profile=${POSTGRES_TUNE_PROFILE:-web}
  pg_storage=${POSTGRES_TUNE_STORAGE:-ssd}
  pg_size=${POSTGRES_TUNE_DB_SIZE:-mid_ram}
  pg_divisor=4; pg_maintenance_divisor=16; pg_work_divisor=1; pg_stats=100
  case "$pg_profile" in
    web) MAX_CONNS=200; MIN_WAL_MIB=1024; MAX_WAL_MIB=4096 ;;
    oltp) MAX_CONNS=300; MIN_WAL_MIB=2048; MAX_WAL_MIB=8192 ;;
    dw) MAX_CONNS=40; MIN_WAL_MIB=4096; MAX_WAL_MIB=16384
        pg_maintenance_divisor=8; pg_work_divisor=2; pg_stats=500 ;;
    desktop) MAX_CONNS=20; MIN_WAL_MIB=100; MAX_WAL_MIB=2048
             pg_divisor=16; pg_work_divisor=6 ;;
    mixed) MAX_CONNS=100; MIN_WAL_MIB=1024; MAX_WAL_MIB=4096; pg_work_divisor=2 ;;
    *) die "POSTGRES_TUNE_PROFILE must be web, oltp, dw, desktop or mixed" ;;
  esac
  case "$pg_storage" in
    ssd) pg_io=200 ;; hdd) pg_io=2 ;; san) pg_io=300 ;; nvme) pg_io=1000 ;;
    *) die "POSTGRES_TUNE_STORAGE must be ssd, hdd, san or nvme" ;;
  esac
  case "$pg_size" in
    less_ram|mid_ram|greater_ram) ;;
    *) die "POSTGRES_TUNE_DB_SIZE must be less_ram, mid_ram or greater_ram" ;;
  esac
  if [ -n "${POSTGRES_MAX_CONNECTIONS:-}" ]; then
    pg_connections=$POSTGRES_MAX_CONNECTIONS
    case "$pg_connections" in
      *[!0-9]*) die 'POSTGRES_MAX_CONNECTIONS must be a positive integer' ;;
    esac
    while [ "${pg_connections#0}" != "$pg_connections" ]; do pg_connections=${pg_connections#0}; done
    pg_connections=${pg_connections:-0}
    [ "${#pg_connections}" -le 6 ] && [ "$pg_connections" -ge 4 ] && [ "$pg_connections" -le 262143 ] ||
      die 'POSTGRES_MAX_CONNECTIONS must be in 4..262143 (three PostgreSQL reserved connections)'
    MAX_CONNS=$pg_connections
  fi

  pg_ram_kb=$(( MEM_MIB * 1024 ))
  pg_sb_kb=$(( pg_ram_kb / pg_divisor ))
  pg_ecs_kb=$(( pg_ram_kb * 3 / 4 ))
  [ "$pg_profile" != desktop ] || pg_ecs_kb=$(( pg_ram_kb / 4 ))
  pg_mwm_kb=$(( pg_ram_kb / pg_maintenance_divisor ))
  [ "$pg_mwm_kb" -le 8388608 ] || pg_mwm_kb=8388608
  pg_wb_kb=$(( pg_sb_kb * 3 / 100 ))
  [ "$pg_wb_kb" -le 14336 ] || pg_wb_kb=16384
  [ "$pg_wb_kb" -ge 32 ] || pg_wb_kb=32
  SB_MIB=$(( pg_sb_kb / 1024 )); ECS_MIB=$(( pg_ecs_kb / 1024 ))
  MWM_MIB=$(( pg_mwm_kb / 1024 )); WB_MIB=$(( pg_wb_kb / 1024 ))

  # Below four CPUs upstream emits no parallel overrides. These effective PG18
  # defaults feed work_mem and the shared-memory warning, rather than CPU_COUNT.
  MWP=8; MPW=8; MPWG=2; MPMW=2
  if [ "$CPU_COUNT" -ge 4 ]; then
    MWP=$CPU_COUNT; MPW=$CPU_COUNT; MPWG=$(( (CPU_COUNT + 1) / 2 )); MPMW=$MPWG
    if [ "$pg_profile" != dw ] && [ "$MPWG" -gt 4 ]; then MPWG=4; fi
    [ "$MPMW" -le 4 ] || MPMW=4
  fi
  # PG18 InitializeMaxBackends checks the combined process budget, not only
  # max_connections. Reserve 16 autovacuum slots, two special workers and the
  # default ten WAL senders (desktop sets zero). I/O workers are auxiliary.
  # https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/init/postinit.c
  # https://github.com/postgres/postgres/blob/REL_18_STABLE/src/include/storage/proc.h
  pg_wal_senders=10
  [ "$pg_profile" != desktop ] || pg_wal_senders=0
  pg_connection_ceiling=$(( 262143 - 16 - MWP - pg_wal_senders - 2 ))
  [ "$MAX_CONNS" -le "$pg_connection_ceiling" ] ||
    die "POSTGRES_MAX_CONNECTIONS=${MAX_CONNS} exceeds the PG18 process budget; maximum ${pg_connection_ceiling} with ${MWP} workers, 16 autovacuum slots, ${pg_wal_senders} WAL senders and 2 special workers"
  log "DitPath validation: max_connections <= ${pg_connection_ceiling} for the PostgreSQL 18 process budget"
  WM_KB=$(( (pg_ram_kb - pg_sb_kb) / ((MAX_CONNS + MWP) * 3 * pg_work_divisor) ))
  case "$pg_size" in
    less_ram) WM_KB=$(( WM_KB * 13 / 10 )) ;;
    greater_ram) WM_KB=$(( WM_KB * 9 / 10 )) ;;
  esac
  [ "$WM_KB" -ge 4096 ] || WM_KB=4096
  pg_random_cost=1.1
  if [ "$pg_size" != less_ram ] && { [ "$pg_storage" = hdd ] || [ "$pg_profile" = dw ]; }; then
    pg_random_cost=4
  fi

  log "PGTune 171f1295: PostgreSQL 18/Linux, profile=${pg_profile}, storage=${pg_storage}, database=${pg_size}, RAM=${MEM_MIB} MiB, CPUs=${CPU_COUNT}"
  pgtune_setting max_connections "$MAX_CONNS"
  pgtune_memory_setting shared_buffers "$pg_sb_kb"
  pgtune_memory_setting effective_cache_size "$pg_ecs_kb"
  pgtune_memory_setting maintenance_work_mem "$pg_mwm_kb"
  pgtune_setting work_mem "${WM_KB}kB"
  pgtune_memory_setting wal_buffers "$pg_wb_kb"
  pgtune_setting min_wal_size "${MIN_WAL_MIB}MB"
  pgtune_setting max_wal_size "${MAX_WAL_MIB}MB"
  pgtune_setting checkpoint_completion_target 0.9
  pgtune_setting default_statistics_target "$pg_stats"
  pgtune_setting random_page_cost "$pg_random_cost"
  pgtune_setting effective_io_concurrency "$pg_io"
  if [ "$CPU_COUNT" -ge 4 ]; then
    pgtune_setting max_worker_processes "$MWP"
    pgtune_setting max_parallel_workers "$MPW"
    pgtune_setting max_parallel_workers_per_gather "$MPWG"
    pgtune_setting max_parallel_maintenance_workers "$MPMW"
  else
    log 'PGTune retains PostgreSQL parallel defaults below 4 CPUs (workers=8, gather=2, maintenance=2)'
  fi
  if [ "$pg_profile" = desktop ]; then
    pgtune_setting wal_level minimal
    pgtune_setting max_wal_senders 0
  fi
  case "$pg_profile" in web|oltp|mixed) pgtune_setting jit off ;; esac
  if [ "$CPU_COUNT" -ge 32 ]; then
    pgtune_setting autovacuum_max_workers 5
  elif [ "$CPU_COUNT" -ge 16 ]; then
    pgtune_setting autovacuum_max_workers 4
  fi
  [ "$pg_mwm_kb" -lt 2097152 ] || pgtune_setting autovacuum_work_mem 2048MB

  # Capability choices are explicit: nested LXC kernels and PostgreSQL builds
  # cannot be inferred from RAM/CPUs. All three values are portable on PG18.
  pgtune_setting io_method worker
  log 'compatibility adjustment: io_method=worker instead of PGTune io_uring (liburing and LXC kernel permissions are not assumed)'
  pg_io_workers=$(( CPU_COUNT / 4 ))
  [ "$pg_io_workers" -le 32 ] || pg_io_workers=32
  [ "$pg_io_workers" -le 3 ] || pgtune_setting io_workers "$pg_io_workers"
  pgtune_setting huge_pages off
  if [ "$pg_sb_kb" -ge 2097152 ]; then
    log 'compatibility adjustment: huge_pages=off instead of PGTune try (LXC huge-page allocation is not assumed)'
  fi
  pgtune_setting wal_compression pglz
  log 'compatibility adjustment: wal_compression=pglz instead of PGTune lz4 (optional build support is not assumed)'
}
