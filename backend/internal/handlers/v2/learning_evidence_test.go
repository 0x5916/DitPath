package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"net/http/httptest"
	"net/url"
	"opencw/internal/configs"
	"opencw/internal/learning"
	"opencw/internal/models"
	"strings"
	"testing"
)

func learningRequest(t *testing.T, db *gorm.DB, user models.User, method, path string, input any) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(input)
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set("user", &user) })
	h := TrainingHandler{DB: db}
	engine.POST("/v1/training/learning-evidence/batch", h.PostLearningEvidence)
	engine.GET("/v1/training/learning-evidence/changes", h.GetLearningEvidenceChanges)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(method, path, bytes.NewReader(body)))
	return response
}
func learningPlanFixture() map[string]any {
	prompts := []any{}
	for i := range 12 {
		ch := "K"
		if i%2 == 1 {
			ch = "M"
		}
		prompts = append(prompts, map[string]any{"id": fmt.Sprint("p", i), "character": ch, "role": "target"})
	}
	return map[string]any{"id": "plan", "kind": "plan", "policy_version": learning.PolicyVersion, "recorded_at": "2026-10-27T00:00:00Z", "session_id": "review", "purpose": "coaching", "curriculum_version": "koch-39-v1", "profile": map[string]any{"id": "clean20", "task": "single-character", "char_wpm": 20, "audio_condition": "clean", "response_support": "open"}, "char_wpm": 20, "eff_wpm": 12, "freq_hz": 600, "started_at": "2026-10-27T00:00:00Z", "introduced_characters": []string{"K", "M"}, "targets": []string{"K", "M"}, "prompts": prompts, "fresh_order": true, "feedback": "immediate"}
}
func learningFixture(kind, id string, extra map[string]any) map[string]any {
	extra["kind"] = kind
	extra["id"] = id
	extra["policy_version"] = learning.PolicyVersion
	extra["recorded_at"] = "2026-10-27T00:01:00Z"
	return extra
}
func learningPost(t *testing.T, db *gorm.DB, user models.User, records ...map[string]any) learningBatchResponse {
	t.Helper()
	response := learningRequest(t, db, user, "POST", "/v1/training/learning-evidence/batch", map[string]any{"schema_version": 1, "client_id": uuid.NewString(), "records": records})
	if response.Code != 200 {
		t.Fatalf("batch: %d %s", response.Code, response.Body.String())
	}
	var result learningBatchResponse
	if json.Unmarshal(response.Body.Bytes(), &result) != nil {
		t.Fatal("invalid result")
	}
	return result
}
func TestLearningEvidenceEnvelopeAndClientClaims(t *testing.T) {
	plan := learningPlanFixture()
	plan["purpose"] = "mixed-check"
	result := learningPost(t, nil, models.User{}, plan)
	if len(result.AcknowledgedIDs) != 0 || len(result.RejectedRecords) != 1 || result.RejectedRecords[0].ErrorCode != "INVALID_RECORD" {
		t.Fatalf("invalid mixed plan accepted: %+v", result)
	}
	for _, test := range []struct {
		name  string
		input any
	}{
		{"version", map[string]any{"schema_version": 2}},
		{"owner", map[string]any{"schema_version": 1, "user_id": "other", "records": []any{plan}}},
		{"empty", map[string]any{"schema_version": 1, "client_id": uuid.NewString(), "records": []any{}}},
		{"null records", map[string]any{"schema_version": 1, "client_id": uuid.NewString(), "records": nil}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if r := learningRequest(t, nil, models.User{}, "POST", "/v1/training/learning-evidence/batch", test.input); r.Code != 400 {
				t.Fatal(r.Code, r.Body)
			}
		})
	}
}
func TestLearningEvidenceCursorDomainAndBoundedPages(t *testing.T) {
	key := []byte("learning-test")
	cursor := learningChangesCursor{Version: 1, UserID: uuid.New(), Epoch: 1, After: 9007199254740992, HighWater: 9007199254740993}
	encoded, err := encodeLearningChangesCursor(cursor, key)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeLearningChangesCursor(encoded, key)
	if err != nil || decoded != cursor {
		t.Fatal("cursor mismatch", err)
	}
	if _, err := decodeTrainingChangesCursor(encoded, key); err == nil {
		t.Fatal("learning cursor entered old feed")
	}
	legacy, _ := encodeTrainingChangesCursor(trainingChangesCursor{Version: 1, UserID: cursor.UserID, Epoch: 1}, key)
	if _, err := decodeLearningChangesCursor(legacy, key); err == nil {
		t.Fatal("old cursor entered learning feed")
	}
	if _, err := decodeLearningChangesCursor(encoded+"x", key); err == nil {
		t.Fatal("tampered cursor accepted")
	}
	cursor.After = 0
	cursor.HighWater = 3
	payload, _ := json.Marshal(map[string]any{"large": strings.Repeat("x", 600000)})
	rows := []models.LearningEvidenceChange{{Revision: 1, Kind: "plan", Payload: payload}, {Revision: 2, Kind: "plan", Payload: payload}, {Revision: 3, Kind: "terminal", Payload: json.RawMessage(`{}`)}}
	raw, err := marshalLearningChangesPage(rows, 100, cursor, key)
	var page learningChangesResponse
	if err != nil || json.Unmarshal(raw, &page) != nil || len(raw) > learningChangesMaxBytes || len(page.Changes) != 1 || !page.HasMore {
		t.Fatal("page bound", err)
	}
	next, _ := decodeLearningChangesCursor(page.NextCursor, key)
	if next.After != 1 || next.HighWater != 3 {
		t.Fatal("checkpoint skipped data")
	}
	raw, err = marshalLearningChangesPage(nil, 100, learningChangesCursor{Version: 1, UserID: cursor.UserID, Epoch: 1}, key)
	if err != nil || json.Unmarshal(raw, &page) != nil || page.NextCursor == "" || page.HasMore {
		t.Fatal("empty checkpoint", err)
	}
}
func TestLearningEvidencePostgresDependenciesRetriesIsolation(t *testing.T) {
	db, user := sessionStorageDB(t)
	other := sessionStorageUser(t, db)
	old := configs.App.JWTSecret
	configs.App.JWTSecret = []byte("learning-feed-test")
	t.Cleanup(func() { configs.App.JWTSecret = old })
	plan := learningPlanFixture()
	result := learningPost(t, db, user, plan, plan)
	if len(result.AcknowledgedIDs) != 1 || len(result.RejectedRecords) != 0 {
		t.Fatalf("plan retry: %+v", result)
	}
	changed := learningPlanFixture()
	changed["freq_hz"] = 650
	result = learningPost(t, db, user, changed)
	if result.RejectedRecords[0].ErrorCode != "ID_CONFLICT" {
		t.Fatal(result)
	}
	open := learningFixture("exposure-open", "open", map[string]any{"session_id": "review", "presentation_id": "sound", "characters": []string{"K"}, "source": "coaching", "started_at": nil})
	observation := learningFixture("observation", "answer", map[string]any{"session_id": "review", "prompt_id": "p0", "presentation_id": "sound", "first_response": "K", "final_response": "K", "skipped": false, "replay_count_before_response": 0, "help_before_response": false, "audio_valid": true, "interruption_invalidated": false, "response_interface": "keyboard", "first_presented_at": nil, "prior_exposure": nil, "char_wpm": 20, "eff_wpm": 12, "freq_hz": 600})
	result = learningPost(t, db, user, observation)
	if !result.RejectedRecords[0].Retryable {
		t.Fatal("missing dependency not retryable")
	}
	result = learningPost(t, db, other, open)
	if len(result.AcknowledgedIDs) != 0 || !result.RejectedRecords[0].Retryable {
		t.Fatal("cross-account plan was visible")
	}
	result = learningPost(t, db, user, open, observation)
	if len(result.AcknowledgedIDs) != 2 {
		t.Fatal(result)
	}
	duplicate := map[string]any{}
	for k, v := range observation {
		duplicate[k] = v
	}
	duplicate["id"] = "second-first"
	result = learningPost(t, db, user, duplicate)
	if result.RejectedRecords[0].ErrorCode != "EVIDENCE_SET_CONFLICT" {
		t.Fatal("second first response accepted")
	}
	terminal := learningFixture("terminal", "end", map[string]any{"session_id": "review", "status": "abandoned", "ended_at": nil, "observation_ids": []string{"answer"}})
	result = learningPost(t, db, user, terminal)
	if len(result.AcknowledgedIDs) != 1 {
		t.Fatal(result)
	}
	close := learningFixture("exposure-close", "close", map[string]any{"open_id": "open", "end_reason": "recovery", "last_exposure": map[string]any{"K": nil}})
	result = learningPost(t, db, user, close)
	if len(result.AcknowledgedIDs) != 1 {
		t.Fatal("closure after terminal failed", result)
	}
	result = learningPost(t, db, user, observation)
	if len(result.AcknowledgedIDs) != 1 {
		t.Fatal("identical late retry failed")
	}
	for _, model := range []any{&models.TrainingEvent{}, &models.TrainingSession{}, &models.TrainingChange{}} {
		var count int64
		if err := db.Model(model).Where("user_id = ?", user.ID).Count(&count).Error; err != nil || count != 0 {
			t.Fatal("new evidence leaked to old history", count, err)
		}
	}
	response := learningRequest(t, db, user, "GET", "/v1/training/learning-evidence/changes?limit=2", nil)
	var page learningChangesResponse
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &page) != nil || len(page.Changes) != 2 || !page.HasMore {
		t.Fatal(response.Code, response.Body)
	}
	firstCursor := page.NextCursor
	cross := learningRequest(t, db, other, "GET", "/v1/training/learning-evidence/changes?cursor="+url.QueryEscape(firstCursor), nil)
	if cross.Code != 400 {
		t.Fatal("cross-account cursor accepted")
	}
	var state models.LearningEvidenceSyncState
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 5 {
		t.Fatal("idempotence/revisions", state, err)
	}
	if err := db.Model(&state).Update("feed_epoch", 2).Error; err != nil {
		t.Fatal(err)
	}
	retired := learningRequest(t, db, user, "GET", "/v1/training/learning-evidence/changes?cursor="+url.QueryEscape(firstCursor), nil)
	if retired.Code != 410 {
		t.Fatal("retired cursor accepted")
	}
}

func learningBounds(instant string) map[string]any {
	return map[string]any{"earliest": instant, "latest": instant, "source": "wall-clock-bounded"}
}
func TestLearningEvidencePostgresPresentationAndChronology(t *testing.T) {
	db, user := sessionStorageDB(t)
	learningPost(t, db, user, learningPlanFixture())
	open := learningFixture("exposure-open", "open", map[string]any{"session_id": "review", "presentation_id": "sound", "characters": []string{"K"}, "source": "coaching", "started_at": learningBounds("2026-10-27T00:01:00Z")})
	if r := learningPost(t, db, user, open); len(r.AcknowledgedIDs) != 1 {
		t.Fatal(r)
	}
	observation := learningFixture("observation", "answer", map[string]any{"session_id": "review", "prompt_id": "p0", "presentation_id": "sound", "first_response": "K", "final_response": "K", "skipped": false, "replay_count_before_response": 0, "help_before_response": false, "audio_valid": true, "interruption_invalidated": false, "response_interface": "keyboard", "first_presented_at": learningBounds("2026-10-27T00:00:30Z"), "prior_exposure": nil, "char_wpm": 20, "eff_wpm": 12, "freq_hz": 600})
	if r := learningPost(t, db, user, observation); len(r.RejectedRecords) != 1 || r.RejectedRecords[0].ErrorCode != "EVIDENCE_SET_CONFLICT" {
		t.Fatal("contradictory presentation accepted", r)
	}
	observation["first_presented_at"] = learningBounds("2026-10-27T00:02:00Z")
	if r := learningPost(t, db, user, observation); len(r.AcknowledgedIDs) != 1 {
		t.Fatal(r)
	}
	observation["id"] = "different-prompt"
	observation["prompt_id"] = "p2"
	if r := learningPost(t, db, user, observation); len(r.RejectedRecords) != 1 || r.RejectedRecords[0].ErrorCode != "EVIDENCE_SET_CONFLICT" {
		t.Fatal("presentation reused", r)
	}
	terminal := learningFixture("terminal", "end", map[string]any{"session_id": "review", "status": "abandoned", "ended_at": "2026-10-27T00:00:30Z", "observation_ids": []string{"answer"}})
	if r := learningPost(t, db, user, terminal); len(r.RejectedRecords) != 1 {
		t.Fatal("terminal before observation accepted", r)
	}
	terminal["ended_at"] = "2026-10-27T00:02:00Z"
	if r := learningPost(t, db, user, terminal); len(r.AcknowledgedIDs) != 1 {
		t.Fatal(r)
	}
	close := learningFixture("exposure-close", "close", map[string]any{"open_id": "open", "end_reason": "stopped", "last_exposure": map[string]any{"K": learningBounds("2026-10-27T00:00:00Z")}})
	if r := learningPost(t, db, user, close); len(r.RejectedRecords) != 1 {
		t.Fatal("closure before start accepted", r)
	}
}
func TestLearningEvidencePostgresConflictsAndAtomicRollback(t *testing.T) {
	db, user := sessionStorageDB(t)
	first := learningPlanFixture()
	conflict := learningPlanFixture()
	conflict["freq_hz"] = 650
	if r := learningPost(t, db, user, first, conflict); len(r.AcknowledgedIDs) != 0 || len(r.RejectedRecords) != 1 {
		t.Fatal("conflicting duplicate was partially stored", r)
	}
	var count int64
	if err := db.Model(&models.LearningEvidenceRecord{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatal(count, err)
	}
	hook := "learning-fail-change-" + uuid.NewString()
	if err := db.Callback().Create().Before("gorm:create").Register(hook, func(tx *gorm.DB) {
		if tx.Statement.Table == "learning_evidence_changes" {
			tx.AddError(errors.New("synthetic change insert failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove(hook) })
	response := learningRequest(t, db, user, "POST", "/v1/training/learning-evidence/batch", map[string]any{"schema_version": 1, "client_id": uuid.NewString(), "records": []any{first}})
	if response.Code != 500 {
		t.Fatal("partial transaction acknowledged", response.Code, response.Body)
	}
	for _, model := range []any{&models.LearningEvidenceRecord{}, &models.LearningEvidenceChange{}} {
		if err := db.Model(model).Where("user_id = ?", user.ID).Count(&count).Error; err != nil || count != 0 {
			t.Fatal("transaction did not roll back", count, err)
		}
	}
}

// Requests race through independent transactions against one account. The
// ledger row lock must preserve both retry acknowledgements and one revision.
func TestLearningEvidencePostgresConcurrentUploadsAndFixedCeiling(t *testing.T) {
	db, _ := sessionStorageDB(t)
	for _, conflicting := range []bool{false, true} {
		name := "identical uploads"
		if conflicting {
			name = "conflicting IDs"
		}
		t.Run(name, func(t *testing.T) {
			user := sessionStorageUser(t, db)
			first, second := learningPlanFixture(), learningPlanFixture()
			if conflicting {
				second["freq_hz"] = 650
			}
			ready := make(chan struct{})
			responses := make(chan *httptest.ResponseRecorder, 2)
			for _, plan := range []map[string]any{first, second} {
				payload := map[string]any{"schema_version": 1, "client_id": uuid.NewString(), "records": []any{plan}}
				go func() {
					<-ready
					responses <- learningRequest(t, db, user, "POST", "/v1/training/learning-evidence/batch", payload)
				}()
			}
			close(ready)
			acknowledgements, rejections := 0, 0
			for range 2 {
				response := <-responses
				var result learningBatchResponse
				if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil {
					t.Fatalf("concurrent upload: %d %s", response.Code, response.Body)
				}
				acknowledgements += len(result.AcknowledgedIDs)
				rejections += len(result.RejectedRecords)
				for _, rejected := range result.RejectedRecords {
					if rejected.ErrorCode != "ID_CONFLICT" || rejected.Retryable {
						t.Fatalf("unexpected conflict: %+v", rejected)
					}
				}
			}
			wantAck, wantReject := 2, 0
			if conflicting {
				wantAck, wantReject = 1, 1
			}
			if acknowledgements != wantAck || rejections != wantReject {
				t.Fatalf("ack/reject = %d/%d, want %d/%d", acknowledgements, rejections, wantAck, wantReject)
			}
			for _, model := range []any{&models.LearningEvidenceRecord{}, &models.LearningEvidenceChange{}} {
				var count int64
				if err := db.Model(model).Where("user_id = ?", user.ID).Count(&count).Error; err != nil || count != 1 {
					t.Fatalf("concurrent writes duplicated %T: %d %v", model, count, err)
				}
			}
			var state models.LearningEvidenceSyncState
			if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 1 {
				t.Fatalf("concurrent revision: %+v %v", state, err)
			}
		})
	}
	t.Run("new commit waits for drained checkpoint", func(t *testing.T) {
		user := sessionStorageUser(t, db)
		previousKey := configs.App.JWTSecret
		configs.App.JWTSecret = []byte("learning-fixed-ceiling-test")
		t.Cleanup(func() { configs.App.JWTSecret = previousKey })
		exposure := func(id string) map[string]any {
			return learningFixture("exposure-open", id, map[string]any{"session_id": nil, "presentation_id": id + "-sound", "characters": []string{"K"}, "source": "reference", "started_at": nil})
		}
		if r := learningPost(t, db, user, learningPlanFixture(), exposure("before-page")); len(r.AcknowledgedIDs) != 2 {
			t.Fatal(r)
		}
		read := func(cursor string) learningChangesResponse {
			t.Helper()
			path := "/v1/training/learning-evidence/changes?limit=1"
			if cursor != "" {
				path += "&cursor=" + url.QueryEscape(cursor)
			}
			response := learningRequest(t, db, user, "GET", path, nil)
			var page learningChangesResponse
			if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &page) != nil {
				t.Fatalf("feed: %d %s", response.Code, response.Body)
			}
			return page
		}
		first := read("")
		if len(first.Changes) != 1 || first.Changes[0].Revision != "1" || !first.HasMore {
			t.Fatalf("first page: %+v", first)
		}
		// Late client occurrence must still be discoverable by its new commit revision.
		late := exposure("after-page")
		late["recorded_at"] = "2026-10-01T00:00:00Z"
		if r := learningPost(t, db, user, late); len(r.AcknowledgedIDs) != 1 {
			t.Fatal(r)
		}
		second := read(first.NextCursor)
		checkpoint, err := decodeLearningChangesCursor(second.NextCursor, configs.App.JWTSecret)
		if err != nil || len(second.Changes) != 1 || second.Changes[0].Revision != "2" || second.HasMore || checkpoint.HighWater != 2 || checkpoint.After != 2 {
			t.Fatalf("ceiling changed while paging: %+v %+v %v", second, checkpoint, err)
		}
		third := read(second.NextCursor)
		checkpoint, err = decodeLearningChangesCursor(third.NextCursor, configs.App.JWTSecret)
		if err != nil || len(third.Changes) != 1 || third.Changes[0].Revision != "3" || third.HasMore || checkpoint.HighWater != 3 || checkpoint.After != 3 {
			t.Fatalf("new commit was skipped: %+v %+v %v", third, checkpoint, err)
		}
	})
}
