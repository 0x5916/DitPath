package handlers

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const progressReadUserID = "00000000-0000-7000-8000-000000000001"
const progressReadRecord = `{"lesson":"7","char_wpm":20,"eff_wpm":12,"accuracy":0.9,"created_at":"2025-01-02T00:00:00Z","client_created_at":null}`
const progressReadSummary = `{"days":[{"date":"2024-02-29","count":2}],"recent":[` + progressReadRecord + `]}`

func progressReadSnapshot(t *testing.T, queries []forumReadQuery, query string, prepare func(*gin.Context), status int, body string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/cw/progress?"+query, nil)
	c.Set("user", &models.User{Base: models.Base{ID: uuid.MustParse(progressReadUserID)}})
	if prepare != nil {
		prepare(c)
	}
	ProgressHandler{DB: forumReadDB(t, queries)}.GetAllProgress(c)
	if recorder.Code != status || recorder.Body.String() != body || recorder.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("response = %d %s %s; want %d %s", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body, status, body)
	}
}

func progressReadPageQueries() []forumReadQuery {
	return []forumReadQuery{{
		SQL: `SELECT * FROM "lesson_progress" WHERE user_id = $1 AND "lesson_progress"."deleted_at" IS NULL ORDER BY created_at DESC,id DESC LIMIT $2`, Args: []any{progressReadUserID, int64(3)},
		Columns: []string{"id", "lesson", "char_wpm", "eff_wpm", "accuracy", "created_at", "client_created_at"}, Rows: [][]driver.Value{
			{forumReadID(4), int64(7), int64(20), int64(12), 0.9, time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC), nil},
			{forumReadID(3), int64(3), int64(25), int64(15), float64(1), time.Date(2024, 2, 29, 0, 0, 0, 0, time.UTC), time.Date(2024, 2, 28, 0, 0, 0, 0, time.UTC)},
			{forumReadID(2), int64(99), int64(5), int64(5), float64(0), time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), nil},
		},
	}}
}

func progressReadSummaryQueries() []forumReadQuery {
	return []forumReadQuery{
		{SQL: `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, COUNT(*) AS count FROM "lesson_progress" WHERE (user_id = $1 AND created_at >= $2 AND created_at < $3) AND "lesson_progress"."deleted_at" IS NULL GROUP BY "date" ORDER BY date`, Args: []any{progressReadUserID, time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)}, Columns: []string{"date", "count"}, Rows: [][]driver.Value{{"2024-02-29", int64(2)}}},
		{SQL: `SELECT * FROM "lesson_progress" WHERE user_id = $1 AND "lesson_progress"."deleted_at" IS NULL ORDER BY created_at DESC,id DESC LIMIT $2`, Args: []any{progressReadUserID, int64(20)}, Columns: progressReadPageQueries()[0].Columns, Rows: progressReadPageQueries()[0].Rows[:1]},
	}
}

func TestProgressReadPageSnapshots(t *testing.T) {
	t.Run("empty defaults", func(t *testing.T) {
		queries := progressReadPageQueries()
		queries[0].Args[1], queries[0].Rows = int64(101), nil
		progressReadSnapshot(t, queries, "", nil, 200, `{"data":[],"limit":100,"next_cursor":null}`)
	})
	t.Run("lookahead and mapping", func(t *testing.T) {
		const body = `{"data":[` + progressReadRecord + `,{"lesson":"3","char_wpm":25,"eff_wpm":15,"accuracy":1,"created_at":"2024-02-29T00:00:00Z","client_created_at":"2024-02-28T00:00:00Z"}],"limit":2,"next_cursor":"MjAyNC0wMi0yOVQwMDowMDowMFp8MDAwMDAwMDAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwMDAz"}`
		progressReadSnapshot(t, progressReadPageQueries(), "limit=2", nil, 200, body)
	})
	t.Run("cursor predicate", func(t *testing.T) {
		queries := progressReadPageQueries()
		queries[0].SQL = `SELECT * FROM "lesson_progress" WHERE user_id = $1 AND (created_at,id) < ($2,$3) AND "lesson_progress"."deleted_at" IS NULL ORDER BY created_at DESC,id DESC LIMIT $4`
		queries[0].Args = []any{progressReadUserID, time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC), forumReadID(10), int64(3)}
		queries[0].Rows = nil
		progressReadSnapshot(t, queries, "limit=2&cursor="+forumReadCursor, nil, 200, `{"data":[],"limit":2,"next_cursor":null}`)
	})
}

func TestProgressReadYearSnapshotsAndGinQueryCache(t *testing.T) {
	t.Run("UTC year and unfiltered recent", func(t *testing.T) {
		progressReadSnapshot(t, progressReadSummaryQueries(), "year=2024", nil, 200, progressReadSummary)
	})
	t.Run("cached year survives raw query change", func(t *testing.T) {
		progressReadSnapshot(t, progressReadSummaryQueries(), "year=2024", func(c *gin.Context) {
			if c.Query("year") != "2024" {
				t.Fatal("failed to prime Gin query cache")
			}
			c.Request.URL.RawQuery = "year=2025"
		}, 200, progressReadSummary)
	})
	t.Run("empty year summary", func(t *testing.T) {
		queries := progressReadSummaryQueries()
		queries[0].Rows, queries[1].Rows = nil, nil
		progressReadSnapshot(t, queries, "year=2024", nil, 200, `{"days":[],"recent":[]}`)
	})
}

func TestProgressReadInvalidQuerySnapshots(t *testing.T) {
	for _, query := range []string{"year=", "year=no", "year=0", "year=10000", "year=2024&year=2025", "year=2024&cursor=", "year=2024&limit=", "year=2024&cursor=bad", "limit=0", "limit=101", "limit=1&limit=2", "cursor=bad", "cursor=", "cursor=&cursor=bad"} {
		t.Run(query, func(t *testing.T) {
			progressReadSnapshot(t, nil, query, nil, 400, `{"code":"INVALID_QUERY_PARAMETER","error":"Invalid query parameters"}`)
		})
	}
}

func TestProgressReadFailureSnapshots(t *testing.T) {
	for _, stage := range []string{"page", "summary", "recent", "cancel page", "cancel summary"} {
		t.Run(stage, func(t *testing.T) {
			queries, query := progressReadPageQueries(), "limit=2"
			if stage == "summary" || stage == "recent" || stage == "cancel summary" {
				queries, query = progressReadSummaryQueries(), "year=2024"
			}
			var prepare func(*gin.Context)
			wantError := "injected progress failure"
			if stage == "cancel page" || stage == "cancel summary" {
				queries = nil
				wantError = "context canceled"
				prepare = func(c *gin.Context) {
					ctx, cancel := context.WithCancel(c.Request.Context())
					cancel()
					c.Request = c.Request.WithContext(ctx)
				}
			} else {
				index := 0
				if stage == "recent" {
					index = 1
				}
				queries = queries[:index+1]
				queries[index].Err = errors.New("injected progress failure")
			}
			var logs bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
			t.Cleanup(func() { slog.SetDefault(previous) })
			progressReadSnapshot(t, queries, query, prepare, 500, `{"code":"PROGRESS_QUERY_FAILED","error":"failed to query progress"}`)
			var record map[string]any
			if err := json.Unmarshal(logs.Bytes(), &record); err != nil {
				t.Fatal(err)
			}
			if record["msg"] != "Failed to query progress" || record["level"] != "ERROR" || record["user_id"] != progressReadUserID || record["err"] != wantError {
				t.Fatalf("log = %v", record)
			}
		})
	}
}
