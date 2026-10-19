# Cross-device training history: approved V1 specification

Status: approved design; V1 cross-device implementation present. Release validation and V2 retirement remain gated. The human repository owner approved revision 2 on 20 October 2026 and subsequently authorized implementation. This document records that approved contract; the [API reference](../API.md) and [current training contract](training-events-v2.md) describe implemented behavior.

## Current packet and scope

Implemented packets: the existing event batch, snapshot, and training-settings capabilities are canonical under `/v1/training`, with temporary `/v2/training` aliases. V1-only session batch upload and paginated history now store native guided/practice terminal records, derive guided scores, enforce immutable manifests across both event paths, and return fixed-revision summaries. Additive startup migration supplies session/revision/change storage; bounded account bootstrap preserves legacy progress and orphan attempts, while legacy PUT atomically mirrors new summaries. Strict event schema 2 and V1-only change downloads now restore committed session/attempt evidence through signed checkpoints. The frontend implements account partitions, atomic outbox/download transactions, explicit import journals, and account-fenced synchronization after saves, login, reconnect, and app return. Existing API shapes, schema-1 retries, settings and legacy read behavior remain compatible. V2 alias retirement remains future release work; implementation does not authorize deployment or removal before its compatibility gate.

The target is one permanent V1 API and the existing PostgreSQL database. Preserve Go, SvelteKit 3/Svelte 5, the static adapter, bearer authentication, existing data, and supported legacy contracts. No dependency additions or deployment changes are included.

Included: completed/abandoned guided sessions, checked practice passages, individual guided attempts (including unfinished lessons), offline saves, account isolation, explicit device-history import, and cross-device evidence restoration. Unchecked practice stays unrecorded. Exact continuation of unfinished lessons, practice transcripts/audio, synchronized result editing, and cloud-history deletion are outside this release.

## Permanent routes and payload versions

All routes require the existing bearer authentication and user-loading middleware. Existing authentication, user, forum, and settings contracts remain active.

| Method and path | Contract |
| --- | --- |
| `POST /v1/training/events/batch` | Guided attempt upload; existing payload schema 1 plus strict schema 2. |
| `POST /v1/training/sessions/batch` | New terminal guided/practice history. |
| `GET /v1/training/sessions` | New paginated history and optional complete-period totals. |
| `GET /v1/training/changes` | New account session/attempt download feed. |
| `GET /v1/training/snapshot` | Existing reduced lifetime mastery snapshot and seeded course-position semantics. |
| `PUT /v1/training/settings` | Existing full settings update, including daily goal and `updated_at` response. |
| `GET`, `PUT /v1/cw/progress` | Existing legacy progress contracts retained. |

HTTP namespace and payload `schema_version` are independent: strict event schema 2 uses `/v1`. Existing event fields, bounds, snapshot policy, and settings validation are owned by the [current contract](training-events-v2.md), [request types](../internal/common/input.go), [response types](../internal/common/response.go), and [handler validator](../internal/handlers/v2/training.go).

Existing V1 settings writers preserve `target_daily_minutes` when omitted; read shapes remain unchanged. This release adds no training-settings GET. The snapshot cannot replace downloaded raw evidence or provide a cursor that skips its history. Retain current 30-day session and 60-day Lessons/Progress evidence windows; the snapshot remains lifetime-based.

## Ownership, identity, and session input

Ownership comes exclusively from the authenticated account; reject client-supplied `user_id`. Session/event IDs are stable nonblank strings of at most 128 UTF-8 bytes and unique within the account. Generate collision-resistant UUIDs for new records (type prefixes allowed), preserve imported IDs, and reserve `legacy:` for server-created records. Installation `client_id` is diagnostic metadata, never ownership/deduplication.

Session batches have envelope `schema_version: 1`, installation UUID `client_id`, optional diagnostic `client_sent_at`, and 1–20 `sessions`, within 256 KiB JSON. Each native session has:

| Fields | Accepted meaning |
| --- | --- |
| `session_id`, `mode` | Stable ID; `guided` or `practice`. |
| `curriculum_version`, `lesson` | Initially `koch-39-v1`, lesson 1–39. |
| `status` | `completed` or `abandoned`; practice only completed. |
| `started_at`, `ended_at` | RFC3339 start required; completion end required; abandoned end may be null. |
| `char_wpm`, `eff_wpm`, `freq_hz` | Integer speeds 5–50, effective ≤ character speed; frequency 300–2000 Hz. |
| `prompt_count`, `attempt_count` | Planned prompts 1–1000; recorded responses 0–prompt count. |
| `event_ids` | Unique guided IDs, at most 1000; frozen manifest at finalization. |
| `accuracy`, `scoring_version` | Practice inputs: finite score 0–1 and initially `practice-copy-v1`. |

Guided manifests include unmeasured matching attempts, equal the entire stored account/session event-ID set, and have length `attempt_count`. Introductions count as prompts but currently produce no attempts: completion does not require attempts equal prompts. The server derives guided scored/correct counts and accuracy from non-`unmeasured` evidence, rounded to three decimal places; no scored attempts means null accuracy. Completion alone grants no mastery/unlock.

Practice uses counts 1/1, an empty manifest, and its client-reported passage score. It creates no guided attempts and never contributes to guided mastery. A practice session ID already associated with guided evidence cannot finalize.

Practice elapsed time runs from first successful playback to Check; guided time runs from start to observed completion/abandonment, including pauses/replays. Unknown interruption end times stay null; never substitute next-login time. Recorded elapsed time is not active listening time.

## Retry, conflict, and transaction contract

New clients upload/acknowledge guided events before terminal metadata. Terminal sessions and finalized guided manifests are immutable. Identical account/ID/content retries acknowledge the original; changed terminal content returns `ID_CONFLICT`, never an overwrite. Normalize timestamps/nulls/numbers and compare manifests as sets; JSON whitespace/property order has no semantic effect. Hashes aid comparison, not define equality.

Event schema 1 retains first-write-wins duplicate acknowledgements. Schema 2 acknowledges identical events and rejects changed content as `ID_CONFLICT`; new sync clients use schema 2. Existing event-only/orphan sessions remain valid evidence, without fabricated completion records.

Finalized practice cannot receive guided events. Finalized guided sessions cannot receive IDs outside their manifest. These session-integrity rules apply to every upload path and both payload schemas for enrolled sessions. Missing events yield retryable `MISSING_SESSION_EVENTS`; unexpected stored events yield permanent `SESSION_EVENT_SET_CONFLICT`.

Session responses contain `acknowledged_ids` and `rejected_sessions`; each rejection has `id`, `error_code`, `message`, `retryable`. Valid siblings may succeed. Identical repeated IDs collapse to one acknowledgement; conflicting repetitions reject that ID. Permanent rejection remains visible without blocking unrelated uploads.

Every event/session insertion, legacy mirror, and backfill uses the same account transaction boundary:

1. Begin; create/lock that account's `training_sync_state` row.
2. Validate identity/conflicts and session-kind/manifest consistency.
3. Insert valid new records; allocate one account revision per inserted record and append immutable change payloads.
4. Update activity from canonical stored records; preserve course-position fields.
5. Commit before returning acknowledgements. Duplicates allocate no new revision.

Database failure rolls back otherwise-valid transaction members and returns no success acknowledgements. The shared account lock serializes concurrent writers and prevents event/finalization races. Activity reflects stored evidence, not newly submitted conflicting retry timestamps.

## Additive database design

Retain `lesson_progress`, `training_events`, `training_profiles`, `cw_settings`, `page_settings`, their identifiers, and other application data. Removing V2 URLs does not require dropping/renaming tables or frontend `training/v2` modules.

Add `training_sessions` with account deletion cascading through its user FK:

| Columns | PostgreSQL types / constraints |
| --- | --- |
| `id`, `user_id`, `session_id` | Server UUID PK, required UUID user FK, text client identity; unique `(user_id, session_id)`. |
| `schema_version`, `mode` | Smallint; text guided/practice, nullable only for unknown legacy mode. |
| `source_kind`, `source_record_id`, `client_id` | Native/legacy_v1 text provenance; original legacy row UUID required for legacy; optional installation UUID. |
| `curriculum_version`, `lesson`, `status` | Text, integer, text classification; preserve original legacy lesson values. |
| `char_wpm`, `eff_wpm`, `freq_hz` | Integer settings; native bounds above, unknown legacy settings nullable. |
| `started_at`, `ended_at`, `occurred_at` | Nullable measured timestamptz values; required stable occurrence time. |
| `occurred_at_source` | Text: client end/start, legacy client completion, or legacy server receipt. |
| `prompt_count`, `attempt_count`, `event_ids` | Integer counts (nullable for legacy), bounded JSONB array; empty for practice/legacy. |
| `scored_attempt_count`, `correct_attempt_count`, `accuracy` | Nullable integer counts and finite double precision 0–1 score. |
| `scoring_version`, `payload_hash` | Text interpretation (guided recognition/practice copy/legacy summary); bytea SHA-256 normalized semantic input. |
| `sync_revision`, `received_at` | Account bigint revision; server insertion timestamptz. |

Require unique legacy mapping `(user_id, source_kind, source_record_id)`, history index `(user_id, occurred_at DESC, id DESC)`, and filter index `(user_id, mode, status, occurred_at DESC, id DESC)`.

Extend `training_events` with normalized payload hash, sync revision, and `(user_id, session_id)` index, retaining account/event uniqueness. No mandatory parent-session FK: attempts may precede terminal metadata.

| New table | Columns / constraints |
| --- | --- |
| `training_sync_state` | `user_id` UUID PK/FK; `last_revision` bigint default 0; `feed_epoch` integer default 1; `backfill_complete` boolean. |
| `training_changes` | `user_id`, bigint `revision`, text `kind` (session/attempt), text `record_id`, immutable JSONB `payload`; PK account/revision; unique account/kind/record. |

Retain synchronized history while the account exists; no automatic expiry/feed compaction in this release. Native occurrence time is end when known, otherwise start. Legacy time uses original client completion when available, otherwise original server receipt. Unknown measurements never produce invented durations.

## Read and cursor contracts

`GET /v1/training/sessions` accepts `mode=all|guided|practice|legacy` (all), `status=completed|abandoned|all` (completed), optional inclusive `from`/exclusive `to`, `limit` (20, maximum 100), opaque `cursor`, and `include_summary` (false).

Sort by `(occurred_at DESC, server ID DESC)`. Cursors bind account, filters, and fixed committed revision high-water mark. Rows and summaries use that mark. Summary covers the whole matching range, independently of the page: completed counts by mode, completed sessions with measured timing, and total recorded elapsed milliseconds. Recognition remains attempt-derived.

Known completion determines activity date; otherwise known start, with labeled legacy receipt fallbacks. Group calendar days in UTC; localize display timestamps. Rolling seven days uses `[T − 7 days, T)`.

`GET /v1/training/changes` accepts cursor and limit (default/max 100), also bounded to 1 MiB for the complete JSON response. Return `changes` with string `revision`, `kind`, `record`, plus `next_cursor`, `has_more`. String revisions preserve JavaScript precision.

Bootstrap starts from revision zero at a captured committed high-water mark. Page ascending account revisions up to that mark; draining checkpoints it, and the next request captures newer commits. Cursor advancement follows server commit order, never client timestamps, so late offline records are included. Signed cursors bind account, feed epoch, last emitted revision, and ceiling; session-history and change cursors have separate signing domains. Every page returns `next_cursor`, including empty/drained checkpoints. Wrong-account/malformed cursors return 400; retired epochs return `410 TRAINING_CURSOR_RESET_REQUIRED`. Rebootstrap preserves pending local work.

## Client persistence and ownership

Implemented boundaries are [owned persistence](../../frontend/src/lib/data/owned-training.ts), [transactional sync repository](../../frontend/src/lib/data/training-sync-repository.ts), [wire adapter](../../frontend/src/lib/training-wire.ts), [sync engine](../../frontend/src/lib/training-sync-engine.ts), and [browser runtime](../../frontend/src/lib/training-sync.svelte.ts). Backend [event validation](../internal/handlers/v2/training_strict.go), [download handler](../internal/handlers/v2/training_changes.go), and [history serializers](../internal/training/history_store.go) define their server counterparts.

Use owner partitions `account:<immutable user ID>` and separate guest/unclaimed history. IndexedDB keys: attempts/sessions `[owner_key,id]`, mastery `[owner_key,character]`, outbox `[owner_key,kind,id]`, metadata `[owner_key,key]`. A durable import journal keys source installation/kind/record and assigns one destination account.

Capture ownership before training. Atomically commit each attempt, session count, and outbox entry; atomically commit terminal metadata, frozen manifest, and outbox entry. Atomically commit each download page and its cursor. Downloads merge without re-enqueueing. Remove queued work only when acknowledgement matches original owner and frozen submitted payload.

Account switching pauses training, cancels account network work, clears the previous account's rendered view, and retains pending records under their original owner. All asynchronous stages must retain that ownership check. Lessons, Progress, and Profile read the same account partition.

Synchronize after local saves, login, reconnect, and returning to the app; retry temporary failures with backoff. Local success means “Saved on this device”; cloud success requires terminal and required evidence acknowledgements. Cache clearing explains redownload and cannot silently discard pending uploads.

## Migration and compatibility cutover

Move existing unowned IndexedDB history to unclaimed storage, preserving IDs; absent mode on current local session records still means guided. Import requires explicit account choice and durable journal, making repeated imports safe.

Backfill existing guided attempts (including orphans) and legacy summaries into the feed before account bootstrap. Legacy rows map once to `legacy:<original-row-UUID>`, preserving provenance/unknown mode and nullable missing settings, timing, and evidence. Backfill is bounded/resumable. New reads return retryable `503 TRAINING_SYNC_INITIALIZING` until account backfill finishes.

Keep legacy GET response shapes, lesson-as-string, pagination, server-receipt ordering, UTC annual counts, and latest 20 overall in annual summary. Keep legacy PUT request and 201 response. Legacy PUT atomically writes the original row plus unified mirror. New clients stop old progress uploads; native sessions are not copied into `lesson_progress`. Legacy and unified views must not be added together.

Preserve unresolved legacy localStorage queue entries separately. The old API sent no stable idempotency key; lost responses cannot be deduplicated retrospectively. Never auto-resubmit ambiguous entries or guess matches from score/timestamp.

Introduce V1 replacements first. Temporarily route the three old V2 URLs to the same service with identical auth, legacy payloads/responses/errors, and schema-1 duplicate behavior; never redirect authenticated writes. Migrate supported consumers and inspect deployed usage, snapshot, settings, and upload behavior. Unregister V2 aliases only after an agreed compatibility window and release approval; no retirement date is specified. Stored data remains available through V1 after retirement.

## Errors and acceptance

Envelope errors retain `{code,error}`: 400 invalid input/schema/query/cursor; 401 existing authentication failure; 413 payload size; 410 cursor reset; 429/5xx temporary failures retain pending work and honor `Retry-After`. Batch record errors remain in rejection arrays.

Acceptance: both modes and guided evidence restore on another device; practice never changes mastery/unlocks; introductions do not fail counts; offline/crash/reconnect/lost-response retries duplicate nothing; concurrent commits/late uploads lose no feed changes; download/cursor interruption replays safely; account switching/multiple tabs never mix owners; totals cover full ranges; imports repeat safely; legacy unknowns stay unknown; old contracts/daily-goal settings survive; V2 consumers migrate before alias removal.
