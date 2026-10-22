package handlers

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func forumListResponse(db *gorm.DB, query string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/forum/threads?"+query, nil)
	// Listing currently does not propagate request cancellation to its queries.
	ctx, cancel := context.WithCancel(c.Request.Context())
	cancel()
	c.Request = c.Request.WithContext(ctx)
	ForumHandler{DB: db}.ListThreads(c)
	return recorder
}

func forumListSnapshot(t *testing.T, queries []forumReadQuery, query string, status int, body string) {
	t.Helper()
	response := forumListResponse(forumReadDB(t, queries), query)
	if response.Code != status || response.Body.String() != body || response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("response = %d %s %s; want %d %s", response.Code, response.Header().Get("Content-Type"), response.Body, status, body)
	}
}

func forumListQueries() []forumReadQuery {
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	return []forumReadQuery{
		{SQL: `SELECT count(*) FROM "forum_threads" WHERE category = $1 AND "forum_threads"."deleted_at" IS NULL`, Args: []any{"help"}, Columns: []string{"count"}, Rows: [][]driver.Value{{int64(5)}}},
		{SQL: `SELECT * FROM "forum_threads" WHERE category = $1 AND (created_at, id) < ($2, $3) AND "forum_threads"."deleted_at" IS NULL ORDER BY created_at DESC, id DESC LIMIT $4`, Args: []any{"help", now, forumReadID(10), int64(3)}, Columns: []string{"id", "user_id", "category", "title", "created_at"}, Rows: [][]driver.Value{
			{forumReadID(4), forumReadID(1), "help", "first", now},
			{forumReadID(3), forumReadID(2), "help", "missing author", now},
			{forumReadID(2), forumReadID(3), "help", "lookahead", now},
		}},
		{SQL: `SELECT * FROM "users" WHERE "users"."id" IN ($1,$2,$3) AND "users"."deleted_at" IS NULL`, Args: []any{forumReadID(1), forumReadID(2), forumReadID(3)}, Columns: []string{"id", "username", "call_sign"}, Rows: [][]driver.Value{{forumReadID(1), "reader", nil}}},
		{SQL: `SELECT thread_id, COUNT(*) AS count FROM "forum_replies" WHERE (thread_id IN ($1,$2) AND deleted_at IS NULL) AND "forum_replies"."deleted_at" IS NULL GROUP BY "thread_id"`, Args: []any{forumReadID(4), forumReadID(3)}, Columns: []string{"thread_id", "count"}, Rows: [][]driver.Value{{forumReadID(4), int64(2)}}},
	}
}

func TestForumThreadListPageSnapshot(t *testing.T) {
	const snapshot = `{"data":[{"id":"00000000-0000-7000-8000-000000000004","category":"help","title":"first","author":{"username":"reader","call_sign":null},"reply_count":2,"created_at":"2026-10-16T00:00:00Z"},{"id":"00000000-0000-7000-8000-000000000003","category":"help","title":"missing author","author":null,"reply_count":0,"created_at":"2026-10-16T00:00:00Z"}],"total":5,"limit":2,"next_cursor":"MjAyNi0xMC0xNlQwMDowMDowMFp8MDAwMDAwMDAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwMDAz"}`
	forumListSnapshot(t, forumListQueries(), "category=help&limit=2&cursor="+forumReadCursor, 200, snapshot)
}

func TestForumThreadListEmptyAndPermissiveQueries(t *testing.T) {
	for _, query := range []string{"", "limit=0", "limit=0&limit=101", "cursor=", "cursor=&cursor=malformed", "category=&category=invalid"} {
		t.Run(query, func(t *testing.T) {
			queries := []forumReadQuery{
				{SQL: `SELECT count(*) FROM "forum_threads" WHERE "forum_threads"."deleted_at" IS NULL`, Args: []any{}, Columns: []string{"count"}, Rows: [][]driver.Value{{int64(0)}}},
				{SQL: `SELECT * FROM "forum_threads" WHERE "forum_threads"."deleted_at" IS NULL ORDER BY created_at DESC, id DESC LIMIT $1`, Args: []any{int64(21)}, Columns: []string{"id"}},
			}
			forumListSnapshot(t, queries, query, 200, `{"data":[],"total":0,"limit":20,"next_cursor":null}`)
		})
	}
	for _, cursorCase := range []struct {
		raw, timestamp, id string
	}{
		{"2026-10-16T01:00:00+01:00|0000000000007000800000000000000a", "2026-10-16T01:00:00+01:00", forumReadID(10)},
		{"2026-10-16T00:00:00Z|00000000-0000-0000-0000-000000000000", "2026-10-16T00:00:00Z", uuid.Nil.String()},
	} {
		t.Run(cursorCase.raw, func(t *testing.T) {
			queries := forumListQueries()[:2]
			queries[1].Args[1], _ = time.Parse(time.RFC3339Nano, cursorCase.timestamp)
			queries[1].Args[2] = cursorCase.id
			queries[1].Rows = nil
			cursor := base64.RawURLEncoding.EncodeToString([]byte(cursorCase.raw))
			forumListSnapshot(t, queries, "category=help&limit=2&cursor="+url.QueryEscape(cursor), 200, `{"data":[],"total":5,"limit":2,"next_cursor":null}`)
		})
	}
}

func TestForumThreadListErrorSnapshots(t *testing.T) {
	for _, query := range []string{"category=invalid&cursor=bad", "limit=-1&cursor=bad", "limit=101", "limit=x", "limit=1&cursor=bad", "cursor=YmFk", "cursor=" + base64.RawURLEncoding.EncodeToString([]byte("bad|bad")), "cursor=" + base64.RawURLEncoding.EncodeToString([]byte("2026-10-16T00:00:00Z|bad"))} {
		t.Run(query, func(t *testing.T) {
			message := "Invalid cursor"
			if query == "category=invalid&cursor=bad" || query == "limit=-1&cursor=bad" || query == "limit=101" || query == "limit=x" {
				message = "Invalid query parameters"
			}
			forumListSnapshot(t, nil, query, 400, `{"code":"INVALID_QUERY_PARAMETER","error":"`+message+`"}`)
		})
	}
	for i, stage := range []string{"count", "page", "authors", "reply counts"} {
		t.Run(stage, func(t *testing.T) {
			message := []string{"Failed to count forum threads", "Failed to query forum threads", "Failed to query forum threads", "Failed to query forum reply counts"}[i]
			var logs bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
			t.Cleanup(func() { slog.SetDefault(previous) })
			queries := forumListQueries()[:i+1]
			queries[i].Err = errors.New("injected list failure")
			forumListSnapshot(t, queries, "category=help&limit=2&cursor="+forumReadCursor, 500, `{"code":"FORUM_QUERY_FAILED","error":"Failed to query forum threads"}`)
			var record map[string]any
			if err := json.Unmarshal(logs.Bytes(), &record); err != nil {
				t.Fatal(err)
			}
			_, hasCategory := record["category"]
			if record["msg"] != message || record["level"] != "ERROR" || record["err"] != "injected list failure" || hasCategory != (i < 3) || (i < 3 && record["category"] != "help") {
				t.Fatalf("log = %v", record)
			}
		})
	}
}

func TestForumThreadListPostgresPages(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	// Isolate the public list to this fixture owner, retaining its normal filters.
	if err := db.Callback().Query().Before("gorm:query").Register("test:forum_list_owner", func(tx *gorm.DB) {
		if tx.Statement.Table == "forum_threads" {
			tx.Statement.AddClause(clause.Where{Exprs: []clause.Expression{clause.Eq{Column: "forum_threads.user_id", Value: user.ID}}})
		}
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	threads := make([]models.ForumThread, 6)
	for i := range threads {
		threads[i] = models.ForumThread{Base: models.Base{ID: uuid.MustParse(forumReadID(100 + i)), CreatedAt: now}, UserID: user.ID, Category: "help", Title: "fixture", Body: "body"}
	}
	threads[0].Category = "general"
	if err := db.Create(&threads).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&threads[5]).Error; err != nil {
		t.Fatal(err)
	}
	replies := []models.ForumReply{{ThreadID: threads[4].ID, UserID: user.ID, Body: "live"}, {ThreadID: threads[4].ID, UserID: user.ID, Body: "deleted"}}
	if err := db.Create(&replies).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&replies[1]).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&user).Error; err != nil {
		t.Fatal(err)
	}
	all := forumListResponse(db, "")
	var allPage common.ForumThreadListResponse
	if err := json.Unmarshal(all.Body.Bytes(), &allPage); err != nil {
		t.Fatal(err)
	}
	if all.Code != 200 || allPage.Total != 5 || allPage.Limit != 20 || len(allPage.Data) != 5 || allPage.NextCursor != nil {
		t.Fatalf("unfiltered page = %d %s", all.Code, all.Body)
	}
	cursor := ""
	for pageIndex := range 2 {
		response := forumListResponse(db, "category=help&limit=2&cursor="+url.QueryEscape(cursor))
		var page common.ForumThreadListResponse
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if response.Code != 200 || page.Total != 4 || page.Limit != 2 || len(page.Data) != 2 {
			t.Fatalf("page = %d %s", response.Code, response.Body)
		}
		for i, thread := range page.Data {
			var wantReplies int64
			if pageIndex == 0 && i == 0 {
				wantReplies = 1
			}
			if thread.ID != threads[4-pageIndex*2-i].ID || thread.Author != nil || thread.ReplyCount != wantReplies {
				t.Fatalf("unexpected thread: %+v", thread)
			}
		}
		if pageIndex == 0 {
			if page.NextCursor == nil {
				t.Fatal("missing next cursor")
			}
			cursor = *page.NextCursor
		} else if page.NextCursor != nil {
			t.Fatal("unexpected final cursor")
		}
	}
}
