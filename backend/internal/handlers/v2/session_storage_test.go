package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"opencw/internal/common"
	v1handlers "opencw/internal/handlers/v1"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Tests use the existing disposable database contract and never migrate schemas.
func sessionStorageDB(t *testing.T) (*gorm.DB, models.User) {
	t.Helper()
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
	return db, sessionStorageUser(t, db)
}

func sessionStorageUser(t *testing.T, db *gorm.DB) models.User {
	t.Helper()
	user := models.User{Username: "session_" + uuid.NewString(), Email: uuid.NewString() + "@example.invalid", Password: "unused"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Unscoped().Delete(&user).Error; err != nil {
			t.Error(err)
		}
	})
	return user
}

func sessionStorageRequest(t *testing.T, db *gorm.DB, user models.User, method, path string, payload any, ctx context.Context) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set("user", &user) })
	h := TrainingHandler{DB: db}
	engine.POST("/v1/training/sessions/batch", h.PostSessionsBatch)
	engine.POST("/v1/training/events/batch", h.PostEventsBatch)
	engine.GET("/v1/training/sessions", h.GetSessions)
	engine.GET("/v1/training/changes", h.GetChanges)
	engine.GET("/v1/training/snapshot", h.GetSnapshot)
	progress := v1handlers.ProgressHandler{DB: db}
	engine.PUT("/v1/cw/progress", progress.AddProgress)
	engine.GET("/v1/cw/progress", progress.GetAllProgress)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, bytes.NewReader(body)).WithContext(ctx)
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(response, request)
	return response
}

func sessionStorageSession(id, mode string) map[string]any {
	record := map[string]any{
		"session_id": id, "mode": mode, "curriculum_version": "koch-39-v1", "lesson": 1,
		"status": "completed", "started_at": "2026-10-20T00:00:00Z", "ended_at": "2026-10-20T00:01:00Z",
		"char_wpm": 20, "eff_wpm": 12, "freq_hz": 600,
		"prompt_count": 4, "attempt_count": 0, "event_ids": []string{},
	}
	if mode == "practice" {
		record["prompt_count"], record["attempt_count"] = 1, 1
		record["accuracy"], record["scoring_version"] = 0.92, "practice-copy-v1"
	}
	return record
}

func sessionStoragePost(t *testing.T, db *gorm.DB, user models.User, sessions ...map[string]any) common.TrainingSessionBatchResponse {
	t.Helper()
	response := sessionStorageRequest(t, db, user, "POST", "/v1/training/sessions/batch", map[string]any{
		"schema_version": 1, "client_id": uuid.NewString(), "sessions": sessions,
	}, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("session batch: %d %s", response.Code, response.Body.String())
	}
	var result common.TrainingSessionBatchResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func sessionStorageEvents(t *testing.T, db *gorm.DB, user models.User, events ...map[string]any) common.TrainingEventBatchResponse {
	t.Helper()
	response := sessionStorageRequest(t, db, user, "POST", "/v1/training/events/batch", map[string]any{"schema_version": 1, "events": events}, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("event batch: %d %s", response.Code, response.Body.String())
	}
	var result common.TrainingEventBatchResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func sessionStorageEvent(id, session, classification string, correct bool) map[string]any {
	entered := "K"
	if !correct {
		entered = "M"
	}
	return map[string]any{
		"id": id, "session_id": session, "prompt_id": "prompt-" + id, "prompt_kind": "recall",
		"target_character": "K", "entered_text": entered, "is_correct": correct,
		"classification": classification, "latency_ms": 1000, "replay_count": 0, "input_mode": "keyboard",
		"char_wpm": 20, "eff_wpm": 12, "freq_hz": 600, "created_at": "2026-10-20T00:00:20Z",
	}
}

func TestSessionStorageDerivesGuidedScoresAndSeparatesPractice(t *testing.T) {
	db, user := sessionStorageDB(t)
	first := sessionStorageEvent("first", "guided", "automatic", true)
	second := sessionStorageEvent("second", "guided", "incorrect", false)
	match := sessionStorageEvent("match", "guided", "unmeasured", true)
	match["prompt_kind"] = "unscored-match"
	if result := sessionStorageEvents(t, db, user, first, second, match); len(result.AcknowledgedIDs) != 3 || len(result.RejectedEvents) != 0 {
		t.Fatalf("event evidence: %+v", result)
	}
	guided := sessionStorageSession("guided", "guided")
	guided["attempt_count"], guided["event_ids"] = 3, []string{"second", "match", "first"}
	if result := sessionStoragePost(t, db, user, guided, sessionStorageSession("practice", "practice")); len(result.AcknowledgedIDs) != 2 || len(result.RejectedSessions) != 0 {
		t.Fatalf("terminal history: %+v", result)
	}
	var records []models.TrainingSession
	if err := db.Where("user_id = ?", user.ID).Order("session_id").Find(&records).Error; err != nil || len(records) != 2 {
		t.Fatalf("history records=%+v err=%v", records, err)
	}
	g, p := records[0], records[1]
	if g.Accuracy == nil || *g.Accuracy != 0.5 || g.ScoredAttemptCount == nil || *g.ScoredAttemptCount != 2 || g.CorrectAttemptCount == nil || *g.CorrectAttemptCount != 1 || len(g.EventIDs) != 3 || *g.PromptCount != 4 {
		t.Fatalf("guided scored/intro evidence: %+v", g)
	}
	if p.Accuracy == nil || *p.Accuracy != 0.92 || len(p.EventIDs) != 0 || p.Mode == nil || *p.Mode != "practice" {
		t.Fatalf("practice history: %+v", p)
	}
	var evidence int64
	if err := db.Model(&models.TrainingEvent{}).Where("user_id = ?", user.ID).Count(&evidence).Error; err != nil || evidence != 3 {
		t.Fatalf("practice produced guided evidence: %d err=%v", evidence, err)
	}
	response := sessionStorageRequest(t, db, user, "GET", "/v1/training/snapshot", nil, nil)
	var snapshot common.TrainingSnapshotResponse
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &snapshot) != nil || len(snapshot.CharacterMasteries) != 1 || snapshot.CharacterMasteries[0].TotalAttempts != 2 {
		t.Fatalf("practice changed mastery: %d %s", response.Code, response.Body.String())
	}
}

func TestSessionStorageKeepsUnmeasuredIntroductionsAndUnknownEndTime(t *testing.T) {
	db, user := sessionStorageDB(t)
	introduction := sessionStorageSession("intro-only", "guided")
	abandoned := sessionStorageSession("abandoned", "guided")
	abandoned["status"], abandoned["ended_at"] = "abandoned", nil
	if result := sessionStoragePost(t, db, user, introduction, abandoned); len(result.AcknowledgedIDs) != 2 || len(result.RejectedSessions) != 0 {
		t.Fatalf("introductions do not require responses: %+v", result)
	}
	var records []models.TrainingSession
	if err := db.Where("user_id = ?", user.ID).Find(&records).Error; err != nil || len(records) != 2 {
		t.Fatalf("history records=%+v err=%v", records, err)
	}
	for _, record := range records {
		if record.Accuracy != nil || record.ScoredAttemptCount == nil || *record.ScoredAttemptCount != 0 || record.CorrectAttemptCount == nil || *record.CorrectAttemptCount != 0 {
			t.Fatalf("unmeasured lesson acquired a score: %+v", record)
		}
		if record.SessionID == "abandoned" && (record.EndedAt != nil || record.StartedAt == nil || !record.OccurredAt.Equal(*record.StartedAt) || record.OccurredAtSource != "client_start") {
			t.Fatalf("unknown abandonment end was fabricated: %+v", record)
		}
	}
}

func TestSessionStorageRetriesConflictsAndPartialSiblings(t *testing.T) {
	db, user := sessionStorageDB(t)
	record := sessionStorageSession("retry", "practice")
	if result := sessionStoragePost(t, db, user, record, record); len(result.AcknowledgedIDs) != 1 || len(result.RejectedSessions) != 0 {
		t.Fatalf("identical repeated ID: %+v", result)
	}
	// A different diagnostic installation and equivalent timestamp retain identity.
	record["started_at"] = "2026-10-20T08:00:00+08:00"
	if result := sessionStoragePost(t, db, user, record); len(result.AcknowledgedIDs) != 1 || len(result.RejectedSessions) != 0 {
		t.Fatalf("normalized retry: %+v", result)
	}
	record["accuracy"] = 0.5
	if result := sessionStoragePost(t, db, user, record, sessionStorageSession("sibling", "practice")); len(result.AcknowledgedIDs) != 1 || len(result.RejectedSessions) != 1 || result.RejectedSessions[0].ErrorCode != "ID_CONFLICT" || result.RejectedSessions[0].Retryable {
		t.Fatalf("immutable conflict blocked sibling: %+v", result)
	}
	a, b := sessionStorageSession("duplicate-conflict", "practice"), sessionStorageSession("duplicate-conflict", "practice")
	b["lesson"] = 2
	if result := sessionStoragePost(t, db, user, a, b); len(result.AcknowledgedIDs) != 0 || len(result.RejectedSessions) != 1 || result.RejectedSessions[0].ErrorCode != "ID_CONFLICT" {
		t.Fatalf("conflicting repeated ID: %+v", result)
	}
	var state models.TrainingSyncState
	var stored models.TrainingSession
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 2 {
		t.Fatalf("retries allocated revisions: %+v err=%v", state, err)
	}
	if err := db.Take(&stored, "user_id = ? AND session_id = ?", user.ID, "retry").Error; err != nil || stored.Accuracy == nil || *stored.Accuracy != 0.92 {
		t.Fatalf("retry mutated stored score: %+v err=%v", stored, err)
	}
}

func TestSessionStorageManifestIntegrityAndFrozenEventPaths(t *testing.T) {
	db, user := sessionStorageDB(t)
	guided := sessionStorageSession("guided", "guided")
	guided["attempt_count"], guided["event_ids"] = 1, []string{"expected"}
	if result := sessionStoragePost(t, db, user, guided); len(result.RejectedSessions) != 1 || result.RejectedSessions[0].ErrorCode != "MISSING_SESSION_EVENTS" || !result.RejectedSessions[0].Retryable {
		t.Fatalf("missing evidence must be retryable: %+v", result)
	}
	expected := sessionStorageEvent("expected", "guided", "automatic", true)
	if result := sessionStorageEvents(t, db, user, expected); len(result.AcknowledgedIDs) != 1 {
		t.Fatalf("initial event: %+v", result)
	}
	if result := sessionStoragePost(t, db, user, guided); len(result.AcknowledgedIDs) != 1 || len(result.RejectedSessions) != 0 {
		t.Fatalf("finalization after events: %+v", result)
	}
	if result := sessionStorageEvents(t, db, user, sessionStorageEvent("extra", "guided", "automatic", true)); len(result.AcknowledgedIDs) != 0 || len(result.RejectedEvents) != 1 {
		t.Fatalf("frozen manifest accepted new event: %+v", result)
	}
	expected["latency_ms"], expected["created_at"] = 5000, "2030-01-01T00:00:00Z"
	if result := sessionStorageEvents(t, db, user, expected); len(result.AcknowledgedIDs) != 1 || len(result.RejectedEvents) != 0 {
		t.Fatalf("schema-1 first-write-wins retry: %+v", result)
	}
	var persisted models.TrainingEvent
	if err := db.Take(&persisted, "user_id = ? AND event_id = ?", user.ID, "expected").Error; err != nil || persisted.LatencyMS != 1000 {
		t.Fatalf("frozen duplicate changed evidence: %+v err=%v", persisted, err)
	}
	var profile models.TrainingProfile
	if err := db.Take(&profile, "user_id = ?", user.ID).Error; err != nil || profile.LastActiveAt == nil || profile.LastActiveAt.Year() != 2026 {
		t.Fatalf("conflicting duplicate advanced activity: %+v err=%v", profile, err)
	}
	sessionStoragePost(t, db, user, sessionStorageSession("practice", "practice"))
	if result := sessionStorageEvents(t, db, user, sessionStorageEvent("practice-event", "practice", "automatic", true)); len(result.AcknowledgedIDs) != 0 || len(result.RejectedEvents) != 1 {
		t.Fatalf("practice accepted guided evidence: %+v", result)
	}
	sessionStorageEvents(t, db, user, sessionStorageEvent("unexpected", "unfinished", "automatic", true))
	if result := sessionStoragePost(t, db, user, sessionStorageSession("unfinished", "guided")); len(result.RejectedSessions) != 1 || result.RejectedSessions[0].ErrorCode != "SESSION_EVENT_SET_CONFLICT" || result.RejectedSessions[0].Retryable {
		t.Fatalf("unexpected evidence must be permanent conflict: %+v", result)
	}
	if result := sessionStoragePost(t, db, user, sessionStorageSession("unfinished", "practice")); len(result.AcknowledgedIDs) != 0 || len(result.RejectedSessions) != 1 {
		t.Fatalf("practice finalized over guided evidence: %+v", result)
	}
}

func TestSessionStorageSerializesFinalizationAndConcurrentEvidence(t *testing.T) {
	db, user := sessionStorageDB(t)
	sessionStorageEvents(t, db, user, sessionStorageEvent("initial", "race", "automatic", true))
	guided := sessionStorageSession("race", "guided")
	guided["attempt_count"], guided["event_ids"] = 1, []string{"initial"}
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 2)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go func() {
		<-start
		responses <- sessionStorageRequest(t, db, user, "POST", "/v1/training/sessions/batch", map[string]any{"schema_version": 1, "client_id": uuid.NewString(), "sessions": []any{guided}}, ctx)
	}()
	go func() {
		<-start
		responses <- sessionStorageRequest(t, db, user, "POST", "/v1/training/events/batch", map[string]any{"schema_version": 1, "events": []any{sessionStorageEvent("concurrent", "race", "automatic", true)}}, ctx)
	}()
	close(start)
	accepted := 0
	for i := 0; i < 2; i++ {
		response := <-responses
		var result struct {
			AcknowledgedIDs []string `json:"acknowledged_ids"`
		}
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatalf("concurrent write: %d %s", response.Code, response.Body.String())
		}
		accepted += len(result.AcknowledgedIDs)
	}
	if accepted != 1 {
		t.Fatalf("terminal manifest and outside evidence both committed: %d acknowledgements", accepted)
	}
	var sessions, events int64
	if err := db.Model(&models.TrainingSession{}).Where("user_id = ?", user.ID).Count(&sessions).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.TrainingEvent{}).Where("user_id = ?", user.ID).Count(&events).Error; err != nil {
		t.Fatal(err)
	}
	if (sessions != 1 || events != 1) && (sessions != 0 || events != 2) {
		t.Fatalf("persisted history violates the frozen event set: sessions=%d events=%d", sessions, events)
	}
}

func TestSessionStorageOwnershipCancellationAndRollback(t *testing.T) {
	db, user := sessionStorageDB(t)
	other := sessionStorageUser(t, db)
	for _, owner := range []models.User{user, other} {
		if result := sessionStoragePost(t, db, owner, sessionStorageSession("shared-id", "practice")); len(result.AcknowledgedIDs) != 1 {
			t.Fatalf("account-scoped identity: %+v", result)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	batch := map[string]any{"schema_version": 1, "client_id": uuid.NewString(), "sessions": []any{sessionStorageSession("canceled", "practice")}}
	if response := sessionStorageRequest(t, db, user, "POST", "/v1/training/sessions/batch", batch, ctx); response.Code != 500 {
		t.Fatalf("canceled request acknowledged success: %d %s", response.Code, response.Body.String())
	}
	const callback = "test:training-change-failure"
	if err := db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "training_changes" {
			tx.AddError(errors.New("injected revision payload failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove(callback) })
	batch["sessions"] = []any{sessionStorageSession("rollback-one", "practice"), sessionStorageSession("rollback-two", "practice")}
	if response := sessionStorageRequest(t, db, user, "POST", "/v1/training/sessions/batch", batch, nil); response.Code != 500 {
		t.Fatalf("failed transaction acknowledged success: %d %s", response.Code, response.Body.String())
	}
	if err := db.Callback().Create().Remove(callback); err != nil {
		t.Fatal(err)
	}
	var records, changes int64
	var state models.TrainingSyncState
	if err := db.Model(&models.TrainingSession{}).Where("user_id = ?", user.ID).Count(&records).Error; err != nil || records != 1 {
		t.Fatalf("partial session transaction survived: %d err=%v", records, err)
	}
	if err := db.Model(&models.TrainingChange{}).Where("user_id = ?", user.ID).Count(&changes).Error; err != nil || changes != 1 {
		t.Fatalf("partial changes survived: %d err=%v", changes, err)
	}
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 1 {
		t.Fatalf("failed write advanced account revision: %+v err=%v", state, err)
	}
}

func TestSessionStorageExistingWritersRollBackAndRecover(t *testing.T) {
	for _, tc := range []struct {
		name, path string
		method     string
		payload    map[string]any
		status     int
		want       []int64
	}{
		{"event", "/v1/training/events/batch", "POST", map[string]any{"schema_version": 1, "events": []any{sessionStorageEvent("retry-event", "unfinished", "automatic", true)}}, 200, []int64{1, 1, 1, 1, 0, 0}},
		{"legacy", "/v1/cw/progress", "PUT", map[string]any{"lesson": 1, "char_wpm": 20, "eff_wpm": 12, "accuracy": 0.8}, 201, []int64{0, 1, 1, 1, 1, 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, user := sessionStorageDB(t)
			callback := "test:existing-writer-change-failure-" + uuid.NewString()
			if err := db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
				if tx.Statement.Table == "training_changes" {
					tx.AddError(errors.New("injected immutable change failure"))
				}
			}); err != nil {
				t.Fatal(err)
			}
			registered := true
			t.Cleanup(func() {
				if registered {
					if err := db.Callback().Create().Remove(callback); err != nil {
						t.Error(err)
					}
				}
			})
			response := sessionStorageRequest(t, db, user, tc.method, tc.path, tc.payload, nil)
			var envelope map[string]json.RawMessage
			if response.Code != 500 || json.Unmarshal(response.Body.Bytes(), &envelope) != nil || envelope["acknowledged_ids"] != nil {
				t.Fatalf("failed writer acknowledged success: %d %s", response.Code, response.Body.String())
			}
			modelsToCount := []any{&models.TrainingEvent{}, &models.TrainingProfile{}, &models.TrainingSyncState{}, &models.TrainingChange{}, &models.Progress{}, &models.TrainingSession{}}
			assertCounts := func(want []int64) {
				t.Helper()
				for i, model := range modelsToCount {
					var count int64
					if err := db.Model(model).Where("user_id = ?", user.ID).Count(&count).Error; err != nil || count != want[i] {
						t.Fatalf("%T count=%d want=%d err=%v", model, count, want[i], err)
					}
				}
			}
			assertCounts([]int64{0, 0, 0, 0, 0, 0})
			if err := db.Callback().Create().Remove(callback); err != nil {
				t.Fatal(err)
			}
			registered = false
			response = sessionStorageRequest(t, db, user, tc.method, tc.path, tc.payload, nil)
			if response.Code != tc.status {
				t.Fatalf("retry after rollback: %d %s", response.Code, response.Body.String())
			}
			assertCounts(tc.want)
			var state models.TrainingSyncState
			if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 1 {
				t.Fatalf("failed write consumed a revision: %+v err=%v", state, err)
			}
		})
	}
}

func TestSessionStorageBackfillsLegacyWithoutInventingUnknowns(t *testing.T) {
	db, user := sessionStorageDB(t)
	receipt := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	completion := receipt.Add(-24 * time.Hour)
	legacy := []models.Progress{
		{Base: models.Base{CreatedAt: receipt}, UserID: user.ID, Lesson: 70, CharWPM: 20, EffWPM: 12, Accuracy: 0.8},
		{Base: models.Base{CreatedAt: receipt.Add(time.Hour)}, UserID: user.ID, Lesson: 2, CharWPM: 25, EffWPM: 10, Accuracy: 0.9, ClientCreatedAt: &completion},
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	event := models.TrainingEvent{UserID: user.ID, EventID: "orphan", SessionID: "unfinished", PromptID: "prompt", PromptKind: "recall", TargetCharacter: "K", EnteredText: "K", IsCorrect: true, Classification: "automatic", LatencyMS: 1000, InputMode: "keyboard", CharWPM: 20, EffWPM: 12, FreqHz: 600, ClientCreatedAt: receipt.Add(48 * time.Hour)}
	if err := db.Create(&event).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		response := sessionStorageRequest(t, db, user, "GET", "/v1/training/sessions?mode=all&status=all", nil, nil)
		if response.Code != 200 {
			t.Fatalf("history initialization: %d %s", response.Code, response.Body.String())
		}
	}
	var records []models.TrainingSession
	if err := db.Where("user_id = ?", user.ID).Order("lesson DESC").Find(&records).Error; err != nil || len(records) != 2 {
		t.Fatalf("legacy backfill duplicated/fabricated records: %+v err=%v", records, err)
	}
	for i, record := range records {
		if record.Mode != nil || record.StartedAt != nil || record.FreqHz != nil || record.PromptCount != nil || record.AttemptCount != nil || len(record.EventIDs) != 0 || record.SourceKind != "legacy_v1" || record.SourceRecordID == nil || record.SessionID != "legacy:"+legacy[i].ID.String() {
			t.Fatalf("invented legacy measurements/provenance: %+v", record)
		}
	}
	if records[0].Lesson != 70 || records[0].EndedAt != nil || !records[0].OccurredAt.Equal(receipt) || records[1].EndedAt == nil || !records[1].EndedAt.Equal(completion) || !records[1].OccurredAt.Equal(completion) {
		t.Fatalf("legacy lesson/timing preservation: %+v", records)
	}
	var profile models.TrainingProfile
	if err := db.Take(&profile, "user_id = ?", user.ID).Error; err != nil || profile.LastActiveAt == nil || !profile.LastActiveAt.Equal(event.ClientCreatedAt) {
		t.Fatalf("bootstrap lost activity from orphan evidence: %+v err=%v", profile, err)
	}
	var changes int64
	if err := db.Model(&models.TrainingChange{}).Where("user_id = ?", user.ID).Count(&changes).Error; err != nil || changes != 3 {
		t.Fatalf("backfill lost orphan evidence or duplicated changes: %d err=%v", changes, err)
	}
	response := sessionStorageRequest(t, db, user, "PUT", "/v1/cw/progress", map[string]any{"lesson": 3, "char_wpm": 20, "eff_wpm": 12, "accuracy": 0.7}, nil)
	if response.Code != 201 {
		t.Fatalf("legacy write contract: %d %s", response.Code, response.Body.String())
	}
	if err := db.Model(&models.TrainingSession{}).Where("user_id = ?", user.ID).Count(&changes).Error; err != nil || changes != 3 {
		t.Fatalf("legacy write missing atomic mirror: %d err=%v", changes, err)
	}
}
