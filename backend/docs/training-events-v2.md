# DitPath V2 training synchronization

The V2 API synchronizes immutable prompt attempts and training settings. All three routes require `Authorization: Bearer ACCESS_TOKEN` and an existing user, using the V1 authentication middleware. [V1 progress](../API.md#legacy-progress) remains active. Registration lives in [router.go](../internal/server/router.go); [request](../internal/common/input.go) and [response](../internal/common/response.go) schemas define JSON fields.

## Batch ingestion

`POST /v2/training/events/batch` accepts this envelope:

```json
{
  "schema_version": 1,
  "client_id": "client_uuid_v4",
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

The batch must contain 1–100 events and at most 256 KiB of JSON. `schema_version` must be 1. `client_id` and `client_sent_at` are accepted envelope metadata and are not currently persisted or validated by the handler.

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

A valid batch returns 200 with `acknowledged_ids` and `rejected_events`. Each rejection contains `id`, `error_code`, and `message`; valid siblings are accepted even when others fail. The unique storage key `(user_id, event_id)` and `ON CONFLICT DO NOTHING` prevent duplicate ingestion. Retrying a valid persisted ID acknowledges it without modifying its original event.

Per-event codes are `MISSING_FIELD`, `INVALID_FIELD`, `INVALID_TIMING`, `INVALID_CLASSIFICATION`, `INVALID_PROMPT_KIND`, and `INVALID_INPUT_MODE`. Batch errors use the standard `code`/`error` body:

| Status | Code                                  | Condition                      |
| ------ | ------------------------------------- | ------------------------------ |
| 400    | `INVALID_REQUEST_BODY`                | Malformed JSON or empty events |
| 400    | `TRAINING_UNSUPPORTED_SCHEMA_VERSION` | Schema version other than 1    |
| 400    | `TRAINING_BATCH_TOO_LARGE`            | More than 100 events           |
| 413    | `TRAINING_PAYLOAD_TOO_LARGE`          | Body exceeds 256 KiB           |
| 500    | `TRAINING_INGEST_FAILED`              | Event storage failure          |

## Snapshot

`GET /v2/training/snapshot` returns 200 with `suggested_step`, `unlocked_step`, nullable `last_active_at`, and `character_masteries`. Each mastery contains `character`, `status`, `rolling_accuracy`, nullable `median_latency_ms`, and `total_attempts`. Storage failures return 500 `TRAINING_SNAPSHOT_FAILED`.

Only characters with scored attempts appear; `unmeasured` events are excluded. The mirrored client/server policy uses a rolling window of 20, at least 12 attempts in at least two sessions for stability, accuracy at least 0.90, median correct latency at most 1500 ms, and review after three days without practice. Constants in the [server handler](../internal/handlers/v2/training.go) and [client types](../../frontend/src/lib/training/v2/types.ts) must stay aligned.

On first accepted ingestion, `training_profiles` seeds steps from legacy `page_settings.cur_lesson`, defaulting to 1. Event batches advance `last_active_at` using the latest client measurement time; they do not advance the step fields. A snapshot without a profile returns steps 1 and can use the latest event time as activity.

## Settings

`PUT /v2/training/settings` requires `char_wpm`, `eff_wpm` (each 5–50), `freq` (300–2000 Hz), `start_delay` (0–10 seconds), and `target_daily_minutes` (1–240). It upserts shared CW settings and returns 200 with `updated_at`. Invalid input returns 400 `INVALID_REQUEST_BODY`; storage failure returns 500 `TRAINING_SETTINGS_UPDATE_FAILED`.

`target_daily_minutes` is nullable in storage and is ignored by V1 settings routes. There is no V2 settings GET route or session-record synchronization route. Step advancement through session synchronization and client outbox flush wiring are outside the implemented contract. See [training handler](../internal/handlers/v2/training.go) for persistence and validation.
