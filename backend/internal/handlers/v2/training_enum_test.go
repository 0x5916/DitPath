package handlers

import (
	"encoding/json"
	"strings"
	"testing"

	"opencw/internal/models"
)

const (
	trainingEnumPromptMessage = "prompt_kind must be one of introduction, unscored-match, recall, contrast, short-group"
	trainingEnumClassMessage  = "classification must be one of automatic, developing, incorrect, missing, unmeasured"
	trainingEnumInputMessage  = "input_mode must be one of keyboard, grid, touch"
)

func TestTrainingEnumsAcceptExactValues(t *testing.T) {
	for _, field := range []struct {
		name   string
		values []string
	}{
		{"prompt_kind", []string{"introduction", "unscored-match", "recall", "contrast", "short-group"}},
		{"classification", []string{"automatic", "developing", "incorrect", "missing", "unmeasured"}},
		{"input_mode", []string{"keyboard", "grid", "touch"}},
	} {
		t.Run(field.name, func(t *testing.T) {
			for _, value := range field.values {
				t.Run(value, func(t *testing.T) {
					payload := validEventMap()
					payload[field.name] = value
					if field.name == "classification" && (value == "incorrect" || value == "missing") {
						payload["is_correct"] = false
					}
					if field.name == "classification" && value == "missing" {
						payload["entered_text"] = ""
					}
					valid, rejected := validateTrainingEvents([]json.RawMessage{mustJSON(t, payload)})
					if len(valid) != 1 || len(rejected) != 0 {
						t.Fatalf("exact enum value rejected: valid=%d rejected=%+v", len(valid), rejected)
					}
					input := valid[0].input
					if input.PromptKind != payload["prompt_kind"] || input.Classification != payload["classification"] || input.InputMode != payload["input_mode"] {
						t.Fatalf("accepted enum spelling changed: %+v", input)
					}
				})
			}
		})
	}
}

func TestTrainingEnumsRejectNearMissesSnapshots(t *testing.T) {
	for _, field := range []struct {
		name, valid, code, message string
	}{
		{"prompt_kind", "recall", "INVALID_PROMPT_KIND", trainingEnumPromptMessage},
		{"classification", "automatic", "INVALID_CLASSIFICATION", trainingEnumClassMessage},
		{"input_mode", "keyboard", "INVALID_INPUT_MODE", trainingEnumInputMessage},
	} {
		t.Run(field.name, func(t *testing.T) {
			for _, test := range []struct {
				name  string
				value any
				omit  bool
			}{
				{"omitted", nil, true},
				{"null", nil, false},
				{"empty", "", false},
				{"unknown", "unknown", false},
				{"case", strings.ToUpper(field.valid), false},
				{"leading whitespace", " " + field.valid, false},
				{"trailing whitespace", field.valid + " ", false},
				{"Unicode whitespace", "\u2003" + field.valid + "\u00a0", false},
			} {
				t.Run(test.name, func(t *testing.T) {
					payload := validEventMap()
					payload[field.name] = test.value
					if test.omit {
						delete(payload, field.name)
					}
					body := `{"acknowledged_ids":[],"rejected_events":[{"id":"att_rs_bm9ad04m","error_code":"` + field.code + `","message":"` + field.message + `"}]}`
					assertTrainingBatchResponse(t, []json.RawMessage{mustJSON(t, payload)}, body)
				})
			}
		})
	}
}

func TestTrainingEnumsValidationPrecedenceSnapshots(t *testing.T) {
	for _, test := range []struct {
		name, code, message string
		changes             map[string]any
	}{
		{"identifier before prompt kind", "MISSING_FIELD", "prompt_id is required", map[string]any{"prompt_id": "", "prompt_kind": "unknown"}},
		{"prompt kind before target", "INVALID_PROMPT_KIND", trainingEnumPromptMessage, map[string]any{"prompt_kind": "unknown", "target_character": ""}},
		{"prompt kind before other enums", "INVALID_PROMPT_KIND", trainingEnumPromptMessage, map[string]any{"prompt_kind": "unknown", "classification": "unknown", "input_mode": "unknown"}},
		{"missing target before classification", "MISSING_FIELD", "target_character is required", map[string]any{"target_character": "", "classification": "unknown"}},
		{"target length before classification", "INVALID_FIELD", "target_character exceeds 8 characters", map[string]any{"target_character": "123456789", "classification": "unknown"}},
		{"classification before input mode", "INVALID_CLASSIFICATION", trainingEnumClassMessage, map[string]any{"classification": "unknown", "input_mode": "unknown"}},
		{"classification before entered text", "INVALID_CLASSIFICATION", trainingEnumClassMessage, map[string]any{"classification": "unknown", "entered_text": strings.Repeat("T", 65)}},
		{"input mode before entered text", "INVALID_INPUT_MODE", trainingEnumInputMessage, map[string]any{"input_mode": "unknown", "entered_text": strings.Repeat("T", 65)}},
		{"input mode before correctness", "INVALID_INPUT_MODE", trainingEnumInputMessage, map[string]any{"input_mode": "unknown", "is_correct": nil}},
		{"input mode before latency", "INVALID_INPUT_MODE", trainingEnumInputMessage, map[string]any{"input_mode": "unknown", "latency_ms": -1}},
		{"input mode before numeric fields", "INVALID_INPUT_MODE", trainingEnumInputMessage, map[string]any{"input_mode": "unknown", "replay_count": nil}},
		{"input mode before timestamp", "INVALID_INPUT_MODE", trainingEnumInputMessage, map[string]any{"input_mode": "unknown", "created_at": "yesterday"}},
		{"entered text before missing consistency", "INVALID_FIELD", "entered_text exceeds 64 characters", map[string]any{"classification": "missing", "is_correct": false, "entered_text": strings.Repeat("T", 65)}},
		{"correctness before classification consistency", "MISSING_FIELD", "is_correct is required", map[string]any{"classification": "missing", "is_correct": nil}},
		{"latency before classification consistency", "INVALID_TIMING", "latency_ms cannot be negative", map[string]any{"is_correct": false, "latency_ms": -1}},
		{"numeric fields before classification consistency", "INVALID_FIELD", "char_wpm must be between 5 and 50", map[string]any{"is_correct": false, "char_wpm": 4}},
		{"timestamp before classification consistency", "MISSING_FIELD", "created_at is required", map[string]any{"classification": "incorrect", "created_at": nil}},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := validEventMap()
			for field, value := range test.changes {
				payload[field] = value
			}
			body := `{"acknowledged_ids":[],"rejected_events":[{"id":"att_rs_bm9ad04m","error_code":"` + test.code + `","message":"` + test.message + `"}]}`
			assertTrainingBatchResponse(t, []json.RawMessage{mustJSON(t, payload)}, body)
		})
	}
}

func TestTrainingEnumsPostgresMixedBatchSnapshot(t *testing.T) {
	db, user := trainingBatchFixture(t)
	variants := []struct{ id, promptKind, classification, inputMode string }{
		{"enum-0", "introduction", "automatic", "keyboard"},
		{"enum-1", "unscored-match", "developing", "grid"},
		{"enum-2", "recall", "incorrect", "touch"},
		{"enum-3", "contrast", "missing", "keyboard"},
		{"enum-4", "short-group", "unmeasured", "touch"},
	}
	events := make([]any, 0, len(variants)+1)
	for index, variant := range variants {
		event := trainingBatchEvent(variant.id, "2100-01-01T00:00:00Z")
		event["prompt_kind"], event["classification"], event["input_mode"] = variant.promptKind, variant.classification, variant.inputMode
		if variant.classification == "incorrect" || variant.classification == "missing" {
			event["is_correct"] = false
		}
		if variant.classification == "missing" {
			event["entered_text"] = ""
		}
		events = append(events, event)
		if index == 1 {
			invalid := trainingBatchEvent(" rejected ", "2100-01-01T00:00:00Z")
			invalid["input_mode"] = " keyboard"
			events = append(events, invalid)
		}
	}
	const body = `{"acknowledged_ids":["enum-0","enum-1","enum-2","enum-3","enum-4"],"rejected_events":[{"id":"rejected","error_code":"INVALID_INPUT_MODE","message":"input_mode must be one of keyboard, grid, touch"}]}`
	trainingBatchSnapshot(t, db, user, events, 200, body)
	var stored []models.TrainingEvent
	if err := db.Where("user_id = ?", user.ID).Order("event_id ASC").Find(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if len(stored) != len(variants) {
		t.Fatalf("stored %d events, want %d", len(stored), len(variants))
	}
	var changes []models.TrainingChange
	if err := db.Where("user_id = ?", user.ID).Order("revision ASC").Find(&changes).Error; err != nil || len(changes) != len(variants) {
		t.Fatalf("enum history changes=%+v err=%v", changes, err)
	}
	for index, variant := range variants {
		event := stored[index]
		if event.EventID != variant.id || event.PromptKind != variant.promptKind || event.Classification != variant.classification || event.InputMode != variant.inputMode {
			t.Fatalf("stored enum spelling changed: %+v", event)
		}
		var payload map[string]any
		if err := json.Unmarshal(changes[index].Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if changes[index].Kind != "attempt" || changes[index].RecordID != variant.id || payload["id"] != variant.id || payload["prompt_kind"] != variant.promptKind || payload["classification"] != variant.classification || payload["input_mode"] != variant.inputMode {
			t.Fatalf("history changed enum spelling: %+v payload=%v", changes[index], payload)
		}
	}
}
