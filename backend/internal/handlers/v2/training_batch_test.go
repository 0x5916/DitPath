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

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func trainingBatchFixture(t *testing.T) (*gorm.DB, models.User) {
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
	user := models.User{Username: "batch_" + uuid.NewString(), Email: uuid.NewString() + "@example.invalid", Password: "unused"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Unscoped().Delete(&user).Error; err != nil {
			t.Error(err)
		}
	})
	return db, user
}

func trainingBatchEvent(id, createdAt string) map[string]any {
	event := validEventMap()
	event["id"], event["created_at"] = id, createdAt
	return event
}

func trainingBatchSnapshot(t *testing.T, db *gorm.DB, user models.User, events []any, status int, snapshot string) {
	t.Helper()
	body := mustJSON(t, map[string]any{"schema_version": 1, "events": events})
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodPost, "/v2/training/events/batch", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("user", &user)
	TrainingHandler{DB: db}.PostEventsBatch(c)
	if response.Code != status || response.Body.String() != snapshot || response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("response = %d %s %s; want %d %s", response.Code, response.Header().Get("Content-Type"), response.Body, status, snapshot)
	}
}

func assertTrainingBatchRollback(t *testing.T, db *gorm.DB, userID uuid.UUID) {
	t.Helper()
	for _, model := range []any{&models.TrainingEvent{}, &models.TrainingChange{}, &models.TrainingSyncState{}, &models.TrainingProfile{}} {
		var count int64
		if err := db.Model(model).Where("user_id = ?", userID).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("batch left %T rows: count=%d err=%v", model, count, err)
		}
	}
}

func TestTrainingBatchAllRejectedAvoidsDatabase(t *testing.T) {
	first := trainingBatchEvent(" first ", "2100-01-01T00:00:00Z")
	first["session_id"] = ""
	second := trainingBatchEvent("second", "2100-01-02T00:00:00Z")
	second["latency_ms"] = -1
	const snapshot = `{"acknowledged_ids":[],"rejected_events":[{"id":"first","error_code":"MISSING_FIELD","message":"session_id is required"},{"id":"second","error_code":"INVALID_TIMING","message":"latency_ms cannot be negative"}]}`
	trainingBatchSnapshot(t, nil, models.User{}, []any{first, second}, 200, snapshot)
}

func TestTrainingBatchDuplicatesPreserveAcknowledgementsAndActivity(t *testing.T) {
	db, user := trainingBatchFixture(t)
	second := trainingBatchEvent("second", "2100-01-02T00:00:00.123456789Z")
	first := trainingBatchEvent(" first ", "2100-01-01T00:00:00Z")
	first["target_character"], first["entered_text"] = " T ", " T "
	invalid := trainingBatchEvent(" rejected ", "2100-01-09T00:00:00Z")
	invalid["latency_ms"] = -1
	duplicate := trainingBatchEvent("second", "2100-01-03T00:00:00Z")
	const snapshot = `{"acknowledged_ids":["second"," first ","second"],"rejected_events":[{"id":"rejected","error_code":"INVALID_TIMING","message":"latency_ms cannot be negative"}]}`
	trainingBatchSnapshot(t, db, user, []any{second, invalid, first, duplicate}, 200, snapshot)
	var stored []models.TrainingEvent
	if err := db.Where("user_id = ?", user.ID).Find(&stored).Error; err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]models.TrainingEvent, len(stored))
	for _, event := range stored {
		byID[event.EventID] = event
	}
	const latest = "2100-01-02T00:00:00.123456Z"
	if len(stored) != 2 || byID["second"].ClientCreatedAt.Format(time.RFC3339Nano) != latest || byID[" first "].TargetCharacter != "T" || byID[" first "].EnteredText != "T" {
		t.Fatalf("stored batch changed: %+v", stored)
	}
	var profile models.TrainingProfile
	if err := db.Where("user_id = ?", user.ID).Take(&profile).Error; err != nil {
		t.Fatal(err)
	}
	if profile.LastActiveAt == nil || profile.LastActiveAt.Format(time.RFC3339Nano) != latest {
		t.Fatalf("activity did not use the normalized stored event: %+v", profile)
	}
	// A schema-1 retry acknowledges its ID without changing canonical activity.
	retry := trainingBatchEvent("second", "2100-01-04T00:00:00Z")
	trainingBatchSnapshot(t, db, user, []any{retry}, 200, `{"acknowledged_ids":["second"],"rejected_events":[]}`)
	if err := db.Where("user_id = ?", user.ID).Take(&profile).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&models.TrainingEvent{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 || profile.LastActiveAt == nil || profile.LastActiveAt.Format(time.RFC3339Nano) != latest {
		t.Fatalf("retry changed storage or activity: count=%d profile=%+v", count, profile)
	}
	var state models.TrainingSyncState
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 2 {
		t.Fatalf("retry allocated a history revision: state=%+v err=%v", state, err)
	}
	var changes []models.TrainingChange
	if err := db.Where("user_id = ?", user.ID).Order("revision ASC").Find(&changes).Error; err != nil || len(changes) != 2 {
		t.Fatalf("history changes=%+v err=%v", changes, err)
	}
	for index, id := range []string{"second", " first "} {
		var payload map[string]any
		if err := json.Unmarshal(changes[index].Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if changes[index].Kind != "attempt" || changes[index].RecordID != id || changes[index].Revision != int64(index+1) || byID[id].SyncRevision != changes[index].Revision || len(byID[id].PayloadHash) != 32 || payload["id"] != id || payload["created_at"] != byID[id].ClientCreatedAt.Format(time.RFC3339Nano) {
			t.Fatalf("canonical event/history mismatch: event=%+v change=%+v payload=%v", byID[id], changes[index], payload)
		}
	}
}

func TestTrainingBatchPreservesYearZeroActivityAndLegacySeed(t *testing.T) {
	db, user := trainingBatchFixture(t)
	if err := db.Create(&models.PageSettings{UserID: user.ID, Lang: "en", CurLesson: 8}).Error; err != nil {
		t.Fatal(err)
	}
	event := trainingBatchEvent("year-zero", "0000-01-01T00:00:00Z")
	trainingBatchSnapshot(t, db, user, []any{event}, 200, `{"acknowledged_ids":["year-zero"],"rejected_events":[]}`)
	var profile models.TrainingProfile
	if err := db.Where("user_id = ?", user.ID).Take(&profile).Error; err != nil {
		t.Fatal(err)
	}
	if profile.SuggestedStep != 8 || profile.UnlockedStep != 8 || profile.LastActiveAt == nil || !profile.LastActiveAt.Equal(time.Date(0, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("canonical year-zero activity or legacy seed changed: %+v", profile)
	}
}

func TestTrainingBatchInsertFailureDoesNotTouchProfile(t *testing.T) {
	db, user := trainingBatchFixture(t)
	profileQueries := 0
	if err := db.Callback().Query().Before("gorm:query").Register("test:batch_profile_queries", func(tx *gorm.DB) {
		if tx.Statement.Table == "page_settings" || tx.Statement.Table == "training_profiles" {
			profileQueries++
		}
	}); err != nil {
		t.Fatal(err)
	}
	defer db.Callback().Query().Remove("test:batch_profile_queries")
	if err := db.Callback().Create().Before("gorm:create").Register("test:batch_insert_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "training_events" {
			tx.AddError(errors.New("injected batch insert failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	defer db.Callback().Create().Remove("test:batch_insert_failure")
	event := trainingBatchEvent("failed", "2100-01-01T00:00:00Z")
	trainingBatchSnapshot(t, db, user, []any{event}, 500, `{"code":"TRAINING_INGEST_FAILED","error":"Failed to store training events"}`)
	if profileQueries != 0 {
		t.Fatalf("profile queries after failed insertion = %d", profileQueries)
	}
	assertTrainingBatchRollback(t, db, user.ID)
}

func TestTrainingBatchProfileFailureRollsBackAcceptedEvents(t *testing.T) {
	for _, stage := range []string{"page lookup", "profile create", "profile update"} {
		t.Run(stage, func(t *testing.T) {
			db, user := trainingBatchFixture(t)
			table := "training_profiles"
			register, remove := db.Callback().Create().Before("gorm:create").Register, db.Callback().Create().Remove
			if stage == "page lookup" {
				table = "page_settings"
				register, remove = db.Callback().Query().Before("gorm:query").Register, db.Callback().Query().Remove
			} else if stage == "profile update" {
				register, remove = db.Callback().Update().Before("gorm:update").Register, db.Callback().Update().Remove
			}
			if err := register("test:batch_profile_failure", func(tx *gorm.DB) {
				if tx.Statement.Table == table {
					tx.AddError(errors.New("injected profile failure"))
				}
			}); err != nil {
				t.Fatal(err)
			}
			defer remove("test:batch_profile_failure")
			event := trainingBatchEvent("rolled-back", "2100-01-01T00:00:00Z")
			trainingBatchSnapshot(t, db, user, []any{event}, 500, `{"code":"TRAINING_INGEST_FAILED","error":"Failed to store training events"}`)
			assertTrainingBatchRollback(t, db, user.ID)
		})
	}
}

func TestTrainingBatchCancellationRollsBackAcceptedEvents(t *testing.T) {
	for _, stage := range []string{"before transaction", "before profile"} {
		t.Run(stage, func(t *testing.T) {
			db, user := trainingBatchFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if stage == "before transaction" {
				cancel()
			} else {
				if err := db.Callback().Create().Before("gorm:create").Register("test:cancel_batch_profile", func(tx *gorm.DB) {
					if tx.Statement.Table == "training_profiles" {
						cancel()
					}
				}); err != nil {
					t.Fatal(err)
				}
				defer db.Callback().Create().Remove("test:cancel_batch_profile")
			}
			body := mustJSON(t, map[string]any{"schema_version": 1, "events": []any{trainingBatchEvent("cancelled", "2100-01-01T00:00:00Z")}})
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest(http.MethodPost, "/v2/training/events/batch", bytes.NewReader(body)).WithContext(ctx)
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("user", &user)
			TrainingHandler{DB: db}.PostEventsBatch(c)
			const snapshot = `{"code":"TRAINING_INGEST_FAILED","error":"Failed to store training events"}`
			if response.Code != 500 || response.Body.String() != snapshot || response.Header().Get("Content-Type") != "application/json; charset=utf-8" || !errors.Is(ctx.Err(), context.Canceled) {
				t.Fatalf("cancelled response = %d %s %s, context=%v", response.Code, response.Header().Get("Content-Type"), response.Body, ctx.Err())
			}
			assertTrainingBatchRollback(t, db, user.ID)
		})
	}
}
