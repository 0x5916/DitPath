package handlers

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	settingsReadUserID  = "00000000-0000-7000-8000-000000000001"
	settingsDefaultCW   = `{"char_wpm":20,"eff_wpm":12,"freq":600,"start_delay":0.5,"updated_at":"0001-01-01T00:00:00Z"}`
	settingsDefaultPage = `{"language":"auto","cur_lesson":0,"updated_at":"0001-01-01T00:00:00Z"}`
	settingsStoredCW    = `{"char_wpm":30,"eff_wpm":15,"freq":800,"start_delay":1.25,"updated_at":"2026-10-16T00:00:00Z"}`
	settingsStoredPage  = `{"language":"en","cur_lesson":8,"updated_at":"2026-10-16T00:00:00Z"}`
	settingsZeroCW      = `{"char_wpm":0,"eff_wpm":0,"freq":0,"start_delay":0,"updated_at":"2026-10-16T00:00:00Z"}`
	settingsZeroPage    = `{"language":"","cur_lesson":0,"updated_at":"2026-10-16T00:00:00Z"}`
)

func settingsReadSnapshot(t *testing.T, db *gorm.DB, user *models.User, endpoint string, status int, body string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/settings/"+endpoint, nil)
	// These handlers currently ignore request cancellation when querying settings.
	ctx, cancel := context.WithCancel(c.Request.Context())
	cancel()
	c.Request = c.Request.WithContext(ctx)
	c.Set("user", user)
	handler := SettingsHandler{DB: db}
	switch endpoint {
	case "all":
		handler.GetAllSettings(c)
	case "cw":
		handler.GetCWSettings(c)
	case "page":
		handler.GetPageSettings(c)
	default:
		t.Fatalf("unknown settings endpoint %q", endpoint)
	}
	if recorder.Code != status || recorder.Body.String() != body || recorder.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("response = %d %s %s; want %d %s", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body, status, body)
	}
}

func combinedSettingsSnapshot(cw, page string) string {
	return `{"cw_settings":` + cw + `,"page_settings":` + page + `}`
}

func settingsReadQueries() []forumReadQuery {
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	return []forumReadQuery{
		{SQL: `SELECT * FROM "users" WHERE id = $1 AND "users"."deleted_at" IS NULL AND "users"."id" = $2 LIMIT $3`, Args: []any{settingsReadUserID, settingsReadUserID, int64(1)}, Columns: []string{"id"}, Rows: [][]driver.Value{{settingsReadUserID}}},
		{SQL: `SELECT * FROM "cw_settings" WHERE "cw_settings"."user_id" = $1 AND "cw_settings"."deleted_at" IS NULL`, Args: []any{settingsReadUserID}, Columns: []string{"id", "user_id", "char_wpm", "eff_wpm", "freq", "start_delay", "updated_at"}, Rows: [][]driver.Value{{forumReadID(2), settingsReadUserID, int64(30), int64(15), int64(800), 1.25, now}}},
		{SQL: `SELECT * FROM "page_settings" WHERE "page_settings"."user_id" = $1 AND "page_settings"."deleted_at" IS NULL`, Args: []any{settingsReadUserID}, Columns: []string{"id", "user_id", "lang", "cur_lesson", "updated_at"}, Rows: [][]driver.Value{{forumReadID(3), settingsReadUserID, "en", int64(8), now}}},
	}
}

func TestCombinedSettingsResponseSnapshots(t *testing.T) {
	for _, test := range []struct {
		name     string
		cw, page bool
	}{
		{"defaults", false, false}, {"cw only", true, false}, {"page only", false, true}, {"both stored", true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			queries := settingsReadQueries()
			cw, page := settingsDefaultCW, settingsDefaultPage
			if test.cw {
				cw = settingsStoredCW
			} else {
				queries[1].Rows = nil
			}
			if test.page {
				page = settingsStoredPage
			} else {
				queries[2].Rows = nil
			}
			user := models.User{Base: models.Base{ID: uuid.MustParse(settingsReadUserID)}}
			settingsReadSnapshot(t, forumReadDB(t, queries), &user, "all", 200, combinedSettingsSnapshot(cw, page))
		})
	}
	t.Run("stored zero values", func(t *testing.T) {
		queries := settingsReadQueries()
		for i := 2; i <= 4; i++ {
			queries[1].Rows[0][i] = int64(0)
		}
		queries[1].Rows[0][5] = float64(0)
		queries[2].Rows[0][2], queries[2].Rows[0][3] = "", int64(0)
		user := models.User{Base: models.Base{ID: uuid.MustParse(settingsReadUserID)}}
		settingsReadSnapshot(t, forumReadDB(t, queries), &user, "all", 200, combinedSettingsSnapshot(settingsZeroCW, settingsZeroPage))
	})
	for _, retained := range []bool{false, true} {
		t.Run(fmt.Sprintf("missing user retains associations %t", retained), func(t *testing.T) {
			queries := settingsReadQueries()[:1]
			queries[0].Rows = nil
			user := models.User{Base: models.Base{ID: uuid.MustParse(settingsReadUserID)}}
			cw := settingsDefaultCW
			if retained {
				user.CWSettings = &models.CWSettings{Base: models.Base{UpdatedAt: time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)}}
				cw = settingsZeroCW
			}
			settingsReadSnapshot(t, forumReadDB(t, queries), &user, "all", 200, combinedSettingsSnapshot(cw, settingsDefaultPage))
		})
	}
}

func TestCombinedSettingsErrorSnapshots(t *testing.T) {
	for stage := range 3 {
		for _, notFound := range []bool{false, true} {
			t.Run(fmt.Sprintf("stage %d not found %t", stage, notFound), func(t *testing.T) {
				queries := settingsReadQueries()[:stage+1]
				queries[stage].Err = errors.New("injected settings failure")
				status, body := 500, `{"code":"SETTINGS_FETCH_FAILED","error":"Failed to get settings"}`
				if notFound {
					queries[stage].Err = fmt.Errorf("wrapped: %w", gorm.ErrRecordNotFound)
					cw := settingsDefaultCW
					if stage == 2 {
						cw = settingsStoredCW
					}
					status, body = 200, combinedSettingsSnapshot(cw, settingsDefaultPage)
				}
				var logs bytes.Buffer
				previous := slog.Default()
				slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
				t.Cleanup(func() { slog.SetDefault(previous) })
				user := models.User{Base: models.Base{ID: uuid.MustParse(settingsReadUserID)}}
				settingsReadSnapshot(t, forumReadDB(t, queries), &user, "all", status, body)
				if notFound {
					if logs.Len() != 0 {
						t.Fatalf("unexpected error log: %s", &logs)
					}
					return
				}
				var record map[string]any
				if err := json.Unmarshal(logs.Bytes(), &record); err != nil {
					t.Fatal(err)
				}
				if record["msg"] != "Failed to get settings" || record["level"] != "ERROR" || record["user_id"] != settingsReadUserID || record["err"] != "injected settings failure" {
					t.Fatalf("log = %v", record)
				}
			})
		}
	}
}

func TestCombinedSettingsPostgresAssociations(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	settingsReadSnapshot(t, db, &user, "all", 200, combinedSettingsSnapshot(settingsDefaultCW, settingsDefaultPage))
	// Individual default responses intentionally omit updated_at.
	settingsReadSnapshot(t, db, &user, "cw", 200, `{"char_wpm":20,"eff_wpm":12,"freq":600,"start_delay":0.5}`)
	settingsReadSnapshot(t, db, &user, "page", 200, `{"language":"auto","cur_lesson":0}`)
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	cw := models.CWSettings{Base: models.Base{UpdatedAt: now}, UserID: user.ID}
	if err := db.Create(&cw).Error; err != nil {
		t.Fatal(err)
	}
	settingsReadSnapshot(t, db, &user, "all", 200, combinedSettingsSnapshot(settingsZeroCW, settingsDefaultPage))
	page := models.PageSettings{Base: models.Base{UpdatedAt: now}, UserID: user.ID, Lang: "en", CurLesson: 8}
	if err := db.Create(&page).Error; err != nil {
		t.Fatal(err)
	}
	settingsReadSnapshot(t, db, &user, "all", 200, combinedSettingsSnapshot(settingsZeroCW, settingsStoredPage))
	if err := db.Delete(&cw).Error; err != nil {
		t.Fatal(err)
	}
	settingsReadSnapshot(t, db, &user, "all", 200, combinedSettingsSnapshot(settingsDefaultCW, settingsStoredPage))
	if err := db.Delete(&page).Error; err != nil {
		t.Fatal(err)
	}
	settingsReadSnapshot(t, db, &user, "all", 200, combinedSettingsSnapshot(settingsDefaultCW, settingsDefaultPage))
}
