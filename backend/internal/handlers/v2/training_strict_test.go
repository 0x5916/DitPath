package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"opencw/internal/common"
	"opencw/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestValidateStrictTrainingEvents(t *testing.T) {
	first := validEventMap()
	identical := validEventMap()
	identical["created_at"], identical["entered_text"] = "2026-10-20T08:00:00+08:00", " K "
	first["created_at"], first["entered_text"] = "2026-10-20T00:00:00Z", "K"
	valid, rejected := validateStrictTrainingEvents([]json.RawMessage{mustJSON(t, first), mustJSON(t, identical)})
	if len(valid) != 1 || len(rejected) != 0 {
		t.Fatalf("normalized retry did not collapse: %+v %+v", valid, rejected)
	}
	changed := validEventMap()
	changed["id"], changed["latency_ms"] = first["id"], 99
	valid, rejected = validateStrictTrainingEvents([]json.RawMessage{mustJSON(t, first), mustJSON(t, changed)})
	if len(valid) != 0 || len(rejected) != 1 || rejected[0].ErrorCode != common.RejectCodeIDConflict {
		t.Fatalf("conflicting repeated ID accepted: %+v %+v", valid, rejected)
	}
	for _, field := range []string{"user_id", "User_ID", "eff_wpm", "id", "session_id"} {
		t.Run(field, func(t *testing.T) {
			input := validEventMap()
			switch field {
			case "id", "session_id":
				input[field] = "legacy:reserved"
			case "eff_wpm":
				input[field] = 50
			default:
				input[field] = uuid.NewString()
			}
			valid, rejected := validateStrictTrainingEvents([]json.RawMessage{mustJSON(t, input)})
			if len(valid) != 0 || len(rejected) != 1 {
				t.Fatalf("strict field accepted: %+v %+v", valid, rejected)
			}
		})
	}
}

func TestStrictEventEnvelopeValidation(t *testing.T) {
	for _, input := range []map[string]any{
		{"schema_version": 2, "events": []any{validEventMap()}},
		{"schema_version": 2, "client_id": uuid.Nil.String(), "events": []any{validEventMap()}},
		{"schema_version": 2, "client_id": uuid.NewString(), "user_id": nil, "events": []any{validEventMap()}},
		{"schema_version": 2, "client_id": uuid.NewString(), "client_sent_at": "invalid", "events": []any{validEventMap()}},
	} {
		response := sessionStorageRequest(t, nil, models.User{}, http.MethodPost, "/v1/training/events/batch", input, nil)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), common.ErrorCodeInvalidRequestBody) {
			t.Fatalf("invalid envelope accepted: %d %s", response.Code, response.Body.String())
		}
	}
}

func TestStrictEventRetriesSchemaOneCompatibilityAndRollback(t *testing.T) {
	db, user := sessionStorageDB(t)
	post := func(events ...map[string]any) common.TrainingEventBatchResponse {
		t.Helper()
		response := sessionStorageRequest(t, db, user, http.MethodPost, "/v1/training/events/batch", map[string]any{"schema_version": 2, "client_id": uuid.NewString(), "events": events}, nil)
		var result common.TrainingEventBatchResponse
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatalf("strict batch: %d %s", response.Code, response.Body.String())
		}
		return result
	}
	first := validEventMap()
	first["created_at"] = "2026-10-20T00:00:00Z"
	result := post(first, first)
	if len(result.AcknowledgedIDs) != 1 || len(result.RejectedEvents) != 0 {
		t.Fatalf("identical repeat: %+v", result)
	}
	first["created_at"] = "2026-10-20T08:00:00+08:00"
	result = post(first)
	if len(result.AcknowledgedIDs) != 1 || len(result.RejectedEvents) != 0 {
		t.Fatalf("identical stored retry: %+v", result)
	}
	first["created_at"], first["latency_ms"] = "2030-01-01T00:00:00Z", 44
	result = post(first)
	if len(result.AcknowledgedIDs) != 0 || len(result.RejectedEvents) != 1 || result.RejectedEvents[0].ErrorCode != common.RejectCodeIDConflict {
		t.Fatalf("changed stored retry: %+v", result)
	}
	legacy := sessionStorageEvents(t, db, user, first)
	if len(legacy.AcknowledgedIDs) != 1 || len(legacy.RejectedEvents) != 0 {
		t.Fatalf("schema 1 compatibility: %+v", legacy)
	}
	var state models.TrainingSyncState
	var profile models.TrainingProfile
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 1 {
		t.Fatalf("duplicates allocated a revision: %+v %v", state, err)
	}
	if err := db.Take(&profile, "user_id = ?", user.ID).Error; err != nil || profile.LastActiveAt == nil || profile.LastActiveAt.Year() != 2026 {
		t.Fatalf("retry advanced canonical activity: %+v %v", profile, err)
	}
	fresh, conflict, sibling := validEventMap(), validEventMap(), validEventMap()
	fresh["id"], conflict["id"], sibling["id"] = "repeated-new", "repeated-new", "valid-sibling"
	conflict["latency_ms"] = 42
	result = post(fresh, conflict, sibling)
	if len(result.AcknowledgedIDs) != 1 || result.AcknowledgedIDs[0] != "valid-sibling" || len(result.RejectedEvents) != 1 || result.RejectedEvents[0].ErrorCode != common.RejectCodeIDConflict {
		t.Fatalf("partial strict acceptance: %+v", result)
	}
	var count int64
	db.Model(&models.TrainingEvent{}).Where("user_id = ? AND event_id = ?", user.ID, "repeated-new").Count(&count)
	if count != 0 {
		t.Fatal("conflicting repeated ID was inserted")
	}
	// Inject an append failure after event insertion. No accepted IDs or revision
	// gaps may escape a failed account transaction.
	callback := "test:strict-feed-failure:" + uuid.NewString()
	if err := db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "training_changes" {
			tx.AddError(errors.New("injected change insert failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove(callback) })
	failing := validEventMap()
	failing["id"] = "must-roll-back"
	response := sessionStorageRequest(t, db, user, http.MethodPost, "/v1/training/events/batch", map[string]any{"schema_version": 2, "client_id": uuid.NewString(), "events": []any{failing}}, nil)
	if response.Code != http.StatusInternalServerError || strings.Contains(response.Body.String(), "acknowledged_ids") {
		t.Fatalf("failed write acknowledged: %d %s", response.Code, response.Body.String())
	}
	db.Model(&models.TrainingEvent{}).Where("user_id = ? AND event_id = ?", user.ID, "must-roll-back").Count(&count)
	if count != 0 {
		t.Fatal("event escaped rollback")
	}
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 2 {
		t.Fatalf("failed write left a revision gap: %+v %v", state, err)
	}
}

func TestStrictEventSessionIntegrity(t *testing.T) {
	db, user := sessionStorageDB(t)
	sessionStoragePost(t, db, user, sessionStorageSession("strict-practice", "practice"), sessionStorageSession("strict-guided", "guided"))
	for _, session := range []string{"strict-practice", "strict-guided"} {
		event := sessionStorageEvent("outside-"+session, session, "automatic", true)
		response := sessionStorageRequest(t, db, user, http.MethodPost, "/v1/training/events/batch", map[string]any{"schema_version": 2, "client_id": uuid.NewString(), "events": []any{event}}, nil)
		var result common.TrainingEventBatchResponse
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.AcknowledgedIDs) != 0 || len(result.RejectedEvents) != 1 || result.RejectedEvents[0].ErrorCode != common.RejectCodeSessionEventConflict {
			t.Fatalf("strict path changed terminal integrity: %d %s", response.Code, response.Body.String())
		}
	}
}
