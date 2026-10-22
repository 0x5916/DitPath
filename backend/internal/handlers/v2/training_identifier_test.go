package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestTrainingIdentifierFields(t *testing.T) {
	for _, field := range []struct {
		name, missing, tooLong string
	}{
		{"id", "id is required", "id exceeds 128 characters"},
		{"session_id", "session_id is required", "session_id exceeds 128 characters"},
		{"prompt_id", "prompt_id is required", "prompt_id exceeds 128 characters"},
	} {
		t.Run(field.name, func(t *testing.T) {
			for _, test := range []struct {
				name, value, code string
				omit, null        bool
			}{
				{"omitted", "", "MISSING_FIELD", true, false},
				{"null", "", "MISSING_FIELD", false, true},
				{"empty", "", "MISSING_FIELD", false, false},
				{"ASCII whitespace", " \t\r\n", "MISSING_FIELD", false, false},
				{"Unicode whitespace", "\u00a0\u2003", "MISSING_FIELD", false, false},
				{"long whitespace", strings.Repeat(" ", 129), "MISSING_FIELD", false, false},
				{"128 ASCII bytes", strings.Repeat("a", 128), "", false, false},
				{"129 ASCII bytes", strings.Repeat("a", 129), "INVALID_FIELD", false, false},
				{"128 UTF-8 bytes", strings.Repeat("é", 64), "", false, false},
				{"129 UTF-8 bytes", strings.Repeat("é", 64) + "x", "INVALID_FIELD", false, false},
				{"padded short value", " \u2003value\u00a0 ", "", false, false},
				{"padded 128 bytes", " " + strings.Repeat("a", 128) + " ", "INVALID_FIELD", false, false},
			} {
				t.Run(test.name, func(t *testing.T) {
					payload := validEventMap()
					payload["id"] = " \u2003event\u00a0 "
					payload[field.name] = test.value
					if test.omit {
						delete(payload, field.name)
					} else if test.null {
						payload[field.name] = nil
					}
					code := test.code
					if field.name == "id" && test.name == "padded 128 bytes" {
						code = ""
					}
					events := []json.RawMessage{mustJSON(t, payload)}
					if code == "" {
						valid, rejected := validateTrainingEvents(events)
						if len(valid) != 1 || len(rejected) != 0 {
							t.Fatalf("boundary rejected: valid=%d rejected=%+v", len(valid), rejected)
						}
						in := valid[0].input
						if in.ID != payload["id"] || in.SessionID != payload["session_id"] || in.PromptID != payload["prompt_id"] {
							t.Fatalf("accepted identifiers were normalized: %+v", in)
						}
						return
					}
					id, _ := payload["id"].(string)
					message := field.missing
					if code == "INVALID_FIELD" {
						message = field.tooLong
					}
					body := `{"acknowledged_ids":[],"rejected_events":[{"id":` + string(mustJSON(t, strings.TrimSpace(id))) + `,"error_code":"` + code + `","message":"` + message + `"}]}`
					assertTrainingBatchResponse(t, events, body)
				})
			}
		})
	}
}

func TestTrainingIdentifierErrorPrecedence(t *testing.T) {
	for _, test := range []struct {
		name, code, message string
		changes             map[string]any
	}{
		{"id missing before session", "MISSING_FIELD", "id is required", map[string]any{"id": " ", "session_id": ""}},
		{"id length before missing session", "INVALID_FIELD", "id exceeds 128 characters", map[string]any{"id": strings.Repeat("a", 129), "session_id": ""}},
		{"session missing before prompt length", "MISSING_FIELD", "session_id is required", map[string]any{"session_id": "", "prompt_id": strings.Repeat("a", 129)}},
		{"session length before missing prompt", "INVALID_FIELD", "session_id exceeds 128 characters", map[string]any{"session_id": strings.Repeat("a", 129), "prompt_id": ""}},
		{"prompt missing before kind", "MISSING_FIELD", "prompt_id is required", map[string]any{"prompt_id": "", "prompt_kind": "unknown"}},
		{"prompt length before kind", "INVALID_FIELD", "prompt_id exceeds 128 characters", map[string]any{"prompt_id": strings.Repeat("a", 129), "prompt_kind": "unknown"}},
		{"kind after valid identifiers", "INVALID_PROMPT_KIND", "prompt_kind must be one of introduction, unscored-match, recall, contrast, short-group", map[string]any{"prompt_kind": "unknown"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := validEventMap()
			payload["id"] = " padded-id "
			for field, value := range test.changes {
				payload[field] = value
			}
			id := strings.TrimSpace(payload["id"].(string))
			body := `{"acknowledged_ids":[],"rejected_events":[{"id":` + string(mustJSON(t, id)) + `,"error_code":"` + test.code + `","message":"` + test.message + `"}]}`
			assertTrainingBatchResponse(t, []json.RawMessage{mustJSON(t, payload)}, body)
		})
	}
}

func TestTrainingIdentifierPostgresBatchSnapshot(t *testing.T) {
	dsn := os.Getenv("OPENCW_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("set OPENCW_TEST_DATABASE_DSN to a migrated disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("cannot connect to disposable PostgreSQL database")
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	user := models.User{Username: "identifier_" + uuid.NewString(), Email: uuid.NewString() + "@example.invalid", Password: "unused"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Unscoped().Delete(&user).Error; err != nil {
			t.Error(err)
		}
	})
	first, rejected, second := validEventMap(), validEventMap(), validEventMap()
	// Padded and unpadded IDs remain distinct storage/idempotency keys.
	first["id"], second["id"], rejected["id"] = " first ", "first", " rejected "
	first["session_id"], first["prompt_id"] = " session ", " prompt "
	rejected["session_id"] = "\u2003"
	body := mustJSON(t, map[string]any{"schema_version": 1, "events": []any{first, rejected, second}})
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodPost, "/v2/training/events/batch", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("user", &user)
	TrainingHandler{DB: db}.PostEventsBatch(c)
	const snapshot = `{"acknowledged_ids":[" first ","first"],"rejected_events":[{"id":"rejected","error_code":"MISSING_FIELD","message":"session_id is required"}]}`
	if response.Code != 200 || response.Body.String() != snapshot || response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("response = %d %s %s", response.Code, response.Header().Get("Content-Type"), response.Body)
	}
	var stored []models.TrainingEvent
	if err := db.Where("user_id = ?", user.ID).Find(&stored).Error; err != nil {
		t.Fatal(err)
	}
	storedByID := make(map[string]models.TrainingEvent, len(stored))
	for _, event := range stored {
		storedByID[event.EventID] = event
	}
	padded, hasPadded := storedByID[" first "]
	_, hasUnpadded := storedByID["first"]
	if len(stored) != 2 || !hasPadded || !hasUnpadded || padded.SessionID != " session " || padded.PromptID != " prompt " {
		t.Fatalf("stored identifiers changed: %+v", stored)
	}
	var changes []models.TrainingChange
	if err := db.Where("user_id = ?", user.ID).Order("revision ASC").Find(&changes).Error; err != nil || len(changes) != 2 {
		t.Fatalf("identifier history changes=%+v err=%v", changes, err)
	}
	for index, id := range []string{" first ", "first"} {
		var payload map[string]any
		if err := json.Unmarshal(changes[index].Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if changes[index].Kind != "attempt" || changes[index].RecordID != id || payload["id"] != id || payload["session_id"] != storedByID[id].SessionID || payload["prompt_id"] != storedByID[id].PromptID {
			t.Fatalf("history normalized raw identifiers: %+v payload=%v", changes[index], payload)
		}
	}
}
