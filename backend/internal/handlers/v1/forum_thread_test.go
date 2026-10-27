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
	"strings"
	"testing"
	"time"

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const forumThreadBody = `{"data":{"id":"00000000-0000-7000-8000-000000000001","category":"help","title":"thread title","body":"thread body","author":{"username":"reader","call_sign":"N0CALL"},"reply_count":5,"created_at":"2026-10-16T00:00:00Z","updated_at":"2026-10-16T00:00:00Z"}}`
const forumThreadNotFound = `{"code":"THREAD_NOT_FOUND","error":"Thread not found"}`

func forumThreadQueries() []forumReadQuery {
	queries := forumReadQueries()[:3]
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	queries[0].Columns = []string{"id", "user_id", "category", "title", "body", "created_at", "updated_at"}
	queries[0].Rows = [][]driver.Value{{forumReadID(1), forumReadID(2), "help", "thread title", "thread body", now, now}}
	return queries
}

func forumThreadSnapshot(t *testing.T, db *gorm.DB, ctx context.Context, id string, status int, body, logMessage string) {
	t.Helper()
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/forum/threads/"+id, nil).WithContext(ctx)
	c.Params = gin.Params{{Key: "id", Value: id}}
	ForumHandler{DB: db}.GetThread(c)
	if recorder.Code != status || recorder.Body.String() != body || recorder.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("response = %d %s %s; want %d %s", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body, status, body)
	}
	if logMessage == "" {
		if logs.Len() != 0 {
			t.Fatalf("unexpected logs: %s", &logs)
		}
		return
	}
	var record map[string]any
	if err := json.Unmarshal(logs.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record["msg"] != logMessage || record["level"] != "ERROR" || record["thread_id"] != id || record["err"] == nil {
		t.Fatalf("log = %v", record)
	}
}

func TestForumThreadResponseSnapshots(t *testing.T) {
	t.Run("with author", func(t *testing.T) {
		forumThreadSnapshot(t, forumReadDB(t, forumThreadQueries()), context.Background(), forumReadID(1), 200, forumThreadBody, "")
	})
	t.Run("missing author", func(t *testing.T) {
		queries := forumThreadQueries()
		queries[1].Rows = nil
		body := strings.Replace(forumThreadBody, `{"username":"reader","call_sign":"N0CALL"}`, `null`, 1)
		forumThreadSnapshot(t, forumReadDB(t, queries), context.Background(), forumReadID(1), 200, body, "")
	})
	t.Run("malformed thread", func(t *testing.T) {
		forumThreadSnapshot(t, forumReadDB(t, nil), context.Background(), "malformed", 404, forumThreadNotFound, "")
	})
	t.Run("missing thread", func(t *testing.T) {
		queries := forumThreadQueries()[:1]
		queries[0].Rows = nil
		forumThreadSnapshot(t, forumReadDB(t, queries), context.Background(), forumReadID(1), 404, forumThreadNotFound, "")
	})
	for i, stage := range []string{"lookup", "author preload", "reply count"} {
		t.Run(stage, func(t *testing.T) {
			queries := forumThreadQueries()[:i+1]
			queries[i].Err = errors.New("injected thread failure")
			body, message := `{"code":"FORUM_QUERY_FAILED","error":"Failed to query forum thread"}`, "Failed to query forum thread"
			if i == 2 {
				body, message = `{"code":"FORUM_QUERY_FAILED","error":"Failed to query forum replies"}`, "Failed to count forum replies"
			}
			forumThreadSnapshot(t, forumReadDB(t, queries), context.Background(), forumReadID(1), 500, body, message)
		})
	}
}

func TestForumThreadRequestCancellation(t *testing.T) {
	t.Run("cancelled lookup", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		forumThreadSnapshot(t, forumReadDB(t, nil), ctx, forumReadID(1), 500, `{"code":"FORUM_QUERY_FAILED","error":"Failed to query forum thread"}`, "Failed to query forum thread")
	})
	t.Run("count ignores cancellation after lookup", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		db := forumReadDB(t, forumThreadQueries())
		if err := db.Callback().Query().After("gorm:after_query").Register("test:cancel_thread_lookup", func(tx *gorm.DB) {
			if tx.Statement.Table == "forum_threads" {
				cancel()
			}
		}); err != nil {
			t.Fatal(err)
		}
		forumThreadSnapshot(t, db, ctx, forumReadID(1), 200, forumThreadBody, "")
	})
}

func TestForumThreadPostgresLiveCountAndSoftDeletion(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	thread := models.ForumThread{Base: models.Base{ID: uuid.MustParse(forumReadID(1)), CreatedAt: now, UpdatedAt: now}, UserID: user.ID, Category: "help", Title: "thread title", Body: "thread body"}
	if err := db.Create(&thread).Error; err != nil {
		t.Fatal(err)
	}
	replies := make([]models.ForumReply, 6)
	for i := range replies {
		replies[i] = models.ForumReply{ThreadID: thread.ID, UserID: user.ID, Body: "reply"}
	}
	if err := db.Create(&replies).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&replies[5]).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&user).Error; err != nil {
		t.Fatal(err)
	}
	body := strings.Replace(forumThreadBody, `{"username":"reader","call_sign":"N0CALL"}`, `null`, 1)
	// The driver returns timestamptz in the host location; the instant is unchanged.
	body = strings.ReplaceAll(body, now.Format(time.RFC3339), now.In(time.Local).Format(time.RFC3339))
	forumThreadSnapshot(t, db, context.Background(), thread.ID.String(), 200, body, "")
	if err := db.Delete(&thread).Error; err != nil {
		t.Fatal(err)
	}
	forumThreadSnapshot(t, db, context.Background(), thread.ID.String(), 404, forumThreadNotFound, "")
}
