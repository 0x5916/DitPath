# DitPath V1 training synchronization

The canonical `/v1/training` API synchronizes guided attempts, terminal guided/practice history, and training settings. Every route requires `Authorization: Bearer ACCESS_TOKEN` and an existing user. The three former event/snapshot/settings `/v2/training` paths remain temporary compatibility aliases using the same handlers and database; requests are not redirected. Session and change-download routes are V1-only. [Legacy progress](../API.md#legacy-progress) remains active. Registration lives in [router.go](../internal/server/router.go); [request](../internal/common/input.go) and [response](../internal/common/response.go) schemas define JSON fields. This filename is retained to preserve existing links.

Payload schema 1 retains first-write-wins behavior; new clients use strict event schema 2. [Session storage and history](../API.md#training-synchronization) finalize guided/practice records, enforce manifests, and mirror legacy progress. Signed change downloads restore both modes and raw guided evidence through the [frontend synchronization engine](../../frontend/src/lib/training-sync-engine.ts). The [approved specification](training-history-v1-spec.md) records the complete contract and the remaining V2 retirement gate.

## Batch ingestion

`POST /v1/training/events/batch` (temporary alias: `POST /v2/training/events/batch`) accepts this envelope:

```json
{
  "schema_version": 2,
  "client_id": "11111111-1111-4111-8111-111111111111",
  "client_sent_at": "2026-10-04T12:00:05.000Z",
  "events": [
    {
      "id": "att_1",
      "session_id": "sess_1",
      "prompt_id": "prm_1",
      "prompt_kind": "recall",
      "target_character": "T",
      "entered_text": "T",
      "is_correct": true,
      "classification": "automatic",
      "latency_ms": 1200,
      "replay_count": 0,
      "input_mode": "keyboard",
      "char_wpm": 20,
      "eff_wpm": 12,
      "freq_hz": 600,
      "created_at": "2026-10-04T12:00:00.000Z"
    }
  ]
}
```

The batch contains 1–100 events and at most 256 KiB of JSON, with `schema_version` 1 or 2. Schema 1 retains its historical unvalidated diagnostic metadata. Schema 2 requires a nonzero UUID `client_id`, validates optional RFC3339 `client_sent_at`, and rejects client-supplied `user_id` in the envelope or event. Metadata is diagnostic; authentication alone determines ownership. [Request types](../internal/common/input.go) and [strict validation](../internal/handlers/v2/training_strict.go) own the exact checks. Schema 2 additionally reserves `legacy:` IDs and requires effective speed not to exceed character speed.

| Event fields                       | Validation                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `id`, `session_id`, `prompt_id`    | Nonblank; at most 128 bytes each                                                             |
| `prompt_kind`                      | `introduction`, `unscored-match`, `recall`, `contrast`, `short-group`                        |
| `target_character`, `entered_text` | Trimmed target is nonempty and at most 8 Unicode characters; trimmed entered text at most 64 |
| `is_correct`                       | Required boolean                                                                             |
| `classification`                   | `automatic`, `developing`, `incorrect`, `missing`, `unmeasured`                              |
| `latency_ms`, `replay_count`       | Required integers: 0–600000 ms and 0–1000 replays                                            |
| `input_mode`                       | `keyboard`, `grid`, `touch`                                                                  |
| `char_wpm`, `eff_wpm`, `freq_hz`   | Required integers: each speed 5–50, frequency 300–2000 Hz                                    |
| `created_at`                       | Required RFC3339 timestamp; records client measurement time                                  |

`automatic` and `developing` require `is_correct=true`; `incorrect` requires false; `missing` requires false and empty trimmed entered text. The handler does not impose those consistency rules on `unmeasured` or require the entered text to equal the target.

A valid batch returns 200 with `acknowledged_ids` and `rejected_events`. Each rejection contains `id`, `error_code`, and `message`; valid siblings are accepted even when others fail. The unique storage key `(user_id, event_id)` and shared account transaction lock prevent duplicate ingestion. Schema 1 acknowledges a persisted ID without modifying its original event. Schema 2 acknowledges identical normalized content, collapses identical repeated IDs, and rejects changed persisted/repeated content with `ID_CONFLICT` before inserting that ID. Comparison uses canonical stored fields and UTC microsecond timestamps, not hashes alone. New events outside an enrolled guided terminal manifest, or attached to a finalized practice/legacy session, reject with `SESSION_EVENT_SET_CONFLICT` through both namespaces. Existing event-only sessions remain valid without fabricated completion records.

Per-event codes are `MISSING_FIELD`, `INVALID_FIELD`, `INVALID_TIMING`, `INVALID_CLASSIFICATION`, `INVALID_PROMPT_KIND`, `INVALID_INPUT_MODE`, `ID_CONFLICT`, and `SESSION_EVENT_SET_CONFLICT`. Batch errors use the standard `code`/`error` body:

| Status | Code                                  | Condition                      |
| ------ | ------------------------------------- | ------------------------------ |
| 400    | `INVALID_REQUEST_BODY`                | Malformed JSON, empty events, invalid strict envelope |
| 400    | `TRAINING_UNSUPPORTED_SCHEMA_VERSION` | Schema version other than 1 or 2 |
| 400    | `TRAINING_BATCH_TOO_LARGE`            | More than 100 events           |
| 413    | `TRAINING_PAYLOAD_TOO_LARGE`          | Body exceeds 256 KiB           |
| 500    | `TRAINING_INGEST_FAILED`              | Event storage failure          |

## Change downloads

`GET /v1/training/changes` accepts opaque `cursor` and `limit` (default/max 100, minimum 1). Each `changes` entry has string `revision`, `kind` (`attempt` or `session`), and immutable `record`; the response also contains `next_cursor` and `has_more`. The complete JSON response, including its checkpoint, is at most 1 MiB. Records follow [canonical serializers](../internal/training/history_store.go); parsing and byte bounds live in the [download handler](../internal/handlers/v2/training_changes.go).

Bootstrap begins at revision zero after bounded legacy/orphan backfill. Pages ascend through a captured committed high-water revision; draining always returns a checkpoint, including an empty page. Submit that checkpoint to capture newer commits. Late client timestamps cannot skip records. HMAC-signed cursors bind account, epoch, last emitted revision, and ceiling; their signing domain is separate from session-history cursors. Treat both cursor formats as opaque and never interchange them.

Malformed queries/cursors or wrong-account cursors return 400 `INVALID_QUERY_PARAMETER`; retired epochs return `410 TRAINING_CURSOR_RESET_REQUIRED`. Rebootstrap preserves pending local uploads. Incomplete account backfill commits bounded progress and returns `503 TRAINING_SYNC_INITIALIZING`, `Retry-After: 1`. Database and encoding failures return 500 without advancing a client checkpoint. The [owner-scoped client repository](../../frontend/src/lib/data/training-sync-repository.ts) commits each page and expected-cursor replacement atomically, without re-enqueueing downloads.

## Snapshot

`GET /v1/training/snapshot` (temporary alias: `GET /v2/training/snapshot`) returns 200 with `suggested_step`, `unlocked_step`, nullable `last_active_at`, and `character_masteries`. Each mastery contains `character`, `status`, `rolling_accuracy`, nullable `median_latency_ms`, and `total_attempts`. Storage failures return 500 `TRAINING_SNAPSHOT_FAILED`.

Only characters with scored attempts appear; `unmeasured` events are excluded. The mirrored client/server policy uses a rolling window of 20, at least 12 attempts in at least two sessions for stability, accuracy at least 0.90, median correct latency at most 1500 ms, and review after three days without practice. Constants in the [server mastery module](../internal/training/mastery.go) and [client types](../../frontend/src/lib/training/v2/types.ts) must stay aligned.

Snapshots iterate stored events in `client_created_at,id` order with the request context. The incremental reducer retains at most 20 scored attempts per distinct character and the all-history count/two-session facts; older attempts are counted, not discarded. Last activity still includes unmeasured attempts. Memory follows the distinct characters returned, rather than the number of historical attempts; database work remains proportional to history size. Cancellation stops iteration and closes the row cursor.

On first accepted ingestion, `training_profiles` seeds steps from legacy `page_settings.cur_lesson`, defaulting to 1. Events and sessions advance `last_active_at` from canonical stored occurrence/measurement times; conflicting retry timestamps cannot advance it. They do not advance the step fields. A snapshot without a profile returns steps 1 and can use the latest event time as activity. Event/session records, activity, and immutable revision payloads commit atomically; a storage failure rolls back the batch instead of acknowledging partial persistence.

## Settings

`PUT /v1/training/settings` (temporary alias: `PUT /v2/training/settings`) requires `char_wpm`, `eff_wpm` (each 5–50), `freq` (300–2000 Hz), `start_delay` (0–10 seconds), and `target_daily_minutes` (1–240). It upserts shared CW settings and returns 200 with `updated_at`. Invalid input returns 400 `INVALID_REQUEST_BODY`; storage failure returns 500 `TRAINING_SETTINGS_UPDATE_FAILED`.

`target_daily_minutes` is nullable in storage; the older `/v1/settings` writers preserve it when omitted and their read shapes remain unchanged. There is no training-settings GET route. Session upload/history and change downloads are V1-only. The [frontend runtime](../../frontend/src/lib/training-sync.svelte.ts) synchronizes owner-scoped outboxes and downloads after saves, login, reconnect, and app return; [client persistence](../../frontend/src/lib/data/training-sync-repository.ts) owns imports and frozen acknowledgements. Completion never grants mastery or unlocks. See [training handler](../internal/handlers/v2/training.go) for persistence and validation; its package name does not define the public namespace.
