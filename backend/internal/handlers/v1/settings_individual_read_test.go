package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type settingsIndividualLogHandler struct {
	slog.Handler
	response *httptest.ResponseRecorder
	written  bool
}

func (handler *settingsIndividualLogHandler) Handle(ctx context.Context, record slog.Record) error {
	handler.written = handler.response.Body.Len() > 0
	return handler.Handler.Handle(ctx, record)
}

func TestIndividualSettingsReadSnapshots(t *testing.T) {
	for index, endpoint := range []struct {
		name, table, columns, defaults, stored, zero string
	}{
		{"cw", "cw_settings", `"cw_settings"."char_wpm","cw_settings"."eff_wpm","cw_settings"."freq","cw_settings"."start_delay","cw_settings"."updated_at"`, `{"char_wpm":20,"eff_wpm":12,"freq":600,"start_delay":0.5}`, settingsStoredCW, settingsZeroCW},
		{"page", "page_settings", `"page_settings"."lang","page_settings"."cur_lesson","page_settings"."updated_at"`, `{"language":"auto","cur_lesson":0}`, settingsStoredPage, settingsZeroPage},
	} {
		t.Run(endpoint.name, func(t *testing.T) {
			for _, state := range []string{"missing", "wrapped not found", "stored", "stored zero", "query failure"} {
				t.Run(state, func(t *testing.T) {
					query := settingsReadQueries()[index+1]
					query.SQL = `SELECT ` + endpoint.columns + ` FROM "` + endpoint.table + `" WHERE user_id = $1 AND "` + endpoint.table + `"."deleted_at" IS NULL LIMIT $2`
					query.Args = []any{settingsReadUserID, int64(1)}
					query.Columns, query.Rows[0] = query.Columns[2:], query.Rows[0][2:]
					status, body := http.StatusOK, endpoint.defaults
					switch state {
					case "missing":
						query.Rows = nil
					case "wrapped not found":
						query.Err = fmt.Errorf("wrapped: %w", gorm.ErrRecordNotFound)
					case "stored":
						body = endpoint.stored
					case "stored zero":
						body = endpoint.zero
						if endpoint.name == "cw" {
							query.Rows[0][0], query.Rows[0][1], query.Rows[0][2], query.Rows[0][3] = int64(0), int64(0), int64(0), float64(0)
						} else {
							query.Rows[0][0], query.Rows[0][1] = "", int64(0)
						}
					case "query failure":
						query.Err = errors.New("injected individual settings failure")
						status, body = 500, `{"code":"SETTINGS_FETCH_FAILED","error":"Failed to get settings"}`
					}

					response := httptest.NewRecorder()
					c, _ := gin.CreateTestContext(response)
					c.Request = httptest.NewRequest(http.MethodGet, "/v1/settings/"+endpoint.name, nil)
					ctx, cancel := context.WithCancel(c.Request.Context())
					cancel()
					// Standalone reads currently query even when the request is cancelled.
					c.Request = c.Request.WithContext(ctx)
					c.Set("user", &models.User{Base: models.Base{ID: uuid.MustParse(settingsReadUserID)}})
					var logs bytes.Buffer
					logHandler := &settingsIndividualLogHandler{Handler: slog.NewJSONHandler(&logs, nil), response: response}
					previous := slog.Default()
					slog.SetDefault(slog.New(logHandler))
					t.Cleanup(func() { slog.SetDefault(previous) })
					handler := SettingsHandler{DB: forumReadDB(t, []forumReadQuery{query})}
					if endpoint.name == "cw" {
						handler.GetCWSettings(c)
					} else {
						handler.GetPageSettings(c)
					}
					if response.Code != status || response.Body.String() != body || response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
						t.Fatalf("response = %d %s %s; want %d %s", response.Code, response.Header().Get("Content-Type"), response.Body, status, body)
					}
					if state != "query failure" {
						if logs.Len() != 0 {
							t.Fatalf("unexpected log: %s", &logs)
						}
						return
					}
					var record map[string]any
					if err := json.Unmarshal(logs.Bytes(), &record); err != nil {
						t.Fatal(err)
					}
					if record["level"] != "ERROR" || record["msg"] != "Failed to get settings" || record["user_id"] != settingsReadUserID || record["err"] != "injected individual settings failure" {
						t.Fatalf("log = %v", record)
					}
					if logHandler.written != (endpoint.name == "cw") {
						t.Fatalf("response written before log = %v for %s", logHandler.written, endpoint.name)
					}
				})
			}
		})
	}
}
