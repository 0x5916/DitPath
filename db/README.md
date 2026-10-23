# PostgreSQL resource tuning

[tune.sh](tune.sh) is the database container entrypoint in both Compose stacks. It detects memory and CPU budgets, logs derived settings, then calls the image's original entrypoint with PostgreSQL `-c` arguments. It leaves initialization and cluster files to that entrypoint. The script is POSIX sh and uses tools supplied by the image.

Configuration defaults live in [example.env](../example.env); deployment steps live in [DEPLOYMENT.md](../DEPLOYMENT.md#postgresql-resource-tuning). Validate values with `make check` before recreating the container.

## Choose a calculator

New installations select `POSTGRES_TUNE_MODE=pgtune` in the template. Set `POSTGRES_MEMORY_LIMIT` to the RAM allocated to PostgreSQL alone, not total LXC RAM; leave other tuning lines commented. Remove the leading `#` from an optional line to enable its value (`//` is not an environment-file comment).

| Mode     | Behavior                                                                                   |
| -------- | ------------------------------------------------------------------------------------------ |
| `pgtune` | Local PGTune calculations; web workload, Linux, PostgreSQL 18, SSD, and `mid_ram` defaults |
| `opencw` | Legacy web/OLTP calculator; also selected when the mode is absent                 |
| `off`    | Image defaults without derived settings; explicit extra arguments still apply              |

[pgtune.sh](pgtune.sh) ports [PGTune at revision `171f129`](https://github.com/le0pard/pgtune/blob/171f1295abd64ec022c7313725db03a191a77db8/src/features/configuration/configurationSlice.js); its [MIT license](PGTUNE-LICENSE) is retained. It runs locally without contacting the website or installing packages. For LXC compatibility, it reports adjustments to `io_method=worker`, `huge_pages=off`, and `wal_compression=pglz`; inspect the preview for the settings applied to your budget. The previous calculator's formulas remain documented below.

```bash
make tune
scripts/tune.sh --env-file /opt/opencw/.env
```

The preview validates tuning inputs and prints the selected budget, assumptions, settings, shared-memory capacity, and compatibility adjustments without Docker or database changes. Tuning values must be literal; `$` interpolation is rejected. It uses host CPU detection; the running database can observe tighter Docker/cgroup limits. Set `POSTGRES_CPU_LIMIT` for an explicit CPU ceiling.

## Budget detection

PGTune mode requires a declared, nonzero `POSTGRES_MEMORY_LIMIT`. `opencw` mode uses the first valid source: that explicit limit, cgroup v2 `memory.max`, cgroup v1 `memory.limit_in_bytes`, then `POSTGRES_HOST_MEMORY_SHARE` percent of `/proc/meminfo` memory, capped at 4 GiB. Automatic tuning requires a memory budget of at least 512 MiB; smaller budgets fail before PostgreSQL starts. Leading zeros in numeric values are decimal. The default host share is 50%; it applies only to the `opencw` fallback, not to declared or cgroup limits.

CPU detection takes the minimum of applicable `POSTGRES_CPU_LIMIT`, cgroup v2/v1 quotas, effective cpuset, and available CPU count. Fractional CPU quotas round up for worker sizing. `0` for either explicit limit means unlimited in Compose. Explicit limits also set Docker's `mem_limit` and `cpus`.

On LXC or nested containers, `/proc/meminfo` can report physical-host memory and cgroup detection may miss the outer limit. Declare the database's share explicitly instead of relying on the capped fallback. For example, a 4 GiB host sharing resources with this stack could allocate:

```dotenv
POSTGRES_MEMORY_LIMIT=3g
POSTGRES_CPU_LIMIT=4
```

## Legacy `opencw` calculations

Let `B` be the memory budget in MiB and `C` the clamped connection ceiling. Integer arithmetic and floors are defined in [tune.sh](tune.sh).

| Setting                                     | Formula                                 | Clamp                     |
| ------------------------------------------- | --------------------------------------- | ------------------------- |
| `shared_buffers`                            | `B / 4`                                 | 128 MiB–8 GiB             |
| `effective_cache_size`                      | `3B / 4`                                | `shared_buffers`–16 GiB   |
| `maintenance_work_mem`                      | `B / 16`                                | 64 MiB–2 GiB              |
| `work_mem`                                  | `B / (3C)`, expressed in KiB            | 1–64 MiB                  |
| `wal_buffers`                               | `shared_buffers / 32`                   | 1–16 MiB                  |
| `max_wal_size`, `min_wal_size`              | `B / 8`, then maximum WAL size / 4      | 1–8 GiB and 256 MiB–2 GiB |
| `max_connections`                           | `POSTGRES_MAX_CONNECTIONS`, default 100 | 10–1000                   |
| Worker process and parallel worker ceilings | CPU count                               | 2–16                      |
| Gather and maintenance parallel workers     | Half the CPU count                      | 1–parallel worker ceiling |

The script also supplies fixed `checkpoint_completion_target=0.9`, `default_statistics_target=100`, `random_page_cost=1.1`, `effective_io_concurrency=200`, and `huge_pages=off`. Disk and query characteristics can require overrides; these fixed values do not scale with the resource budget.

## Overrides and shared memory

| Variable                                      | Effect                                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_MEMORY_LIMIT`, `POSTGRES_CPU_LIMIT` | Explicit budget and enforced container ceilings                                                                                                                                                                   |
| `POSTGRES_TUNE_PROFILE`                       | `web` (default), `oltp`, `dw`, `desktop`, or `mixed`                                                                                                                                                              |
| `POSTGRES_TUNE_STORAGE`                       | `ssd` (default), `hdd`, `san`, or `nvme`                                                                                                                                                                          |
| `POSTGRES_TUNE_DB_SIZE`                       | `mid_ram` (default), `less_ram`, or `greater_ram`, describing data size relative to RAM                                                                                                                           |
| `POSTGRES_SHM_SIZE`                           | Explicit Docker shared-memory capacity; overrides the calculated size                                                                                                                                             |
| `POSTGRES_MAX_CONNECTIONS`                    | PGTune: at least 4, with an upper ceiling reserving PostgreSQL 18 worker slots; preview reports the ceiling computed by [pgtune.sh](pgtune.sh). Defaults: 200 for PGTune web, 100 for `opencw` (clamped to 10–1000) |
| `POSTGRES_HOST_MEMORY_SHARE`                  | Host fallback percentage, 1–100                                                                                                                                                                                   |
| `POSTGRES_TUNE_EXTRA`                         | Extra server arguments appended last, such as `-c work_mem=8MB`                                                                                                                                                   |
| `POSTGRES_TUNE_DISABLE=1`                     | Legacy image-default selection when mode is absent or `off`; conflicts with explicit `pgtune`/`opencw`                                                                                                            |

Prefer adjusting the budget when several settings should scale together. Docker's [`shm_size`](https://docs.docker.com/reference/compose-file/services/#shm_size) controls `/dev/shm`, separate from PostgreSQL's `shared_buffers`. In PGTune mode, the operational scripts calculate capacity as RAM / 8, bounded to 64 MiB–2 GiB, before creating the container. This is a OpenCW policy, not a PGTune formula; a 2-GiB budget gives 256 MiB. An enabled `POSTGRES_SHM_SIZE` overrides it; `opencw`/`off` modes retain the 2-GiB fallback when omitted. Keep shared memory below the container memory limit: allocated `/dev/shm` counts toward it. Keep the connection ceiling above the backend pool plus administration and backup connections.

Command-line settings override configuration-file values, including `ALTER SYSTEM`. Persistent overrides belong in the environment, not edits to `PGDATA`. Apply changes with `make deploy`/`make update`; a plain restart does not reload Compose configuration. Direct Compose commands use the static `2gb` shared-memory fallback unless a size is explicitly supplied: after reviewing a 256-MiB preview, for example, `POSTGRES_SHM_SIZE=256mb docker compose up -d db` recreates just the database with that capacity. Invalid inputs fail validation; a missing image entrypoint is fatal.

## Inspect and troubleshoot

```bash
docker compose logs db
docker compose exec db sh -c 'sh /usr/local/bin/opencw-pg-tune.sh --print'
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SHOW shared_buffers"'
```

`--print` recomputes proposed settings without restarting the server; SQL reports the active setting. In the backend development stack the database container still exposes `POSTGRES_USER` and `POSTGRES_DB`, even though its Compose inputs are named `DB_USER` and `DB_NAME`.

If the fallback budget is unexpectedly small or large, declare limits. If parallel queries cannot resize a shared-memory segment, adjust `POSTGRES_SHM_SIZE` and worker counts. For too many clients, compare `POSTGRES_MAX_CONNECTIONS` with pool demand. A missing `docker-entrypoint.sh` error requires checking the [Compose mount](../docker-compose.yaml) and tuner file. A port-allocation error concerns `DB_PORT`, not resource tuning. The tuner never writes PostgreSQL data files; changing a budget does not upgrade or migrate a cluster.
