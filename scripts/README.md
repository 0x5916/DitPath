# Operational scripts

The root [Makefile](../Makefile) delegates deployment tasks to these Bash scripts. Run them on the Linux deployment host with Bash 4 or newer, Docker Compose v2, Git, gzip, GNU utilities, and curl or wget. The pgAdmin renderer uses Python already included in its image. OpenSSL supports initial JWT generation. The scripts resolve repository paths from their own location and always operate on the root stack.

[DEPLOYMENT.md](../DEPLOYMENT.md) owns installation, public access, credentials, and recovery. [example.env](../example.env) owns Compose configuration defaults; [db/README.md](../db/README.md) owns database tuning.

## Script reference

Every operational Bash script accepts `--help`. Options below supplement that help. Use `--dry-run` to inspect mutations before a deployment operation; read-only scripts reject it.

| Script and Make target        | Options                                                                                                                         | Behavior                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `check-env.sh` / `make check` | `--quiet`, `--env-file PATH`                                                                                                    | Validates required values, formats, and optional tuning values; reports all errors; no mutations                                |
| `tune.sh` / `make tune`       | `--env-file PATH`                                                                                                               | Previews database tuning and shared-memory capacity; no Docker or database changes                                              |
| `deploy.sh` / `make deploy`   | `--timeout SECONDS`, `--dry-run`, `--yes`                                                                                       | Bootstraps `.env`, optionally generates JWT secret, validates, builds/starts, verifies health                                   |
| `update.sh` / `make update`   | `--ref REF`, `--no-backup`, `--auto-rollback`, `--timeout SECONDS`, `--keep N`, `--dry-run`, `--yes`                            | Snapshots locally built images and database, changes revision, rebuilds, verifies; prints or performs image rollback on failure |
| `backup.sh` / `make backup`   | `--keep N`, `--dir PATH`, `--no-globals`, `--print-path`, `--dry-run`                                                           | Writes verified gzip plain-SQL dump and optional globals dump; rotates retained dumps; never prompts                            |
| `restore.sh` / `make restore` | Positional file or `--file PATH`, `--globals PATH`, `--no-globals`, `--append`, `--no-backup`, `--keep N`, `--dry-run`, `--yes` | Defaults to newest dump and replaces live database; accepts `.sql` and `.sql.gz`                                                |
| `status.sh` / `make status`   | `--skip-disk`                                                                                                                   | Reads environment, containers, endpoints, database readiness, release record, images, backups, and disk                         |

Timeout defaults to 240 seconds per service; retention defaults to 14 dumps. `--keep 0` disables pruning. Positive retention removes data dumps together with their companion globals; pinned recovery dumps can temporarily exceed the limit. Numeric options accept leading zeros as decimal and reject overflow. `backup.sh` rejects `--yes`; `check-env.sh` and `status.sh` reject both `--yes` and `--dry-run`. Make forwards its defined variables; use the script directly for options such as `--auto-rollback` that Make does not expose.

```bash
make check
make tune
scripts/tune.sh --env-file /opt/opencw/.env
make update DRY_RUN=1
scripts/update.sh --ref RELEASE --auto-rollback
scripts/backup.sh --dir /mnt/backups --keep 30
scripts/restore.sh --file backups/opencw_TIMESTAMP.sql.gz
scripts/status.sh --skip-disk
```

The shared [pgAdmin renderer](render-pgadmin.py) runs inside `pgadmin-config` in both stacks. It uses the image's Python runtime to publish valid JSON and a private per-login passfile; no host Python installation is required for deployment.

## Safety and exit behavior

The environment parser reads values without sourcing shell code. Dry-run prints mutating commands; read-only validation and prerequisites can still fail. `tune.sh` needs only tuning inputs; credentials and Docker are not required. It rejects `--dry-run`/`--yes` because it never mutates state. Deploy/update refuse success if database/backend/frontend/pgAdmin container checks or backend/frontend HTTP probes fail; pgAdmin HTTP failure warns. Status additionally fails for a missing/unhealthy pgAdmin container or invalid environment. Cloudflared issues and old/missing backups warn without changing its exit status. Success exits 0; validation or operational failure exits nonzero.

Update refuses a dirty tracked working tree, requires an upstream for the current branch unless `--ref` is given, and aborts if its pre-update backup fails. It records the previous revision/branch and tags locally built images. An explicit branch ref fast-forwards to its fetched upstream (or `origin/BRANCH`); divergent history is rejected. Tags and commits use detached HEAD. Automatic rollback aborts failed image retags, verifies running image IDs and health, and leaves detached HEAD; it does not reverse GORM startup migrations. Restore the pre-update database dump when schema recovery is needed. Avoid `--no-backup` unless the loss of that safeguard is deliberate.

Restore normally requires typing the target database name; `--yes` or `ASSUME_YES=1` bypasses prompts. It stages and decompresses both inputs before confirmation, confirms the running container's database name, and takes a pinned recovery backup before database recreation. Pruning runs after successful verification. On failure the pin protects recovery from scheduled retention; remove the reported `.restore-pin` marker only after recovery. The data load into the recreated database uses `ON_ERROR_STOP` and one transaction, but the old database has already been dropped. `--append` writes into the live schema without one transaction and can leave partial changes on failure. Globals run before database recreation with `ON_ERROR_STOP`; only duplicate `CREATE ROLE` errors are ignored. Other globals errors stop the restore before the database is dropped. Restart the backend after restoring. Use a separate scratch database to rehearse recovery.

Backups use credentials inside the database container, serialize publication/retention with `.backup.lock`, stage privately, validate nonempty SQL and gzip, and atomically publish complete files. Concurrent jobs fail clearly rather than overwrite another dump. Failed staging files are cleaned; after an interrupted process, confirm no backup is running before removing a stale lock. `--print-path` puts only the new dump path on stdout and logs on stderr. Dumps made in pgAdmin custom format are outside this script format and require `pg_restore`.

## Files and environment overrides

| Path or variable                  | Meaning                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `backups/opencw_TIMESTAMP.sql.gz` | Data dump; collision suffixes preserve runs in the same second                          |
| `backups/globals/`                | Companion globals dumps                                                                 |
| `.deploy-state`                   | Last update revision, branch, backup, and image snapshots                               |
| `BACKUP_DIR`                      | Backup lookup/output directory; default root `backups/`                                 |
| `BACKUP_RETENTION`                | Retention default for backup and pre-update/pre-restore dumps                           |
| `STATE_FILE`                      | Override release-record path                                                            |
| `ENV_FILE`                        | Override parsing/validation/bootstrap and Compose environment file; default root `.env` |
| `API_PORT`, `FRONTEND_PORT`       | Host probe ports; Compose bindings remain fixed unless separately changed               |
| `PGADMIN_PORT`                    | Probe port: process environment, then parsed environment file, then 5050                |
| `DRY_RUN=1`, `ASSUME_YES=1`       | Environment equivalents for scripts that support the corresponding operation            |

These overrides are process environment variables. The wrapper passes `ENV_FILE` to Compose with `--env-file`; exported Compose values take precedence over the file. Parsing handles quoted values, whitespace, inline comments, and CRLF without executing shell code. Tuning inputs must be literal and reject `$` interpolation, keeping their preview independent of Docker. For other inputs, dollar-containing unquoted/double-quoted values are resolved by Compose's read-only `config --environment` command; single-quoted values stay literal. `check-env.sh --env-file PATH` is a validation-only override.

In PGTune mode, the wrapper supplies calculated `POSTGRES_SHM_SIZE` before Compose creates the database; an explicit value wins. Use `make tune` to preview and `make deploy`/`make update` to apply. Direct `docker compose` commands do not calculate shared memory and use their static `2gb` fallback unless the size is explicit; see [database tuning](../db/README.md#overrides-and-shared-memory).

## Scheduled runs

Configure the deployment host's cron PATH so Bash, Docker, gzip, and HTTP probe tools are available. For a checkout at `/opt/opencw`, example entries are:

```cron
15 3 * * * /opt/opencw/scripts/backup.sh --dir /mnt/backups >> /var/log/opencw-backup.log 2>&1
*/5 * * * * /opt/opencw/scripts/status.sh --skip-disk >> /var/log/opencw-status.log 2>&1
```

A status job supplies an exit code and log, not a notification service; connect failures to your monitoring. Keep backup storage off the host, rotate cron logs separately, and [rehearse restoration](../DEPLOYMENT.md#backups-and-recovery).

## Troubleshooting

Read `docker compose logs --tail=100 SERVICE` after failed deployment verification. A repeated container restart is detected early; backend failures commonly need the required email/token/database configuration checked. A missing tuner entrypoint needs the complete checkout and correct bind mount. Unexpected database budgets are covered by the [tuning guide](../db/README.md).

For a missing upstream, configure branch tracking or pass `--ref`. After rollback, return to a branch before ordinary update. pgAdmin's initialized account ignores later edits to `PGADMIN_DEFAULT_*`; reset it through pgAdmin as described in [administration](../DEPLOYMENT.md#pgadmin-administration). Diagnose its web login separately from a failed database connection.

## Regression checks

Run `python3 scripts/tests/test-operations.py` from the root. Fixtures copy scripts into temporary directories and stub Docker, Git network operations, and host utilities; they never use the live database or project `.env`. The runner prefers Bash 4 or newer. A macOS Bash 3 compatibility run removes only the version guard in copied scripts and reports the unavailable native Bash 4 gate. Run shell syntax checks separately and rehearse recovery on an isolated Linux stack before production use.

Run `node --test scripts/validate-messages.test.mjs` from `frontend/` for nine catalogue-validation regression cases.
