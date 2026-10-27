# OpenCW production deployment

Deploy the root [Compose stack](docker-compose.yaml) on a Linux host. Use this procedure for installation and recovery, [scripts/README.md](scripts/README.md) for command flags, [example.env](example.env) for configuration defaults, and [db/README.md](db/README.md) for database tuning. Image versions live in Compose.

For a newly created Proxmox LXC, begin with [Fresh LXC setup](#fresh-lxc-setup), then follow [Clone and configure](#clone-and-configure) and [Build and verify](#build-and-verify). A host with Docker already installed can start at cloning.

## Requirements

Use Docker with Compose v2, Bash 4 or newer, Git, Make, gzip, and curl or wget; OpenSSL generates secrets. The scripts require GNU host utilities, so run them on the deployment host. Enable Docker at boot and reserve space for database data, images, and retained backups.

The shipped bindings expose the database at `127.0.0.1:${DB_PORT:-5432}`, backend at `127.0.0.1:8080`, frontend at `127.0.0.1:3000`, and pgAdmin at `127.0.0.1:${PGADMIN_PORT:-5050}`. Cloudflare Tunnel reaches services over the Compose network; a host reverse proxy uses loopback. Direct LAN access requires the explicit application binding changes below. Keep the database and pgAdmin private, and retain local access for health probes.

## Fresh LXC setup

Start with the container you already created from a **Debian LXC image/template** in Proxmox. This walkthrough covers an **unprivileged Debian 12 (Bookworm) or Debian 13 (Trixie) LXC**, the releases supported by [Docker's Debian installer](https://docs.docker.com/engine/install/debian/#os-requirements). The repository setup below reads the release codename from your image automatically.

All shell commands after the Proxmox step run as **root inside the LXC**, using its Console or `pct enter`. Docker builds supply the application's Node and Go runtimes; you do not need to install them in the LXC.

### 1. Prepare the container on Proxmox

For a small initial deployment, an example allocation is **4 CPU cores, 8 GiB RAM, and a 32 GiB root disk**. This is a starting allocation, not a capacity guarantee: image builds need temporary memory and disk space, and data/backups need room to grow. Give the container a stable LAN address, gateway, and working DNS.

With the container stopped, open **Options → Features** in Proxmox and enable **Nesting** and **keyctl**. Enable **Start at boot** in Options. These features allow nested containers and the keyctl system call used by Docker in an unprivileged LXC; see the [Proxmox feature definitions](https://github.com/proxmox/pve-container/blob/master/src/PVE/LXC/Config.pm).

Alternatively, run the following **on the Proxmox host**. Replace `123` with your newly created, stopped container's ID. The `--features` argument sets the feature list; retain any other enabled feature flags if the container already has them.

```bash
CT_ID=123
pct config "$CT_ID"
pct set "$CT_ID" --features nesting=1,keyctl=1 --onboot 1
pct start "$CT_ID"
pct enter "$CT_ID"
```

You are now inside the LXC. Nested Docker compatibility depends on the Proxmox host's kernel and container configuration. The Docker smoke test below is the checkpoint before installing OpenCW. Proxmox recommends a QEMU VM when stronger isolation or live migration is required; see its [container guide](https://github.com/proxmox/pve-docs/blob/master/pct.adoc).

### 2. Install the host tools inside the LXC

```bash
cat /etc/os-release
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git make openssl nano \
  bash coreutils findutils gzip iproute2
ip -brief address
getent hosts download.docker.com
```

In `/etc/os-release`, confirm `ID=debian` and either `VERSION_ID="12"` / `VERSION_CODENAME=bookworm` or `VERSION_ID="13"` / `VERSION_CODENAME=trixie`. Note the LXC's LAN IP. If your template uses another release, check Docker's supported releases before continuing; do not point an older Debian installation at the Trixie repository. If package downloads or name resolution fail, fix the container's network/DNS settings in Proxmox.

### 3. Install Docker Engine and Compose

Set up the official Docker APT repository for this fresh Debian installation, following [Docker's Debian guide](https://docs.docker.com/engine/install/debian/#install-using-the-apt-repository):

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
systemctl is-active docker
docker --version
docker compose version
docker run --rm hello-world
```

Continue when the service reports `active`, Compose prints its version, and the test container prints its success message. If Docker fails, inspect `systemctl status docker` and `journalctl -u docker --no-pager -n 100`; check the LXC features and host configuration before building the application.

### 4. Prepare persistent database storage

```bash
install -d -m 0755 /data/postgres
findmnt -T /data/postgres
df -h / /data/postgres
```

On a fresh container, `/data/postgres` is a directory on its persistent root disk. If using a separate disk or Proxmox mount point, attach it before this step and confirm `findmnt` reports the intended filesystem. Set `POSTGRES_DATA_PATH` to the path visible **inside the LXC**. External bind mounts can need ownership mapping for an unprivileged container; resolve write-permission errors before deployment.

The root-owned bind-mount parent must allow the image's PostgreSQL user to traverse it. Keep this parent at `0755`; a root-owned `0700` parent prevents startup. The image creates and protects the actual cluster directory, `/data/postgres/18/docker`, with mode `0700`; do not make that `PGDATA` directory public.

Proxmox backups exclude host bind-mount contents; enable the backup option for additional managed storage mount points and keep the SQL backups described below. See [Proxmox mount-point backup behavior](https://github.com/proxmox/pve-docs/blob/master/pct.adoc#backup-of-container-mount-points).

## Clone and configure

Inside the LXC, clone the complete repository into `/opt/opencw`; Compose bind-mounts [db/tune.sh](db/tune.sh), so the Compose file alone is insufficient. Run all subsequent commands from the checkout root. If you already have a checkout and `.env`, use those rather than copying over your configuration.

```bash
git clone https://github.com/0x5916/OpenCW.git /opt/opencw
cd /opt/opencw
cp example.env .env
chmod 600 .env
openssl rand -base64 32
nano .env
```

Paste the generated value into `JWT_SECRET` and fill the required values below. In Nano, save with **Ctrl+O**, confirm with **Enter**, then exit with **Ctrl+X**. Keep `.env` out of Git and do not source it as shell code; values such as the sender address contain spaces.

| Configuration  | Required values and meaning                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database       | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`; select `POSTGRES_DATA_PATH` on persistent storage. An unset path falls back to `./data/postgres`.           |
| Access tokens  | `JWT_SECRET`: base64 bytes; `make check` requires at least 32 decoded bytes.                                                                                     |
| Email          | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`; both are required by backend startup validation.                                                                          |
| Browser API    | `PUBLIC_API_BASE`: browser-reachable V1 URL, for example `https://api.example.com/v1`. It is embedded when the frontend is built.                                |
| CORS           | `CORS_ORIGINS`: comma-separated frontend origins. This is backend runtime configuration.                                                                         |
| Auth source    | `AUTH_TRUSTED_PROXY_CIDRS`: optional comma-separated proxy CIDRs; empty by default. See [authentication source attribution](#authentication-source-attribution). |
| Google sign-in | Optional `GOOGLE_CLIENT_ID` and matching build-time `PUBLIC_GOOGLE_CLIENT_ID`; leave both empty to disable. See [Google sign-in setup](#google-sign-in-setup).   |
| pgAdmin        | `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`: separate from database credentials; used to initialize its account.                                         |

Set the database's RAM budget on a shared or nested host; see [PostgreSQL resource tuning](#postgresql-resource-tuning). The template selects PGTune's web profile; other tuning inputs remain commented until you remove their leading `#`. Review optional ports, HTTP timeouts, connection pool settings, and tunnel values in [example.env](example.env), then run `make check`.

For an initial **LAN installation**, explicitly change the frontend and backend bindings in `docker-compose.yaml` to `"3000:80"` and `"8080:8080"`, respectively, and restrict those ports to your intended LAN clients with the upstream firewall. Keep database and pgAdmin bindings on loopback. These application binding changes enable the host health probes and direct LAN access. Then replace the following values in `.env`. This example assumes the LXC is `192.168.1.50` with the 4-core/8-GiB allocation above; substitute its actual IP. These are settings to edit, not commands to run:

```dotenv
POSTGRES_DATA_PATH=/data/postgres
POSTGRES_TUNE_MODE=pgtune
POSTGRES_MEMORY_LIMIT=2g
PUBLIC_API_BASE=http://192.168.1.50:8080/v1
CORS_ORIGINS=http://192.168.1.50:3000
```

The database budget leaves room for the backend, pgAdmin, and builds; adjust it for your allocation. The local calculator derives PostgreSQL settings without copying values from the PGTune website. CPUs are detected; uncomment `POSTGRES_CPU_LIMIT` if the database needs a smaller share. With `POSTGRES_SHM_SIZE` commented, the deployment scripts calculate `/dev/shm` capacity before creating the container; the 2-GiB budget gives 256 MiB. See [the tuning guide](db/README.md) for this separate OpenCW policy and optional overrides.

Fill `POSTGRES_PASSWORD`, `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`, `JWT_SECRET`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` as well. Use separate database and pgAdmin passwords, your Resend API key, and a sender configured in Resend.

`PUBLIC_API_BASE` must be reachable from the computer opening the website. Browser `localhost` means that computer, not the LXC; `backend` is only a Docker-network hostname. Replace the sample's public API URL before building your own installation. For HTTPS/public access, use the hostnames described in [Public access](#public-access) instead of the LAN URLs.

```bash
make check
make tune
```

Proceed when validation exits successfully and the read-only preview shows the intended database budget and settings. Neither command starts PostgreSQL; Docker container startup and browser connectivity are verified next.

### Google sign-in setup

Create a Google OAuth client of type **Web application**, configure OAuth branding, and add the exact frontend origins under Authorized JavaScript origins, following [Google's setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). This integration uses the GIS popup callback, so it needs no Google client secret or redirect endpoint. Set matching `GOOGLE_CLIENT_ID` and `PUBLIC_GOOGLE_CLIENT_ID`; Compose passes the former to the API and the latter as a frontend build argument.

Set `CORS_ORIGINS` to the intended HTTPS frontend origins. Explicit HTTP localhost origins are allowed for development; ordinary HTTP LAN origins cannot enable Google sign-in. Unlike the general development API policy, Google always checks its exact allowlist. Existing reverse-proxy CSP/COOP settings must permit Google's SDK and popup communication; verify the real browser flow before rollout and change headers only when required by Google's guidance. The [backend guide](backend/README.md#google-sign-in) owns runtime configuration and the [approved specification](backend/docs/google-sign-in-spec.md) owns the API and schema acceptance gates.

Rebuild the frontend after changing its client ID. Backend startup adds the `user_identities` table through the existing additive migration path. Validate the migration and existing account preservation against a disposable database before an authorized rollout. Source implementation and mocked browser tests do not establish that a live Google client/origin is configured correctly.

## Build and verify

```bash
make deploy
make status
make backup
```

Deployment can bootstrap `.env` and generate a missing JWT secret, but required credentials still need values. It builds the images, waits for database/backend/frontend/pgAdmin container health, and probes backend and frontend HTTP endpoints. A failed pgAdmin HTTP probe warns. `make status` additionally treats an unhealthy or missing pgAdmin container as a failure; its pgAdmin HTTP probe and tunnel problems are warnings.

The [frontend image](frontend/Dockerfile) installs the locked development dependencies and runs `npm run verify` before building. IndexedDB tests use `fake-indexeddb`, which is declared in [frontend/package.json](frontend/package.json) and pinned by [frontend/package-lock.json](frontend/package-lock.json). A failed verification gate stops the image build; fix the reported failure in the repository before deployment.

The frontend builder uses patched Node 26.12.1. Both the frontend runtime and the [derived pgAdmin image](pgadmin/Dockerfile) require patched system Brotli; pgAdmin also updates its independent Python binding. Both Compose stacks build that pgAdmin image for the web service and its configuration renderer. Rebuild these images when applying the [HTTP2Shell remediation contract](docs/http2shell-remediation.md); pulling the upstream pgAdmin image alone does not apply the OpenCW dependency patch. Runtime checks are documented in the [script guide](scripts/README.md#regression-checks).

Local endpoints are frontend `http://127.0.0.1:3000`, health `http://127.0.0.1:8080/v1/health`, and pgAdmin `http://127.0.0.1:5050` unless its port changed. `pgadmin-config` exits after rendering configuration; exit 0 is expected.

From **inside the LXC**, check the running services and local endpoints:

```bash
docker compose ps -a
curl --fail http://127.0.0.1:8080/v1/health
curl --fail --head http://127.0.0.1:3000/
```

Then open `http://192.168.1.50:3000` from another computer on the LAN, using your LXC's actual IP. Confirm the homepage loads, guided training plays audio, and the browser can reach `http://192.168.1.50:8080/v1/health`. Account/email features also need the configured backend and Resend credentials. Port 5050 is loopback-only, so the LAN IP will not expose pgAdmin; use the protected tunnel described below or an SSH forward to the LXC if SSH is configured.

For LAN-only use with no tunnel token, stop the unused tunnel after deployment:

```bash
docker compose stop cloudflared
```

Deploy/update starts it again with the stack, so repeat this step while using LAN-only access. Protect the published ports with the Proxmox/upstream firewall, allowing 3000 and 8080 only from the intended LAN clients and keeping 5432 private. Docker-published ports can bypass an in-container UFW firewall; see [Docker's firewall limitations](https://docs.docker.com/engine/install/debian/#firewall-limitations).

If this first installation fails, use the matching checkpoint:

| Symptom                                              | Check                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apt-get update` or image pulls cannot resolve hosts | LXC IP, gateway, DNS, and outbound network access.                                                                         |
| Docker cannot start a test container                 | Nesting/keyctl, `journalctl -u docker`, and the Proxmox host's container/kernel configuration.                             |
| A build is killed or reports no space                | LXC memory allocation and free space for image layers/builds; increase resources before retrying.                          |
| Database fails to initialize or write its data       | `docker compose logs --tail=100 db`, the storage mount, permissions, and explicit database limits.                         |
| Backend keeps restarting                             | `docker compose logs --tail=100 backend` and the required values listed above.                                             |
| Homepage loads but account/API requests fail         | Browser-reachable `PUBLIC_API_BASE`, matching `CORS_ORIGINS`, and access to port 8080; rebuild after changing the API URL. |

## Isolated UI acceptance stack

The owner-approved acceptance environment on `pve-104` uses application revision
`ac25e57`, separate from `/opt/opencw`. Its configuration lives in
[`scripts/acceptance-stack/`](scripts/acceptance-stack/compose.yaml). Keep its
Compose file in `/opt/ditpath-ui-acceptance`, with the approved `git archive`
extracted into `source/` and `source/REVISION` containing `ac25e57`. Verify the
archive checksum before extracting; the revision marker alone is not integrity
evidence. Do not run this Compose file inside the repository.

Copy `prepare.py` and `compose.yaml` into that directory, then run:

```sh
cd /opt/ditpath-ui-acceptance
python3 prepare.py /opt/ditpath-ui-acceptance
docker compose -p ditpath-ui-acceptance --env-file runtime/stack.env config --quiet
docker compose -p ditpath-ui-acceptance --env-file runtime/stack.env build
docker compose -p ditpath-ui-acceptance --env-file runtime/stack.env up -d
```

Preparation creates new mode-600 secrets and a same-origin `/v1` proxy derived
from the checked-in nginx configuration. PostgreSQL uses only `runtime/postgres`.
The API, database and test runner share an internal network; only nginx joins an
access bridge and publishes **loopback** ports 3001 and 8081. Docker does not
publish ports on an internal-only network, so both published ports belong to
nginx. External email delivery is blocked and Google sign-in is disabled. The
existing stack, volumes, images and public access are not reconfigured.

After the API has migrated the fresh database, the optional `checks` profile
builds the existing Go builder target and runs database-backed tests. Its DSN
points only to the acceptance database. Record actual pass/skip counts; use
`go vet ./...` as an additional command in that test container.

Forward 3001 and 8081 over SSH, then open `http://127.0.0.1:3001`. Both
`127.0.0.1:3001` and `localhost:3001` are allowed test origins; they have separate
browser storage, which can test restoration without claiming cross-browser
compatibility. Run `python3 scripts/acceptance-stack/check-api.py --output-dir
/private/tmp/ditpath-ui-acceptance-runtime` from the local checkout. This uses only
the forwarded 8081 API and writes reusable disposable A/B credentials privately
outside the repository, plus a separate assertion report. Never print or commit
the credentials. Registration sends no email; verification/Forum tests are outside
this setup. Cloudflare exposure and native-phone access are subsequent steps.

## Public access

For Cloudflare Tunnel, configure `CLOUDFLARED_TUNNEL_TOKEN` and route public hostnames to `http://frontend:80`, `http://backend:8080`, and, if needed, `http://pgadmin:80` on the Compose network. Put a restrictive Cloudflare Access policy in front of pgAdmin. `CLOUDFLARED_PROTOCOL` selects the tunnel transport. The service always starts with the stack; an empty token causes restart loops. Stop it explicitly when using a different proxy.

A reverse proxy must terminate TLS and forward the frontend to port 3000 and API to port 8080. Preserve both `/v1` and `/v2` API paths. If adding a public path prefix, include the V1 path in `PUBLIC_API_BASE` and configure proxy rewriting consistently. Rebuild the frontend after changing that value; recreate the backend after changing CORS. Production uses `GIN_MODE=release`, which disables profiling routes; development registers `/debug/pprof/*`, so keep development profiling private.

### Cloudflared security update reminder

As of 28 October 2026, Cloudflare's [latest stable release is 2026.10.5](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.5). Upgrade every tunnel connector to the latest stable release when applying the current security update. The Compose service uses `:latest`, but restarting an existing container does not pull a new image. On each deployment host, during an authorized maintenance window:

```bash
docker compose pull cloudflared
docker compose up -d --no-deps cloudflared
docker compose exec cloudflared cloudflared --version
docker compose logs --tail=50 cloudflared
```

Verify the running version and successful tunnel connections, then check the public application URL. Repeat for connectors outside this Compose stack using their installation method. Publishing Git commits does not update running connectors. This reminder does not establish that any deployed connector has been upgraded.

### Authentication source attribution

The root [environment template](example.env) and [Compose stack](docker-compose.yaml) pass `AUTH_TRUSTED_PROXY_CIDRS` to the backend with an empty default. Empty/unset trusts no proxy, so public login and registration use the canonical transport peer. Users behind the same Cloudflare Tunnel/reverse-proxy peer therefore share 10 login and 3 registration admissions per rolling minute, alongside the combined per-process quota. Restarts reset history and additional backend processes multiply limits; [the API contract](backend/API.md#authentication-resource-admission) owns responses and precedence.

Enabling a production allowlist requires separate explicit authorization from the deployment owner. Before activation, verify the actual TCP peer addresses and approve only their required CIDRs, then verify each approved proxy constructs or sanitizes the complete `X-Forwarded-For` chain. CIDR membership alone does not prove header provenance. Do not infer trust from Docker/private address ranges or copy an unverified allowlist. No production CIDRs are supplied by this packet.

The [auth source resolver](backend/internal/authlimits/source.go) accepts forwarding only from approved peers, validates every element across all `X-Forwarded-For` fields, and ignores other forwarding/platform headers. Configuration is validated before database startup or listening; malformed CIDRs, empty list elements, and trust-all prefixes fail startup. This setting affects public auth attribution and logs only; it does not change global Gin proxy behavior or tune quotas. The [approved resource-limit specification](backend/docs/auth-resource-limits-spec.md) owns policy and acceptance requirements, with acceptance evidence recorded there.

## Updates and rollback

```bash
make update DRY_RUN=1
make update
```

The update script requires a clean tracked working tree, snapshots locally built images, takes a database backup, fetches and fast-forwards the current branch, rebuilds, and verifies health. Use `scripts/update.sh --ref REVISION` for a branch, tag, or commit. `--auto-rollback` restores prior images on failure; otherwise the script prints rollback commands. The release record is `.deploy-state`. Return from a rollback's detached HEAD to a branch before the next ordinary update.

Backend startup runs GORM `AutoMigrate`. An image rollback does not undo database changes: retain the pre-update dump and restore it when returning to an older schema. `--no-backup` removes that recovery path. See [script flags](scripts/README.md#script-reference).

## pgAdmin administration

pgAdmin's web login uses `PGADMIN_DEFAULT_*`; its database connection uses `POSTGRES_*`. Editing the former after the first initialization does not reset an existing account. Reset through the user interface or the container's `setup.py update-user` command, using the existing login email. Deleting its volume discards saved accounts, servers, and preferences.

The shared [renderer](scripts/render-pgadmin.py) writes `servers.json` and a private per-login `.pgpass` into `pgadmin_data`, escapes all credential fields, and selects that passfile in the connection parameters. It uses host `db`, port 5432, and the configured database role. Startup replaces the configured pgAdmin account's saved server list with this managed OpenCW connection. Bring the stack up after credential changes so the renderer runs; restarting pgAdmin alone does not run it. A password saved separately in pgAdmin must also be updated. The volume holds the database password in plain text; protect it like `.env`. The configured connection uses `sslmode=prefer` and master-password protection is disabled.

## Backups and recovery

```bash
make backup
scripts/backup.sh --dir /mnt/backups
scripts/restore.sh --file backups/opencw_TIMESTAMP.sql.gz
```

Backups are verified gzip plain-SQL dumps, with companion globals dumps for roles and grants. Default retention is 14 dumps; `--keep 0` disables pruning. Restore stages inputs before any database recreation and pins its recovery dump until verification succeeds. Keep copies off the host and protect configuration and pgAdmin state separately. Backup frequency determines how much recent data can be lost; the scripts do not implement continuous recovery.

Restore replaces the live database by default: it requires a database-name confirmation unless `--yes`, takes a pre-restore backup unless `--no-backup`, drops/recreates the database, and loads the data in one transaction. A failed load rolls back that load; the previous database was already dropped. Globals restoration is separate and best-effort. `--append` writes into the existing live schema without the single-transaction guarantee and can leave partial changes. Restart the backend after a successful restore.

Rehearse dumps against a separate scratch database or isolated stack, verify tables and representative records, then remove the scratch database. `--append` against production is not a rehearsal. The restore script accepts its own `.sql` and `.sql.gz` format; pgAdmin custom dumps require `pg_restore` instead.

The root database is a host bind mount at `/var/lib/postgresql`, with `PGDATA=/var/lib/postgresql/18/docker`. A live filesystem copy can be inconsistent; use a stopped or application-consistent snapshot as an additional backup and retain the matching PostgreSQL version. `docker compose down` preserves data; `down -v` removes pgAdmin's named volume but not the database bind mount. Before any deliberate data deletion, resolve the configured path and confirm the cluster under its versioned PGDATA directory.

## Monitoring and credential changes

```bash
scripts/status.sh --skip-disk
docker compose logs --tail=100 backend
docker compose logs db
```

Status reports environment validation, containers, endpoints, database readiness, revision, images, backups, and disk usage. It warns when the newest backup is at least seven days old. Schedule backups and status checks using the [cron example](scripts/README.md#scheduled-runs). Compose caps long-running container logs at three 10 MB files. Services use `restart: unless-stopped`; Docker must start at boot, and deliberately stopped services stay stopped.

Rotate the database role password with psql's `\password` prompt, update `.env`, recreate affected services, and update any saved pgAdmin password. Changing `.env` alone does not alter an initialized PostgreSQL role. Changing `JWT_SECRET` invalidates existing access JWTs after backend recreation; opaque refresh tokens remain valid until revoked or expired. Refresh-token invalidation requires separate database handling. Update Resend credentials and recreate the backend; change an existing pgAdmin password through pgAdmin rather than its initialization variables.

## PostgreSQL resource tuning

New installations select `POSTGRES_TUNE_MODE=pgtune` and need only a database RAM budget; the default profile is web. Existing `.env` files without a mode keep the legacy `opencw` calculator. `off` selects the image defaults. Optional lines in [example.env](example.env) use `#`; remove it to override detected CPUs, connection demand, workload, storage assumptions, or shared-memory capacity.

[db/README.md](db/README.md) owns defaults, detection, calculations, compatibility adjustments, and troubleshooting. Preview with `make tune`, then apply changes with `make deploy` or `make update`; these scripts pass calculated shared-memory capacity to Compose. Direct `docker compose` commands do not perform that calculation. Inspect `docker compose logs db` before accepting a deployment; do not edit cluster files to tune it.
