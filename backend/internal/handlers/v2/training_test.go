package handlers

import (
	"encoding/json"
	"testing"
	"time"

	"opencw/internal/common"
)

// validEventMap returns a fully valid batch event payload; tests override
// individual fields to exercise rejection paths.
func validEventMap() map[string]any {
	return map[string]any{
		"id":               "att_rs_bm9ad04m",
		"session_id":       "sess_rs_bm9ad04a",
		"prompt_id":        "prm_rs_bm9ad04b",
		"prompt_kind":      "recall",
		"target_character": "T",
		"entered_text":     "T",
		"is_correct":       true,
		"classification":   "automatic",
		"latency_ms":       1200,
		"replay_count":     0,
		"input_mode":       "keyboard",
		"char_wpm":         20,
		"eff_wpm":          12,
		"freq_hz":          600,
		"created_at":       "2026-10-04T12:00:00.000Z",
	}
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("failed to marshal test payload: %v", err)
	}
	return raw
}

func TestValidateTrainingEventsAcceptsValidEvent(t *testing.T) {
	valid, rejected := validateTrainingEvents([]json.RawMessage{mustJSON(t, validEventMap())})

	if len(valid) != 1 {
		t.Fatalf("expected 1 valid event, got %d", len(valid))
	}
	if len(rejected) != 0 {
		t.Fatalf("expected no rejections, got %+v", rejected)
	}
	if valid[0].input.ID != "att_rs_bm9ad04m" {
		t.Errorf("unexpected event id %q", valid[0].input.ID)
	}
	if !valid[0].createdAt.Equal(time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)) {
		t.Errorf("unexpected parsed createdAt %v", valid[0].createdAt)
	}
}

func TestValidateTrainingEventsRejections(t *testing.T) {
	tests := []struct {
		name        string
		mutate      func(map[string]any)
		wantCode    string
		wantMessage string
	}{
		{
			name:        "negative latency is invalid timing",
			mutate:      func(m map[string]any) { m["latency_ms"] = -1 },
			wantCode:    common.RejectCodeInvalidTiming,
			wantMessage: "latency_ms cannot be negative",
		},
		{
			name:     "missing latency",
			mutate:   func(m map[string]any) { delete(m, "latency_ms") },
			wantCode: common.RejectCodeMissingField,
		},
		{
			name:     "missing event id",
			mutate:   func(m map[string]any) { delete(m, "id") },
			wantCode: common.RejectCodeMissingField,
		},
		{
			name:     "missing is_correct",
			mutate:   func(m map[string]any) { delete(m, "is_correct") },
			wantCode: common.RejectCodeMissingField,
		},
		{
			name:     "unknown classification",
			mutate:   func(m map[string]any) { m["classification"] = "sloppy" },
			wantCode: common.RejectCodeInvalidClassification,
		},
		{
			name:     "automatic requires is_correct",
			mutate:   func(m map[string]any) { m["is_correct"] = false },
			wantCode: common.RejectCodeInvalidClassification,
		},
		{
			name: "missing answer cannot carry entered text",
			mutate: func(m map[string]any) {
				m["classification"] = "missing"
			},
			wantCode: common.RejectCodeInvalidClassification,
		},
		{
			name:     "unknown prompt kind",
			mutate:   func(m map[string]any) { m["prompt_kind"] = "quiz" },
			wantCode: common.RejectCodeInvalidPromptKind,
		},
		{
			name:     "unknown input mode",
			mutate:   func(m map[string]any) { m["input_mode"] = "telepathy" },
			wantCode: common.RejectCodeInvalidInputMode,
		},
		{
			name:     "invalid timestamp",
			mutate:   func(m map[string]any) { m["created_at"] = "yesterday" },
			wantCode: common.RejectCodeInvalidField,
		},
		{
			name:     "char wpm out of range",
			mutate:   func(m map[string]any) { m["char_wpm"] = 120 },
			wantCode: common.RejectCodeInvalidField,
		},
		{
			name:     "negative replay count",
			mutate:   func(m map[string]any) { m["replay_count"] = -2 },
			wantCode: common.RejectCodeInvalidField,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload := validEventMap()
			tt.mutate(payload)

			valid, rejected := validateTrainingEvents([]json.RawMessage{mustJSON(t, payload)})

			if len(valid) != 0 {
				t.Fatalf("expected the event to be rejected, got %d valid", len(valid))
			}
			if len(rejected) != 1 {
				t.Fatalf("expected exactly 1 rejection, got %+v", rejected)
			}
			if rejected[0].ErrorCode != tt.wantCode {
				t.Errorf("error code = %q, want %q (message: %s)", rejected[0].ErrorCode, tt.wantCode, rejected[0].Message)
			}
			if tt.wantMessage != "" && rejected[0].Message != tt.wantMessage {
				t.Errorf("message = %q, want %q", rejected[0].Message, tt.wantMessage)
			}
		})
	}
}

func TestValidateTrainingEventsMalformedJSON(t *testing.T) {
	valid, rejected := validateTrainingEvents([]json.RawMessage{json.RawMessage(`"not-an-object"`)})

	if len(valid) != 0 {
		t.Fatalf("expected 0 valid events, got %d", len(valid))
	}
	if len(rejected) != 1 || rejected[0].ErrorCode != common.RejectCodeInvalidField {
		t.Fatalf("expected one INVALID_FIELD rejection, got %+v", rejected)
	}
}

func TestValidateTrainingEventsPartialAcceptance(t *testing.T) {
	badEvent := validEventMap()
	badEvent["id"] = "att_bad_1"
	badEvent["latency_ms"] = -5

	secondValid := validEventMap()
	secondValid["id"] = "att_good_2"

	valid, rejected := validateTrainingEvents([]json.RawMessage{
		mustJSON(t, validEventMap()),
		mustJSON(t, badEvent),
		mustJSON(t, secondValid),
	})

	if len(valid) != 2 {
		t.Fatalf("expected 2 valid events, got %d", len(valid))
	}
	if len(rejected) != 1 {
		t.Fatalf("expected 1 rejection, got %+v", rejected)
	}
	if rejected[0].ID != "att_bad_1" {
		t.Errorf("rejected id = %q, want att_bad_1", rejected[0].ID)
	}
	if valid[0].input.ID != "att_rs_bm9ad04m" || valid[1].input.ID != "att_good_2" {
		t.Errorf("valid events out of order: %q, %q", valid[0].input.ID, valid[1].input.ID)
	}
}
