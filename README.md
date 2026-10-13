# DitPath

DitPath is a sound-first Morse code trainer with guided Koch lessons, free practice, local progress, optional account sync, and a community forum. Existing deployment identifiers and repository URLs retain their legacy names.

## Start developing

The frontend requires Node 26; the backend requires the Go version declared in [go.mod](backend/go.mod) and PostgreSQL. Run each subsystem from its own directory:

```sh
cd frontend
npm ci
cp example.env .env
npm run dev
```

Set `PUBLIC_API_BASE` in the frontend environment to the backend's `/v1` URL. Guided training stores events locally in IndexedDB; account and forum features need the API. Follow the [backend setup](backend/README.md) to start it.

## Documentation

| Guide                                                  | Owns                                                |
| ------------------------------------------------------ | --------------------------------------------------- |
| [Frontend](frontend/README.md)                         | Setup, scripts, static build, localization          |
| [Learning architecture](frontend/docs/learning.md)     | Training, timing, storage, UI acceptance rules      |
| [UI backlog](frontend/docs/ui-ux-audit.md)             | Source findings and remaining design work           |
| [Backend](backend/README.md)                           | Local API development and tests                     |
| [API](backend/API.md)                                  | Registered endpoints and request/response contracts |
| [V2 training sync](backend/docs/training-events-v2.md) | Batch ingestion, snapshots, idempotency             |
| [Deployment](DEPLOYMENT.md)                            | Host setup, configuration, exposure, recovery       |
| [Operational scripts](scripts/README.md)               | Commands, flags, safety behavior                    |
| [Database tuning](db/README.md)                        | Resource detection and PostgreSQL overrides         |
| [Agent rules](AGENTS.md)                               | Repository boundaries and verification evidence     |

For the full stack, configure the root `example.env` as `.env`, then follow the deployment guide. `make` lists operational commands; `make check` validates configuration. Do not substitute the backend development Compose file for the root deployment stack.

## Architecture

`frontend/` uses SvelteKit 5, TypeScript, Tailwind CSS v4, Paraglide, and the static adapter. `backend/` uses Go, Gin, and GORM. `db/` supplies PostgreSQL tuning; `scripts/` supplies operational automation. The root `docker-compose.yaml` connects these services, pgAdmin, and Cloudflare Tunnel.

## License

DitPath's original code and documentation are licensed under the [Apache License 2.0](LICENSE.md). Copyright 2026 Alan; see [NOTICE](NOTICE).

Third-party dependencies and bundled materials retain their own licenses and notices, including [PGTune](db/PGTUNE-LICENSE) and the bundled [agent skills](.agents/skills/). These materials are not relicensed by the project license. Bundled agent skills and generated/dependency documentation are separate from the project guides above.
