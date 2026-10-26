# Isolated live-sync acceptance — 26 October 2026

The user approved the isolated stack proposed in the [previous increment](2026-10-26-ui-acceptance.md#next-environment-increment--approval-required). This packet verifies the existing V1 contracts and UI against disposable accounts. Native-device acceptance remains open.

## Deployment and acceptance boundary

- App source: `ac25e578f4117e8ad8215cb094afed34a6318953`; deployment tooling milestone: `1e4f355`. Source archive SHA-256: `a9aebfe41ab0066943ed76a923c2f9574acb6c50bc12bb73eadf099b9dd1e4b1`, verified after transfer.
- Host `pve-104`, directory `/opt/ditpath-ui-acceptance`, Compose project `ditpath-ui-acceptance`. Existing migrations initialize only its fresh database. See the owning [deployment guide](../../../DEPLOYMENT.md#isolated-ui-acceptance-stack) for configuration and commands.
- Only nginx publishes loopback ports 3001/8081. Backend/PostgreSQL stay on an internal Docker network; external email and Google sign-in are disabled. Desktop access uses SSH forwarding. No Cloudflare token or public test hostname was used.
- Acceptance: preserve the existing stack; verify authenticated settings/history, idempotent uploads, owner isolation, actual browser save/retry, fresh-storage restore, and disposable import/cache controls. No application API, schema or authentication behavior changed.
- Original container IDs remained unchanged and running: database `5e78504e34ac`, backend `ab4fd4d7054a`, frontend `1a9935e8784c`, pgAdmin `4e40adc81159`. Their `/data/postgres` storage was not used for this packet.

## Live evidence

Chromium 156 in the Codex in-app browser, macOS, synthetic A/B accounts only:

- A restored Lesson 2 at 24/12 WPM and 650 Hz; B restored Lesson 3 at 18/12 WPM and 550 Hz. Switching accounts showed each account's own history and mastery.
- A completed two browser Practice results (11% and 3%). The second was saved while the isolated backend was stopped. Settings eventually reported that history could not sync and saved records were retained. Restarting that same backend, then choosing **Sync now** / **Try again**, restored settings and displayed **Synced across your devices**.
- Independent API reads found exactly one copy of each browser session in A and neither in B. The outage session ended at 03:50:26 UTC and reached the server at 03:52:19 UTC. A had five sessions, including three synthetic API-created sessions.
- A fresh `localhost:3001` origin restored all five A sessions and A's sound settings from the server while `127.0.0.1:3001` held B. These origins have separate browser storage; this is not evidence from a separate browser profile or engine.
- B's cache confirmation supported Cancel, then Confirm clearing. **Sync now** restored its one server record. A guest Practice session then remained unclaimed until the explicit **Import history from this device** action; afterward B had two records and A remained at five. API reads confirmed exactly one imported record in B, absent from A, with no duplicates.
- Local screenshots: `live-sync-outage.jpg` and `live-sync-progress.jpg` in this chat's visualization directory. Penpot's acceptance board was updated and visually inspected; version **Isolated live-sync acceptance · ac25e57**. The [design manifest](2026-10-26-daily-training-design.json) distinguishes app and deployment revisions. Product frames remain aligned with the unchanged app revision.

## Checks

| Check                                                                  | Result                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Compose config, source transfer/hash, image builds and final health    | Exit 0                                                                                            |
| Frontend Docker build: `npm run verify` and `npm run build`            | Exit 0; 588 tests / 49 files; Svelte 0 errors / 0 warnings; static build succeeded                |
| `go test -json -p 1 ./internal/databases` on new database              | Exit 0; 17 test/subtest passes, no skipped tests                                                  |
| `go test -json -p 1 ./...`                                             | Exit 0; 1,225 test/subtest passes, no skipped tests; 12 package passes, one package without tests |
| `go vet ./...`                                                         | Exit 0                                                                                            |
| `check-api.py --output-dir /private/tmp/ditpath-ui-acceptance-runtime` | Exit 0; 21/21 live assertions                                                                     |
| Read-only API reconciliation after browser recovery / import           | Exit 0; 4/4 recovery assertions and 5/5 import assertions                                         |
| Python syntax / `git diff --check`                                     | Exit 0; both Python files compile                                                                 |

Build and Go logs are under `/opt/ditpath-ui-acceptance/evidence/`. Local JSON evidence and mode-0600 disposable credentials are outside Git in `/private/tmp/ditpath-ui-acceptance-runtime/`; credentials/tokens are not included in reports. Local `npm run lint` also exited 0 after the documentation changes, using Node 26. No frontend source changed.

Initial failures were resolved: publishing an internal-only Docker network did not expose the requested ports, so nginx alone now joins an access bridge; the API checker incorrectly coupled unchanged mastery with course position, which the first upload legitimately seeds from saved page settings. The corrected assertion compares mastery. A local bytecode-cache permission failure was replaced by an in-memory syntax check. All final checks above passed.

## Remaining acceptance

- **Request timeout:** a real outage exposed prolonged loading. `auth.ts`, `api.ts` and the sync engine have no application deadline. A focused frontend packet should bound stalled requests, provide a retry action, preserve pending records and account ownership, and test a never-settling transport plus recovery. Synchronize that recovery state in Penpot before implementation; preserve authentication semantics.
- **Actual devices:** Android/Chrome soft keyboard, composition, first-tap audio, interruption/return, rotation, larger text and TalkBack still need the offered phone. iOS/Safari and other unavailable engines remain unverified. Arrange phone-reachable test access separately; the current SSH-loopback URL works only on the forwarded desktop.
- **Independent browser profile:** fresh-origin restoration passed, but a genuine second profile/device remains required. Registration/email verification remains fixture-only because this isolated stack has no test mail integration.

This closes the isolated environment and live-service increment, not the overall UI/UX acceptance plan. Final commit verification must include an empty `git status --short`.
