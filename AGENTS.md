# DitPath agent rules

This repository contains the sound-first DitPath trainer. See [README.md](README.md) for the project map and document ownership; read [frontend/AGENTS.md](frontend/AGENTS.md) before frontend work.

## Boundaries

- Keep SvelteKit 3 with Svelte 5, the static adapter, and the Go backend. Do not migrate frameworks or runtimes.
- Implement one discrete packet per session with explicit acceptance criteria and targeted checks, typically fewer than 400 changed lines.
- Never force-push, reset across uncommitted work, or clean untracked files without confirmation.
- Backend database schemas, endpoints, authentication semantics, and deployment configuration require an approved API specification and explicit authorization before alteration.
- Do not add external dependencies without approval.
- Never declare completion without capturing command exit codes, test counts, and `git status --short`. Report blocked or failing checks accurately.

## Commands

Run frontend commands from `frontend/` with Node 26 on `PATH` (for example, `export PATH="/opt/homebrew/opt/node/bin:$PATH"`). Run backend commands from `backend/` with the Go version declared in [go.mod](backend/go.mod).

| Subsystem  | Checks                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------- |
| Frontend   | `npm run verify`, `npm run lint`, `npm run build`; focused `npm run test -- <test-path>` |
| Backend    | `go test ./...`, `go vet ./...`                                                          |
| Operations | `make check` validates `.env`; `make status` reports service health and disk usage       |

Use the [frontend guide](frontend/README.md) for individual gates and the [script reference](scripts/README.md) for operational options. Do not run deploy, update, restore, or database-changing commands as documentation checks.

## Documentation maintenance

Keep each concern in its owning guide. Link to source types, validators, and scripts instead of copying implementation or repeated examples. Separate current behavior from acceptance requirements and future work. Update links when consolidating files; do not edit generated Paraglide output, dependency documentation, or bundled skill instructions as project documentation.
