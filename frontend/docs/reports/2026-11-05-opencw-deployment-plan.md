# OpenCW deployment plan — PR #4

Prepared 5 November 2026 for owner review. **No deployment, backup, migration, restore or production-changing command was run.** This plan is tied to the tested code candidate; it becomes executable only after merge and deployment approval.

- PR: <https://github.com/0x5916/Morse/pull/4> (draft; auto-merge disabled)
- Branch: `codex/opencw-integration`
- Tested code commit: `0963f7a276f19d0ffe04c30ecacf8b2d55f81d45`
- Base: `origin/main` `4d286506fcf3184fb6c0ead4c82a8380d8879430` (PR #3 merged)
- Expected artifacts: rebuilt frontend static image; unchanged backend/API contract; no schema migration authored by this PR
- Deployment authority: [DEPLOYMENT.md](../../../DEPLOYMENT.md); command reference: [scripts/README.md](../../../scripts/README.md)

## 1. Release identity

1. Merge PR #4 through GitHub after approval. Do not enable auto-merge.
2. Record the merge commit as the release SHA (`M`). Record its tree and the merged PR head:
   - `git fetch origin main`
   - `git rev-parse origin/main` (must equal `M`)
   - `git show -s --format='%H %T %s' M`
3. Confirm `M` contains tested code `0963f7a` (`git merge-base --is-ancestor 0963f7a M`) and that no post-test code commit changed `frontend/` or `backend/`.
4. On the deployment host, record the current release before changing anything:
   - `git status --short` (must be clean for tracked files)
   - `git rev-parse HEAD` and current branch
   - `cat .deploy-state` (previous revision, branch, backup, image snapshots)
   - `docker compose ps -a`
5. After deployment, verify the host checkout/`.deploy-state` reports `M` and the running frontend image digest matches the image built in this deployment.

Compatibility: frontend-only behavioral change plus one localization copy fix. No API, auth, database, schema or learning-policy change. Five-locale prerendering, `/forum/[id]` fallback, offline shell and `/morse/review` noindex must remain intact.

## 2. Preflight (read-only)

Run on the deployment host from the repository root (`/opt/opencw` unless the host confirms another path):

```sh
make check
make tune
make status
scripts/status.sh --skip-disk
```

Required status:

- PR #4 CI: Frontend checks, Backend tests/vet, PostgreSQL integration and Targeted race tests all pass on the head that is merged.
- Local acceptance report records no unexplained failing row; blocked physical-device, spoken-screen-reader and mobile-native-scaling rows are acknowledged as exceptions, not passes.
- Owner has given final design sign-off and merge/deployment approval.
- `.env` retains the existing production `PUBLIC_API_BASE`, `CORS_ORIGINS`, database, JWT, Resend and pgAdmin values. Do not replace or print secrets.
- The host has enough disk for images, build layers and a new backup; Docker health and DNS are normal.
- The current frontend/backend/database health is green before the update.
- If the host checkout is not on `main`, record its branch/tag and use the explicit `--ref` described below rather than assuming `make update` will fast-forward the right branch.

Unresolved facts to verify read-only before execution:

- Actual host checkout path and current revision (`/opt/opencw` is the documented default).
- Whether the host is served by Cloudflare Tunnel, a reverse proxy or both; the smoke-test origins.
- The owner-approved production smoke account and whether creating a disposable smoke account is permitted.
- Current `.deploy-state` image tags and backup path.
- Whether the host uses the documented Compose stack unchanged or an approved variant.

## 3. Backup

After authorization and immediately before the update, from the repository root. Use the host's documented backup path instead of `/mnt/backups` if different:

```sh
BACKUP_PATH="$(scripts/backup.sh --dir /mnt/backups --keep 14 --print-path)"
printf '%s\n' "$BACKUP_PATH"
gzip -t "$BACKUP_PATH"
ls -lh "$BACKUP_PATH"
ls -lh "$(dirname "$BACKUP_PATH")/globals" 2>/dev/null || true
```

`--print-path` prints only the new dump path on stdout and logs on stderr, so this runs one backup and captures its path. `backup.sh` writes a verified gzip plain-SQL dump and companion globals dump, rotates retained dumps and never prompts. `make backup` is the Make wrapper when the default backup directory is acceptable.

Record the exact dump path, size, timestamp and gzip exit code in the release record. The update script also takes its own pre-update backup and aborts if it fails; do not use `--no-backup`. Do not restore or rehearse against production. Rehearsal must use a separate scratch database/isolated stack.

## 4. Deployment

Backend deployment is **not required for compatibility**: this PR changes frontend behavior/copy only, with no backend contract, auth, schema or configuration change. The supported release path (`scripts/update.sh`) rebuilds the stack and may recreate the backend; backend startup still runs the existing idempotent GORM `AutoMigrate`, but this PR authors no migration. Do not run a separate migration command.

Use the supported update path:

```sh
make update DRY_RUN=1
scripts/update.sh --ref <M> --auto-rollback
```

or, if the host is on a clean `main` tracking `origin/main`:

```sh
make update
```

Notes:

- `scripts/update.sh` refuses a dirty tracked tree, snapshots locally built images, takes a pre-update backup, fetches/fast-forwards or checks out the requested ref, rebuilds, verifies health and records `.deploy-state`.
- Use `--ref <M>` for the exact release SHA. A tag/commit uses detached HEAD; return to a branch before the next ordinary update.
- `--auto-rollback` restores prior images on failure; it does not reverse database migrations.
- The frontend image build runs `npm run verify` before `npm run build`; a failed gate stops the image.
- Preserve `.env`, volumes, database bind mount, pgAdmin state and tunnel/reverse-proxy configuration.
- Separate steps: image build and container recreation happen in `update.sh`; there is no schema-changing step authored by this release. If the operator chooses a custom frontend-only rebuild, that is outside the documented release path and needs separate approval.

After the update:

```sh
make status
docker compose ps -a
curl --fail http://127.0.0.1:8080/v1/health
curl --fail --head http://127.0.0.1:3000/
```

Record the frontend image digest, backend image digest, `.deploy-state` content, health responses and timestamps.

## 5. Post-deployment smoke tests

Use the owner-approved smoke account and a private browser profile. Do not use a real learner's data.

Read-only/static:

- `GET /en`, `/de`, `/ja`, `/zh-Hans`, `/zh-Hant` return 200.
- `GET /en/morse/review`, `/de/morse/review`, `/ja/morse/review`, `/zh-Hans/morse/review`, `/zh-Hant/morse/review` return 200.
- `/en/morse/review/` is expected to return 404 under the current nginx config (same as pre-release); record it as a known behavior, not a new regression.
- Home shows Guided Lessons primary and Recall & Review secondary; desktop navigation says `Recall`; mobile More says `Recall & Review` in the active locale.
- `/en/morse/review` page title and heading are `Recall & Review`; it is not indexed.

Authenticated/sync:

- Login through the real form; confirm the account/owner renders.
- Confirm access-token renewal keeps the same username/JWT subject and does not drop a saved checkpoint or pending write.
- Confirm training-history sync and learning-evidence sync each report independently; no status claims the other pipeline is complete.
- Confirm a correction/rejection and a pending/partial coverage state remain visible and truthful.

Learning flows:

- Guided entry from Home; first sound starts from the initiating gesture; pause, explicit Resume, Save & leave and recovery.
- Recall entry from Home/Recall/More; first sound starts; replay, pause, explicit Resume; no automatic restart on return.
- Recognition prompt: Space replays without scrolling; Enter submits only after composition ends (owner/manual keyboard check where available).
- Complete or save a short session, reload, confirm the same checkpoint/session identity and draft.
- Progress opens Overview/Characters/History; guided and recall vocabulary is distinct; character claims are scoped to the active speed/profile.
- Account isolation: a second synthetic account sees no first-account activity.
- Navigation: mobile More active on `/morse/review`; Back/Forward focus lands on the main landmark.
- Confirm deployed revision: `scripts/status.sh` and `.deploy-state` report `M`; the frontend image digest matches the deployment record; the More page contains the localized full label.

## 6. Rollback

Identify the previous release before deployment from `.deploy-state`:

- previous revision/branch
- pre-update backup path
- local image snapshots for frontend/backend/database/pgAdmin

If `scripts/update.sh` fails, its `--auto-rollback` restores prior images and verifies health. If deployment succeeded but smoke tests fail, use the rollback commands printed by the update script and the recorded image tags. The release record and detached-HEAD state must be read before acting.

Database compatibility:

- This PR authors no schema change, but backend startup runs the existing `AutoMigrate`. An image rollback does not undo any migration that a recreated backend applied.
- If the backend schema did not change during this release, a frontend/backend image rollback is normally sufficient.
- If schema rollback is required, restore the pre-update dump with the documented `scripts/restore.sh` procedure and restart the backend. Restore is destructive and requires a separate explicit decision; do not run it as part of an image rollback by default.
- Do not use `--append` against production as a rehearsal.

Rollback triggers:

- backend/frontend health probe failure after the update;
- login/token renewal failure, owner leakage or lost checkpoint/pending write;
- either sync pipeline certifying completion while pending/rejected/partial evidence exists;
- Recall or guided entry/audio/pause/resume broken;
- static route, locale, offline shell or `/forum/[id]` fallback broken;
- a new error-rate spike attributable to the release during the observation window.

## 7. Monitoring

After deployment, observe for at least 60 minutes:

- `scripts/status.sh --skip-disk` at 0, 5, 15, 30 and 60 minutes.
- `curl --fail http://127.0.0.1:8080/v1/health` at the same points.
- `docker compose logs --tail=100 backend`, frontend and cloudflared/reverse-proxy logs; look for 5xx, auth failures, panic/restart loops, CORS errors and tunnel disconnects.
- Confirm backend/frontend container restart counts do not increase unexpectedly.
- Confirm the newest backup is present and retention did not remove the pre-update dump.
- Watch for owner-isolation reports, sync rejection growth, checkpoint loss or audio-start failures.

Escalate or roll back on: repeated container restarts, health failure, sustained 5xx/error growth, login failure, cross-account data exposure, lost saved session, false sync certification, or a broken primary route. A passing CI run, PR creation or this plan does not constitute deployment approval.

## 8. Approval gates

| Gate                                                                                                 | Status                                    |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| A. Acceptance exceptions (physical-device, spoken screen-reader, mobile native scaling, Safari 200%) | Awaiting owner decision                   |
| B. Final design sign-off                                                                             | Awaiting owner review of post-edit Penpot |
| C. Merge approval                                                                                    | Not granted                               |
| D. Deployment approval                                                                               | Not granted                               |

No merge, auto-merge, deployment, backup, restore, migration or production access was performed while preparing this plan.
