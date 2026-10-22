package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestSnapshotStreamsCompleteHistoryAndHonorsCancellation(t *testing.T) {
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
	user := models.User{Username: "snapshot_" + uuid.NewString(), Email: uuid.NewString() + "@example.invalid", Password: "unused"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Unscoped().Delete(&user).Error; err != nil {
			t.Error(err)
		}
	})
	now := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	events := make([]models.TrainingEvent, 1001)
	for i := range events {
		character := "T"
		if i%2 == 1 {
			character = "E"
		}
		session := "old"
		if i >= 2 {
			session = "new"
		}
		events[i] = models.TrainingEvent{UserID: user.ID, EventID: uuid.NewString(), SessionID: session, PromptID: "prompt", PromptKind: "recall", TargetCharacter: character, EnteredText: character, IsCorrect: true, Classification: "automatic", LatencyMS: 1000, InputMode: "keyboard", CharWPM: 20, EffWPM: 10, FreqHz: 600, ClientCreatedAt: now.Add(time.Duration(i) * time.Second)}
	}
	events[1000].Classification = "unmeasured"
	if err := db.CreateInBatches(&events, 100).Error; err != nil {
		t.Fatal(err)
	}
	request := func(ctx context.Context) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(http.MethodGet, "/snapshot", nil).WithContext(ctx)
		c.Set("user", &user)
		TrainingHandler{DB: db}.GetSnapshot(c)
		return response
	}
	response := request(context.Background())
	if response.Code != 200 {
		t.Fatalf("snapshot status=%d: %s", response.Code, response.Body.String())
	}
	var snapshot common.TrainingSnapshotResponse
	if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.LastActiveAt == nil || !snapshot.LastActiveAt.Equal(events[1000].ClientCreatedAt) || len(snapshot.CharacterMasteries) != 2 {
		t.Fatalf("lost history: %+v", snapshot)
	}
	for _, mastery := range snapshot.CharacterMasteries {
		if mastery.TotalAttempts != 500 || mastery.Status != "stable" || mastery.RollingAccuracy != 1 {
			t.Fatalf("incorrect full-history mastery: %+v", mastery)
		}
	}
	tied := make([]models.TrainingEvent, 21)
	for i := range tied {
		tied[i] = events[0]
		tied[i].Base = models.Base{ID: uuid.MustParse(fmt.Sprintf("ffffffff-ffff-7000-8000-%012x", i+1))}
		tied[i].EventID = tied[i].ID.String()
		tied[i].SessionID = "tied"
		tied[i].TargetCharacter, tied[i].EnteredText = "Q", "Q"
		tied[i].ClientCreatedAt = now.Add(-time.Minute)
	}
	// Ascending UUID order drops the first incorrect answer from the rolling window.
	tied[0].IsCorrect, tied[0].Classification, tied[0].EnteredText = false, "incorrect", "E"
	if err := db.Create(&tied).Error; err != nil {
		t.Fatal(err)
	}
	response = request(context.Background())
	if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	masteries := snapshot.CharacterMasteries
	if response.Code != 200 || len(masteries) != 3 || masteries[0].Character != "E" || masteries[1].Character != "Q" || masteries[2].Character != "T" {
		t.Fatalf("unordered character masteries: %d %s", response.Code, response.Body)
	}
	if q := masteries[1]; q.TotalAttempts != 21 || q.RollingAccuracy != 1 || q.Status != "learning" {
		t.Fatalf("incorrect timestamp tie order: %+v", q)
	}
	if snapshot.LastActiveAt == nil || !snapshot.LastActiveAt.Equal(events[1000].ClientCreatedAt) {
		t.Fatalf("unmeasured activity lost: %+v", snapshot)
	}

	older := time.Unix(0, 0).UTC()
	profile := models.TrainingProfile{UserID: user.ID, SuggestedStep: 7, UnlockedStep: 9, LastActiveAt: &older}
	if err := db.Create(&profile).Error; err != nil {
		t.Fatal(err)
	}
	response = request(context.Background())
	if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || snapshot.SuggestedStep != 7 || snapshot.UnlockedStep != 9 || snapshot.LastActiveAt == nil || !snapshot.LastActiveAt.Equal(older) {
		t.Fatalf("profile did not override history: %d %s", response.Code, response.Body)
	}
	if err := db.Model(&profile).Updates(map[string]any{"suggested_step": 0, "unlocked_step": -3, "last_active_at": nil}).Error; err != nil {
		t.Fatal(err)
	}
	response = request(context.Background())
	if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || snapshot.SuggestedStep != 1 || snapshot.UnlockedStep != 1 || snapshot.LastActiveAt == nil || !snapshot.LastActiveAt.Equal(events[1000].ClientCreatedAt) {
		t.Fatalf("incorrect profile fallback: %d %s", response.Code, response.Body)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if response := request(canceled); response.Code != 500 {
		t.Fatalf("canceled snapshot emitted success: %d", response.Code)
	}
}
