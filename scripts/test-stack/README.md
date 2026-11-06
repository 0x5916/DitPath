# Disposable full-stack acceptance environment

This directory runs the real DitPath application locally for manual acceptance without touching the production Compose project, production volumes, deployment configuration, or any other worktree.

| Component  | Implementation                                                          | Loopback URL                       |
| ---------- | ----------------------------------------------------------------------- | ---------------------------------- |
| Frontend   | Production static build served by nginx, including the service worker   | `http://127.0.0.1:13000/en`        |
| Backend    | Current Go API image, release mode, no profiling routes                 | `http://127.0.0.1:18080/v1`        |
| Health     | Backend and same-origin nginx proxy                                     | `http://127.0.0.1:18080/v1/health` |
| PostgreSQL | Dedicated `postgres:18.6-alpine3.24` container and named project volume | `127.0.0.1:15432`                  |

The frontend uses `PUBLIC_API_BASE=/v1`, so browser requests stay same-origin and nginx proxies them to the private Compose network. This makes the production service-worker/offline behavior meaningful. Database migrations run through the backend's existing startup `AutoMigrate` path; no production endpoint or database is used.

## Commands

Run from the repository root. `start` and `stop` preserve data; `reset` and `clean` require the explicit `--yes` safety flag.

```sh
scripts/test-stack/manage.sh start          # start, reusing the existing test database
scripts/test-stack/manage.sh reset --yes    # destroy ONLY this stack, recreate empty DB, new accounts
scripts/test-stack/manage.sh status         # containers, volume, health, URLs, row counts
scripts/test-stack/manage.sh logs           # follow all logs
scripts/test-stack/manage.sh logs backend   # one service
scripts/test-stack/manage.sh stop           # stop containers; preserve DB and credentials
scripts/test-stack/manage.sh clean --yes    # remove ONLY this stack and runtime credentials
scripts/test-stack/manage.sh accounts       # print disposable credentials
scripts/test-stack/manage.sh sample         # optional forum and training sample data
scripts/test-stack/manage.sh check-api      # real API checks; adds synthetic data
scripts/test-stack/manage.sh check-guided   # complete a real guided lesson in Chromium
scripts/test-stack/manage.sh smoke          # cross-browser navigation/login/offline/audio smoke
```

After a Mac restart, start Docker Desktop and run `manage.sh start`. The named volume and mode-600 runtime credentials remain on disk until `reset --yes` or `clean --yes`.

## Test accounts

`start` creates two disposable accounts through the public registration endpoint, then marks them verified with a scoped SQL update. External email is intentionally unavailable, so this verification shortcut is required for forum writes. The credentials are generated locally and written to `scripts/test-stack/runtime/accounts.json` with mode `600`.

```sh
scripts/test-stack/manage.sh accounts
```

Do not commit that file, copy the credentials into production, or reuse them outside this environment. A newly registered manual account remains unverified and cannot post to the forum; that is the real application behavior, not a stack failure. Email delivery itself requires a Resend credential and is outside this environment.

## Exact resources and safety scope

The Compose project is `ditpath-final-acceptance`. Its fixed container names are:

- `ditpath-final-acceptance-frontend`
- `ditpath-final-acceptance-backend`
- `ditpath-final-acceptance-db`

It owns the named volume `ditpath-final-acceptance_postgres-data`, project-scoped networks `ditpath-final-acceptance_edge` and `ditpath-final-acceptance_internal`, and generated state under `scripts/test-stack/runtime/`.

`reset --yes` and `clean --yes` list the containers, volumes, networks and runtime path before removing them. They use either project-scoped Compose `down -v` or label-filtered removal, never `docker system prune`, `docker volume prune`, broad `rm`, production Compose files, or other worktrees. Built backend images are retained for faster restarts; `clean` prints that fact. The shared `frontend/build/` output is not deleted.

Ports are dedicated and loopback-only: `13000`, `18080`, and `15432`. If one is already occupied, choose different values before the first `start` by setting `TEST_FRONTEND_PORT`, `TEST_API_PORT`, and `TEST_DB_PORT`; the values are persisted in `runtime/stack.env`.

## Audio measurement

The focused audio audit renders the application's real `buildAudioPlan` and `createWebAudioEngine` schedule into an `OfflineAudioContext` in Chromium, Firefox, and WebKit:

```sh
cd frontend
npm run audio:audit
```

It measures start delay, element durations, symbol/letter/word gaps, tone frequency, gain envelope, peak amplitude, sample discontinuities, final-tone truncation, and repeated-render consistency. Evidence is written to `.artifacts/audio-audit.json` (Git-ignored). This is measurement evidence; listening quality, speakers, Bluetooth routes, and operating-system interruptions still require the checklist below.

## Manual acceptance checklist

Use a fresh `reset --yes` before a clean pass. Use `sample` only when forum/history fixtures are wanted.

### First-run and navigation

- [ ] Guest Home explains the product and starts a first-sound preview.
- [ ] Desktop navigation reaches Home, Lessons, Practice, Progress, More, Forum, About, Settings, Login, Register.
- [ ] Mobile 390 px and 320 px layouts use the bottom navigation without horizontal overflow.
- [ ] More groups learning, community and personal destinations; theme/language remain in Settings.
- [ ] All five locales load: English, German, Japanese, Simplified Chinese, Traditional Chinese.
- [ ] Skip link, focus ring, keyboard traversal, Escape handling, and dialogs behave correctly.
- [ ] Light, dark and auto themes apply; reduced-motion preference suppresses motion.

### Lessons and guided sessions

- [ ] A new account starts at lesson 1 with only the intended characters.
- [ ] Introductions play the full sound before Continue becomes available.
- [ ] Recall, contrast, short-group and unscored prompts behave as labelled.
- [ ] Space replays the active prompt; Enter continues/submits only where appropriate.
- [ ] Locked lessons state their requirements; earned unlocks survive reload and sync.
- [ ] A completed lesson shows results, saves one session, and syncs to the account.
- [ ] Save & leave creates a continuation checkpoint; resume restores prompt, draft and frozen order.
- [ ] Restart/dismissal is explicit; an interrupted audio prompt is replayed, not silently scored.
- [ ] Two tabs cannot actively resume the same guided session.
- [ ] Finish for today returns to Lessons without duplicating the session.

### Continuous-copy practice

- [ ] Start, stop, pause, resume, replay and skip work and keep the progress clock coherent.
- [ ] Character WPM, effective WPM, frequency, start delay and volume changes affect playback.
- [ ] Dot/dash ratio, character, letter and word spacing sound correct at 5/5, 20/10, 20/20, 50/50.
- [ ] Typing works while audio is playing; checking freezes the passage and opens comparison.
- [ ] Another passage, lesson or context change protects unchecked work.
- [ ] Save & leave restores the exact passage, settings, context and draft after reload.
- [ ] Discard removes the checkpoint; a corrupt or stale checkpoint does not block a new practice.
- [ ] A second tab cannot resume a leased copy checkpoint.
- [ ] Practice history saves once and appears in Progress after retry/reload.
- [ ] All contexts work: groups, words, callsigns and synthetic contact exchange.

### Progress, profile and settings

- [ ] Progress overview, characters, history, seven-day totals and measured/unmeasured states are distinct.
- [ ] History rows show mode, status, speeds, accuracy and timing without mixing practice mastery.
- [ ] Profile identity, heatmap keyboard navigation, streaks and current-year habits render for guest and account.
- [ ] Account switching never shows another owner's local or downloaded history.
- [ ] Settings saves sound defaults, starting lesson, language and call sign with visible success/error states.
- [ ] The tone sample matches the saved frequency/speed and stops cleanly.
- [ ] Sync & storage distinguishes pending, rejected, blocked and synced records; manual sync and retry work.
- [ ] Cache clearing refuses pending/active work and preserves unclaimed import assignments as documented.
- [ ] Guest history import is explicit, one-account-only, and does not duplicate records.

### Authentication and isolation

- [ ] Register a new synthetic account; validation errors are localized and no real email is sent.
- [ ] Login with username and with email; wrong credentials show an error.
- [ ] Register/login rate limits return a useful wait message, not a crash.
- [ ] Logout returns to guest view and clears account-scoped rendered history.
- [ ] Switch A → B → A; each account sees only its own history, settings, forum identity and sync state.
- [ ] Session upload/download works for both accounts; history survives logout/login and reload.
- [ ] Password change requires the old password and invalidates older sessions.
- [ ] Call sign and email updates validate and report success/error.
- [ ] Email verification UI is inspectable, but actual delivery/verification needs Resend; do not claim it was tested here.
- [ ] Google sign-in is absent because `PUBLIC_GOOGLE_CLIENT_ID` and backend ID are empty; do not claim it was tested.

### Forum

- [ ] Browse threads and all categories as a guest.
- [ ] Open a thread, paginate replies, and read parent context.
- [ ] An unverified account sees the verification requirement instead of a successful post.
- [ ] A verified account creates a thread and reply; both appear for the other account.
- [ ] Forum rate limiting returns a useful wait message.
- [ ] Author deletion removes the thread/reply while preserving stable reply pagination.
- [ ] Empty, loading, not-found and API-error states are usable.

### Offline and interruption

- [ ] Visit Home, Lessons, Practice and Progress online once to install the service worker.
- [ ] Go offline; cached shells load and local practice/guided work can be created.
- [ ] Authenticated API requests fail rather than serving cached private data.
- [ ] Reconnect; pending work synchronizes and status returns to synced.
- [ ] Reload/close during unsaved work shows the native unload warning.
- [ ] Navigate away during playback; audio stops and no ghost playback continues.
- [ ] Rapid replay/start/stop does not overlap tones or leave an open AudioContext.
- [ ] Switch tabs, background the browser, return, and pause/resume; confirm audio and clock recover or expose an explicit error.
- [ ] Lock/unlock the Mac, change output device, or connect/disconnect Bluetooth; confirm no clipping, stuck tone or silent success state.

### Error and recovery

- [ ] Backend unavailable: pages retain local/offline data, show retry/error status, and recover after `start`.
- [ ] Database unavailable/restarting: API health fails cleanly; no false success or duplicate records.
- [ ] A rejected sync record is visible as rejected and does not block unrelated records.
- [ ] A failed device save offers retry and records exactly one row after success.
- [ ] Missing/invalid forum thread shows a not-found state rather than a blank page.

## Known limits

- Google sign-in, real email delivery/verification, Cloudflare/public tunnel, pgAdmin and production deployment are intentionally not configured.
- The stack is loopback-only and is not available to phones on the LAN or over the internet.
- iOS Safari, Android Chrome, screen readers, Bluetooth, sleep/wake and real speakers require native-device testing.
- Offline Web Audio still needs a user gesture and a working local audio output; headless automation measures scheduling, not perceived quality.
- The audio audit validates the signal generated by Web Audio. It cannot prove that a particular speaker, headphone, DAC or OS mixer is free of clipping or distortion.
