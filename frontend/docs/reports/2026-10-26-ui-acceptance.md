# UI acceptance increment — 26 October 2026

This packet adds repeatable acceptance states and fixes the keyboard defect they exposed. It does not close the native-device, screen-reader or live-sync acceptance gates in the [remaining plan](../ui-ux-audit.md#final-uiux-acceptance-pass--proposed-26-october-2026).

## Delivered

- `b814db9`: isolated acceptance launcher, eight synthetic scenarios and five behavioral tests. See [frontend setup](../../README.md#checks-and-builds). No dependencies or production fixture imports were added.
- `ac25e57`: include native `summary` controls in dialog focus traversal. Before the fix, forward Tab cycled Close → Source → Close and skipped the Practice completion actions. After the fix, Source → Retry saving works on failure, and Close → Source → Another passage → Finish works after saving; reverse traversal also works.
- Penpot adds an acceptance map and separate unchecked-copy / unsaved-result leave confirmations. Prototype cleanup removes heading/background interactions and self-links; 50 navigation links resolve, with zero broken or self-referential links. Static-interaction limits are explicit. The [manifest](2026-10-26-daily-training-design.json) records source commits, board IDs and the saved version. Existing neutral captures retain their original source revision.

## Verification

Node 26, local Chromium in-app browser, synthetic database only. All eight chooser entries were exercised: empty Home/Progress; returning Lesson 2 recommendation; interrupted-lesson Restart; all 39 lessons unlocked / 40 characters complete; visible loading followed by populated history; save failure → Retry saving → saved → Finish; unavailable account settings; retained local history with failed account sync. Repository tests additionally verify owner isolation and no duplicate session on retry.

| Check                                                     | Result                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| Focused fixtures                                          | Exit 0; 5 tests / 1 file                                   |
| Fixtures + dialog boundaries after fix                    | Exit 0; 10 tests / 2 files                                 |
| `PUBLIC_API_BASE=http://127.0.0.1:4174/v1 npm run verify` | Exit 0; 588 tests / 49 files; Svelte 0 errors / 0 warnings |
| `npm run lint`                                            | Exit 0                                                     |
| `PUBLIC_API_BASE=http://127.0.0.1:8080/v1 npm run build`  | Exit 0                                                     |
| `git diff --check`                                        | Exit 0                                                     |
| Production fixture-marker search                          | No matches (`rg` exit 1)                                   |

The first focused test invocation lacked `PUBLIC_API_BASE` and stopped before tests. The first fixture seam test found an incorrect source path; that was corrected before the passing runs. Local server binding and Git worktree metadata needed sandbox escalation, which was granted. No Svelte source changed in this increment.

Keyboard evidence is saved locally as `acceptance-result-keyboard.jpg` in this chat's visualization directory. No personal activity was uploaded to Penpot. Viewport simulation is not native Android or screen-reader evidence.

## Next environment increment — approval required

Read-only SSH inspection of user-provided `pve-104` succeeded (exit 0). `/opt/opencw` is revision `e7e3194`, an October 9 snapshot; its frontend responds HTTP 200, but `/v1/training/changes` responds HTTP 404. The running stack mounts `/data/postgres`. `/opt/opencw-validation` contains earlier validation artifacts, not a running current-version API. One SSH attempt timed out; the retry succeeded. No remote service, database or configuration was changed.

Proposed reviewable scope for the next increment:

1. Package code revision `ac25e57` into `/opt/ditpath-ui-acceptance` on `pve-104`, using a separate Compose project `ditpath-ui-acceptance` and a fresh database under that directory. Preserve `/opt/opencw`, `/data/postgres`, and the existing containers.
2. Build the existing frontend/backend with the current [training-history V1 contract](../../../backend/docs/training-history-v1-spec.md). Initialize only the new test database through existing startup migrations. Use new test-only secrets and disposable A/B accounts; disable external email/Google configuration unless a dedicated test integration is supplied.
3. Bind the new frontend/API to available loopback ports (proposed 3001/8081), keep PostgreSQL private to the test network, and verify through SSH forwarding. Do not publish a Cloudflare tunnel yet. Confirm available ports/resources before starting.
4. Verify account switching, returning settings, local save → server acknowledgment, retry, and second-profile history. Import/cache tests touch only the new disposable records.
5. Arrange phone access after the stack passes local checks. Record the actual Android/Chrome versions, typing/composition, first-tap audio, background/return, rotation, larger text and TalkBack results. iOS and other unavailable browsers remain separate evidence gaps.

This requires explicit authorization because the root [AGENTS.md](../../../AGENTS.md) reserves deployment configuration and database changes for approval. SSH access alone was used for inspection. A Cloudflare token is unnecessary for the initial forwarded checks; any later public test URL is a separate exposure decision.
