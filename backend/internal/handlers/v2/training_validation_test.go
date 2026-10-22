package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
)

func assertTrainingBatchResponse(t *testing.T, events []json.RawMessage, wantBody string) {
	t.Helper()
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	body := mustJSON(t, map[string]any{"schema_version": 1, "events": events})
	c.Request = httptest.NewRequest(http.MethodPost, "/v2/training/events/batch", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("user", &models.User{})
	// Every event must be rejected before the handler accesses its nil database.
	TrainingHandler{}.PostEventsBatch(c)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := response.Body.String(); got != wantBody {
		t.Errorf("response = %s\nwant       %s", got, wantBody)
	}
}

func TestTrainingValidationNumericFields(t *testing.T) {
	fields := []struct {
		name                         string
		min, max                     int
		missingMessage, rangeMessage string
	}{
		{"replay_count", 0, 1000, "replay_count is required", "replay_count must be between 0 and 1000"},
		{"char_wpm", 5, 50, "char_wpm is required", "char_wpm must be between 5 and 50"},
		{"eff_wpm", 5, 50, "eff_wpm is required", "eff_wpm must be between 5 and 50"},
		{"freq_hz", 300, 2000, "freq_hz is required", "freq_hz must be between 300 and 2000"},
	}
	for _, field := range fields {
		t.Run(field.name, func(t *testing.T) {
			cases := []struct {
				name              string
				value             any
				omit              bool
				wantCode, message string
			}{
				{"omitted", nil, true, "MISSING_FIELD", field.missingMessage},
				{"null", nil, false, "MISSING_FIELD", field.missingMessage},
				{"below_minimum", field.min - 1, false, "INVALID_FIELD", field.rangeMessage},
				{"minimum", field.min, false, "", ""},
				{"maximum", field.max, false, "", ""},
				{"above_maximum", field.max + 1, false, "INVALID_FIELD", field.rangeMessage},
			}
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					payload := validEventMap()
					payload[field.name] = tc.value
					if tc.omit {
						delete(payload, field.name)
					}
					events := []json.RawMessage{mustJSON(t, payload)}
					if tc.wantCode == "" {
						valid, rejected := validateTrainingEvents(events)
						if len(valid) != 1 || len(rejected) != 0 {
							t.Fatalf("boundary rejected: valid=%d rejected=%+v", len(valid), rejected)
						}
						return
					}
					wantBody := `{"acknowledged_ids":[],"rejected_events":[{"id":"att_rs_bm9ad04m","error_code":"` + tc.wantCode + `","message":"` + tc.message + `"}]}`
					assertTrainingBatchResponse(t, events, wantBody)
				})
			}
		})
	}
}

func TestTrainingValidationErrorPrecedence(t *testing.T) {
	cases := []struct {
		name              string
		changes           map[string]any
		wantCode, message string
	}{
		{"is_correct_before_numeric_fields", map[string]any{"is_correct": nil, "replay_count": nil}, "MISSING_FIELD", "is_correct is required"},
		{"latency_before_numeric_fields", map[string]any{"latency_ms": -1, "replay_count": nil}, "INVALID_TIMING", "latency_ms cannot be negative"},
		{"replay_range_before_missing_char_wpm", map[string]any{"replay_count": -1, "char_wpm": nil}, "INVALID_FIELD", "replay_count must be between 0 and 1000"},
		{"char_range_before_missing_eff_wpm", map[string]any{"char_wpm": 4, "eff_wpm": nil}, "INVALID_FIELD", "char_wpm must be between 5 and 50"},
		{"eff_range_before_missing_frequency", map[string]any{"eff_wpm": 51, "freq_hz": nil}, "INVALID_FIELD", "eff_wpm must be between 5 and 50"},
		{"frequency_before_timestamp", map[string]any{"freq_hz": 2001, "created_at": "yesterday"}, "INVALID_FIELD", "freq_hz must be between 300 and 2000"},
		{"timestamp_before_classification_consistency", map[string]any{"created_at": "yesterday", "is_correct": false}, "INVALID_FIELD", "created_at must be an ISO 8601 timestamp"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload := validEventMap()
			for field, value := range tc.changes {
				payload[field] = value
			}
			wantBody := `{"acknowledged_ids":[],"rejected_events":[{"id":"att_rs_bm9ad04m","error_code":"` + tc.wantCode + `","message":"` + tc.message + `"}]}`
			assertTrainingBatchResponse(t, []json.RawMessage{mustJSON(t, payload)}, wantBody)
		})
	}
}

func TestTrainingValidationRejectedBatchSnapshot(t *testing.T) {
	missingReplay := validEventMap()
	missingReplay["id"] = "first"
	delete(missingReplay, "replay_count")
	invalidSpeed := validEventMap()
	invalidSpeed["id"] = " second "
	invalidSpeed["eff_wpm"] = 51
	invalidFrequency := validEventMap()
	invalidFrequency["id"] = "third"
	invalidFrequency["freq_hz"] = 299
	events := []json.RawMessage{mustJSON(t, missingReplay), mustJSON(t, invalidSpeed), mustJSON(t, invalidFrequency)}
	wantBody := `{"acknowledged_ids":[],"rejected_events":[{"id":"first","error_code":"MISSING_FIELD","message":"replay_count is required"},{"id":"second","error_code":"INVALID_FIELD","message":"eff_wpm must be between 5 and 50"},{"id":"third","error_code":"INVALID_FIELD","message":"freq_hz must be between 300 and 2000"}]}`
	assertTrainingBatchResponse(t, events, wantBody)
}

func TestTrainingValidationAllowsEffectiveSpeedAboveCharacterSpeed(t *testing.T) {
	payload := validEventMap()
	payload["char_wpm"] = 5
	payload["eff_wpm"] = 50
	valid, rejected := validateTrainingEvents([]json.RawMessage{mustJSON(t, payload)})
	if len(valid) != 1 || len(rejected) != 0 {
		t.Fatalf("independent speed limits changed: valid=%d rejected=%+v", len(valid), rejected)
	}
	if *valid[0].input.CharWPM != 5 || *valid[0].input.EffWPM != 50 {
		t.Fatalf("speed values changed: %+v", valid[0].input)
	}
}
