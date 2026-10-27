# Main publication verification — 28 October 2026

The owner authorized completing verification, merging PR #2 and publishing the tested `dev` result to `main`. Implementation and fixes stayed on `dev`; the unrelated changes in the primary `main` checkout were not touched. No force push, rebase, dependency addition, deployment, production migration or running tunnel update was performed.

## Changes reviewed

- Merged [PR #2](https://github.com/0x5916/Morse/pull/2), exact head `ec62882b9778cdfd3f89614f9306aa5cd2f9f205`, into `dev` as `d9fcca0`. The audio engine now has a silent lead-in and latency-aware output tail; progress excludes the lead-in. Existing evidence capture remains intact.
- Corrected three PostgreSQL test assertions that compared equivalent timestamp instants using host-dependent string offsets. Timestamp precision, response shape, immutable history and activity assertions remain enforced. Application behavior and API contracts are unchanged.
- Added the requested cloudflared update reminder to the owning [deployment guide](../../../DEPLOYMENT.md#cloudflared-security-update-reminder), including pull/recreate/version/connection checks. Latest stable verified during this pass: 2026.10.5. A source push does not update a deployed connector.

## Verification

| Check                                                               | Result                                                                                                                         | Exit |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Frontend `npm run verify` with the explicit local API build setting | 768 tests, 62 files; 663 message keys in five locales; SEO, Svelte and worker/script types passed; zero Svelte errors/warnings | 0    |
| Frontend `npm run lint`                                             | Formatting and ESLint passed                                                                                                   | 0    |
| Frontend `npm run build`                                            | Static production build passed                                                                                                 | 0    |
| Disposable PostgreSQL migration-preservation test                   | Passed before the full database suite                                                                                          | 0    |
| Backend `go test -json -count=1 -p 1 ./...`, Singapore timezone     | 1,275 tests/subtests, 13 tested packages; zero skipped test cases; one additional package has no tests                         | 0    |
| Three corrected database tests, UTC timezone                        | All three passed                                                                                                               | 0    |
| Backend race checks: handlers/v2 and learning                       | 330 tests/subtests, two packages passed                                                                                        | 0    |
| Backend `go vet ./...`                                              | Passed after the test corrections                                                                                              | 0    |
| Final diff whitespace and PR-head ancestry                          | Passed                                                                                                                         | 0    |

The initial frontend test startup lacked its required `PUBLIC_API_BASE`; it passed after supplying the documented local setting. The initial backend run reproduced the three timezone-sensitive assertions; the final full Singapore suite and focused UTC checks passed after correction. An interrupted edit briefly caused a test compile error; it was corrected before the final passing suite. No failing check was bypassed.

Operational fixtures: `python3 scripts/tests/test-operations.py` exited **0** with **31 passed and one skipped** (32 cases). Native Bash 4 is unavailable on this Mac; the runner used its documented Bash 3 compatibility copies and skipped the native Bash 4 gate. These fixtures use copied scripts and stubbed services, never the live application database. This skip is not native Linux operations acceptance.

## Browser acceptance

Safari exercised the built application on isolated loopback port 4185, using new local guest data:

- Home K/M preview reached quiz readiness. A guided lesson started, played K, continued with Enter, saved at prompt 2, restored paused at prompt 2 and resumed Meet M.
- Words copy practice started, preserved `TEST COPY` through Save & leave and a fresh page navigation, restored the same contextual mode and draft, and checked with Enter. The result showed Words and local save confirmation; Escape dismissed the modal and returned focus to the textarea. Progress showed exactly one completed practice.
- At 390 CSS px, Home, lesson and copy flows had no horizontal overflow; lesson controls measured at least 48 px high. The modal used labelled modal semantics and textual comparison feedback. Desktop Progress at 1280 px and German Practice at Safari's actual minimum 336 px also had no horizontal overflow. The German primary action measured 48 px high and its help button 44 px.
- Safari logged its unsupported `interactive-widget` viewport warning; no application JavaScript exception was observed. The audio walkthrough establishes playback lifecycle behavior, not a human judgement of sound quality.

Evidence screenshot: `final-safari-copy-mobile.png` in this task's visualization artifacts. Existing Penpot designs and IDs were preserved; this packet adds no UI redesign.

## Remaining external acceptance

Native-device IME, VoiceOver/TalkBack, physical Firefox focus, native text scaling/rotation and audible-quality checks still require the relevant devices and human observation. Genuine two-profile client-to-service offline/late-evidence acceptance, long-history/clock/suspension exercises and delayed learner validation remain separate rollout gates from the [implementation report](2026-10-28-roadmap-completion.md). The tests above do not claim to replace them. Publishing source to `main` does not deploy or close these gates.
