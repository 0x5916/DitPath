package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Run against a migrated, disposable PostgreSQL database; no schema is changed.
func TestRefreshConcurrentSingleUse(t *testing.T) {
	dsn := os.Getenv("OPENCW_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("set OPENCW_TEST_DATABASE_DSN to a disposable PostgreSQL database")
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
	const workers = 8
	pool.SetMaxOpenConns(workers + 1)
	previousSecret := configs.App.JWTSecret
	configs.App.JWTSecret = []byte(strings.Repeat("test-only-key", 3))
	t.Cleanup(func() { configs.App.JWTSecret = previousSecret })
	user := models.User{Username: "refresh_" + uuid.NewString()[:8], Email: uuid.NewString() + "@example.invalid", Password: "unused"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Unscoped().Delete(&user).Error; err != nil {
			t.Error(err)
		}
	})
	raw, _, err := utils.IssueTokenPair(db, user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	// Hold every request after its read so the race is deterministic, rather
	// than relying on scheduler timing to make multiple stale reads overlap.
	ready := make(chan struct{}, workers)
	release := make(chan struct{})
	if err := db.Callback().Query().After("gorm:query").Register("test:refresh-barrier", func(tx *gorm.DB) {
		if tx.Statement.Table == "refresh_tokens" {
			ready <- struct{}{}
			<-release
		}
	}); err != nil {
		t.Fatal(err)
	}
	handler := &AuthHandler{DB: db}
	request := func(token string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/auth/refresh", strings.NewReader(`{"refresh_token":"`+token+`"}`))
		ctx.Request.Header.Set("Content-Type", "application/json")
		handler.Refresh(ctx)
		return recorder
	}
	results := make(chan *httptest.ResponseRecorder, workers)
	var pending sync.WaitGroup
	for range workers {
		pending.Go(func() { results <- request(raw) })
	}
	for range workers {
		select {
		case <-ready:
		case <-time.After(10 * time.Second):
			close(release)
			pending.Wait()
			t.Fatal("concurrent requests did not reach refresh lookup barrier")
		}
	}
	close(release)
	pending.Wait()
	if err := db.Callback().Query().Remove("test:refresh-barrier"); err != nil {
		t.Fatal(err)
	}
	close(results)
	winners := 0
	var successor common.AuthTokenPairResponse
	for response := range results {
		if response.Code == http.StatusOK {
			winners++
			if err := json.Unmarshal(response.Body.Bytes(), &successor); err != nil {
				t.Fatal(err)
			}
		} else {
			var rejected common.ErrorResponse
			if err := json.Unmarshal(response.Body.Bytes(), &rejected); err != nil || response.Code != http.StatusUnauthorized || rejected.Code != common.ErrorCodeInvalidToken {
				t.Fatalf("unexpected concurrent loser response: status %d", response.Code)
			}
		}
	}
	if winners != 1 {
		t.Fatalf("expected exactly one refresh winner, got %d", winners)
	}
	var active int64
	if err := db.Model(&models.RefreshToken{}).Where("user_id = ? AND revoked = false", user.ID).Count(&active).Error; err != nil || active != 1 {
		t.Fatalf("expected one active successor, got %d (error %v)", active, err)
	}
	if request(raw).Code != http.StatusUnauthorized {
		t.Fatal("consumed token replay succeeded")
	}
	if request(successor.RefreshToken).Code != http.StatusOK {
		t.Fatal("winning successor cannot refresh")
	}
}
