package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const forumReplyNotFound = `{"code":"REPLY_NOT_FOUND","error":"Reply not found"}`
const forumParentNotFound = `{"code":"REPLY_NOT_FOUND","error":"Parent reply not found in this thread"}`
const forumWriteInvalidBody = `{"code":"INVALID_REQUEST_BODY","error":"Invalid request body"}`
const forumWriteFailure = "injected forum write failure"

func forumWriteSnapshot(t *testing.T, db *gorm.DB, user *models.User, ctx context.Context, method, id, input string, status int, body string, wantLog map[string]string) {
	t.Helper()
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(previous)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	url := "/v1/forum/replies/" + id
	if method == http.MethodPost {
		url = "/v1/forum/threads/" + id + "/replies"
	}
	c.Request = httptest.NewRequest(method, url, strings.NewReader(input)).WithContext(ctx)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "id", Value: id}}
	c.Set("user", user)
	handler := ForumHandler{DB: db}
	if method == http.MethodPost {
		handler.CreateReply(c)
	} else {
		handler.DeleteReply(c)
	}
	if recorder.Code != status || recorder.Body.String() != body || recorder.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("response = %d %s %s; want %d %s", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body, status, body)
	}
	if wantLog == nil {
		if logs.Len() != 0 {
			t.Fatalf("unexpected logs: %s", &logs)
		}
		return
	}
	var record map[string]string
	if err := json.Unmarshal(logs.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	delete(record, "time")
	wantLog["level"] = "ERROR"
	if !reflect.DeepEqual(record, wantLog) {
		t.Fatalf("log = %v; want %v", record, wantLog)
	}
}

func TestForumReplyWriteLookupSnapshots(t *testing.T) {
	user := &models.User{Base: models.Base{ID: uuid.MustParse(forumReadID(2))}}
	for _, id := range []string{"malformed", ""} {
		t.Run("malformed thread "+id, func(t *testing.T) {
			forumWriteSnapshot(t, nil, user, context.Background(), "POST", id, `{`, 404, forumThreadNotFound, nil)
		})
	}
	t.Run("missing thread before body", func(t *testing.T) {
		queries := forumReadQueries()[:1]
		queries[0].Rows = nil
		forumWriteSnapshot(t, forumReadDB(t, queries), user, context.Background(), "POST", forumReadID(1), `{`, 404, forumThreadNotFound, nil)
	})
	for _, input := range []string{`{`, `{}`, `{"body":""}`, `{"body":"reply","parent_id":"malformed"}`} {
		t.Run("invalid body "+input, func(t *testing.T) {
			forumWriteSnapshot(t, forumReadDB(t, forumReadQueries()[:2]), user, context.Background(), "POST", forumReadID(1), input, 400, forumWriteInvalidBody, nil)
		})
	}
	for _, kind := range []string{"parent", "reply"} {
		for _, failure := range []string{"missing", "wrapped not found", "query error"} {
			t.Run(kind+" "+failure, func(t *testing.T) {
				query := forumReadQuery{SQL: `SELECT * FROM "forum_replies" WHERE "forum_replies"."id" = $1 AND "forum_replies"."deleted_at" IS NULL LIMIT $2`, Args: []any{forumReadID(3), int64(1)}, Columns: []string{"id"}}
				queries, method, id, input, status, body := []forumReadQuery{}, "DELETE", forumReadID(3), "", 404, forumReplyNotFound
				message, field := "Failed to query forum reply", "reply_id"
				if kind == "parent" {
					query.SQL = `SELECT * FROM "forum_replies" WHERE (id = $1 AND thread_id = $2) AND "forum_replies"."deleted_at" IS NULL LIMIT $3`
					query.Args = []any{forumReadID(3), forumReadID(1), int64(1)}
					queries, method, id, input, status, body = forumReadQueries()[:2], "POST", forumReadID(1), `{"body":"reply","parent_id":"`+forumReadID(3)+`"}`, 400, forumParentNotFound
					message, field = "Failed to query parent reply", "thread_id"
				}
				var log map[string]string
				if failure == "wrapped not found" {
					query.Err = errors.Join(errors.New("wrapped"), gorm.ErrRecordNotFound)
				} else if failure == "query error" {
					query.Err, status = errors.New(forumWriteFailure), 500
					body = `{"code":"FORUM_QUERY_FAILED","error":"` + message + `"}`
					log = map[string]string{"msg": message, field: id, "err": forumWriteFailure}
					if kind == "parent" {
						log["parent_id"] = forumReadID(3)
					}
				}
				forumWriteSnapshot(t, forumReadDB(t, append(queries, query)), user, context.Background(), method, id, input, status, body, log)
			})
		}
	}
	t.Run("malformed reply", func(t *testing.T) {
		forumWriteSnapshot(t, nil, user, context.Background(), "DELETE", "malformed", "", 404, forumReplyNotFound, nil)
	})
	t.Run("cancelled thread lookup before body", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		forumWriteSnapshot(t, forumReadDB(t, nil), user, ctx, "POST", forumReadID(1), `{`, 500, `{"code":"FORUM_QUERY_FAILED","error":"Failed to query forum thread"}`, map[string]string{"msg": "Failed to query forum thread", "thread_id": forumReadID(1), "err": "context canceled"})
	})
}

func forumWriteFixture(t *testing.T) (*gorm.DB, models.User, models.ForumThread, models.ForumReply) {
	t.Helper()
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	db := postgresTestDB(t).Session(&gorm.Session{NowFunc: func() time.Time { return now }})
	user := postgresTestUser(t, db, "")
	callSign := "N0CALL"
	user.Username, user.CallSign = "writer", &callSign
	thread := models.ForumThread{Base: models.Base{ID: uuid.MustParse(forumReadID(101))}, UserID: user.ID, Category: "help", Title: "thread", Body: "body"}
	parent := models.ForumReply{Base: models.Base{ID: uuid.MustParse(forumReadID(102))}, ThreadID: thread.ID, UserID: user.ID, Body: "parent"}
	if err := db.Create(&thread).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&parent).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Create().Before("gorm:before_create").Register("test:forum-reply-id", func(tx *gorm.DB) {
		if reply, ok := tx.Statement.Dest.(*models.ForumReply); ok {
			reply.ID = uuid.MustParse(forumReadID(201))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove("test:forum-reply-id") })
	return db, user, thread, parent
}

func forumCreatedReplyBody(parent string) string {
	return `{"data":{"id":"` + forumReadID(201) + `","parent_id":` + parent + `,"body":"  raw reply  ","author":{"username":"writer","call_sign":"N0CALL"},"is_deleted":false,"created_at":"2026-10-16T00:00:00Z","children":[]}}`
}

func TestForumCreateReplyPostgresSnapshots(t *testing.T) {
	for _, kind := range []string{"absent", "null", "live", "missing", "deleted", "other thread"} {
		t.Run(kind, func(t *testing.T) {
			db, user, thread, parent := forumWriteFixture(t)
			parentJSON, status, body := `"`+parent.ID.String()+`"`, 201, ""
			if kind == "absent" || kind == "null" {
				parentJSON = "null"
			}
			if kind == "missing" {
				parentJSON = `"` + forumReadID(999) + `"`
			}
			if kind == "deleted" {
				if err := db.Delete(&parent).Error; err != nil {
					t.Fatal(err)
				}
			}
			if kind == "other thread" {
				other := models.ForumThread{UserID: user.ID, Category: "help", Title: "other", Body: "body"}
				if err := db.Create(&other).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Model(&parent).Update("thread_id", other.ID).Error; err != nil {
					t.Fatal(err)
				}
			}
			input := `{"body":"  raw reply  ","parent_id":` + parentJSON + `}`
			if kind == "absent" {
				input = `{"body":"  raw reply  "}`
			}
			body = forumCreatedReplyBody(parentJSON)
			if kind == "missing" || kind == "deleted" || kind == "other thread" {
				status, body = 400, forumParentNotFound
			}
			forumWriteSnapshot(t, db, &user, context.Background(), "POST", thread.ID.String(), input, status, body, nil)
			var replies []models.ForumReply
			if err := db.Where("id = ?", forumReadID(201)).Find(&replies).Error; err != nil {
				t.Fatal(err)
			}
			if (status == 201 && (len(replies) != 1 || replies[0].Body != "  raw reply  " || replies[0].UserID != user.ID || replies[0].ThreadID != thread.ID)) || (status != 201 && len(replies) != 0) {
				t.Fatalf("stored replies = %+v", replies)
			}
		})
	}
}

func TestForumDeleteReplyPostgresSnapshots(t *testing.T) {
	for _, kind := range []string{"own", "other owner", "deleted", "missing"} {
		t.Run(kind, func(t *testing.T) {
			db, user, _, reply := forumWriteFixture(t)
			id, status, body := reply.ID.String(), 200, `{"message":"Reply deleted"}`
			if kind == "other owner" {
				other := postgresTestUser(t, db, "")
				user = other
				status, body = 403, `{"code":"NOT_AUTHOR","error":"Only the author can delete this reply"}`
			}
			if kind == "deleted" {
				if err := db.Delete(&reply).Error; err != nil {
					t.Fatal(err)
				}
			}
			if kind == "missing" {
				id = forumReadID(999)
			}
			if kind == "deleted" || kind == "missing" {
				status, body = 404, forumReplyNotFound
			}
			forumWriteSnapshot(t, db, &user, context.Background(), "DELETE", id, "", status, body, nil)
			var stored models.ForumReply
			if err := db.Unscoped().Take(&stored, reply.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.DeletedAt.Valid != (kind == "own" || kind == "deleted") || stored.Body != "parent" {
				t.Fatalf("reply changed unexpectedly: %+v", stored)
			}
		})
	}
}

func TestForumReplyWritePostgresFailures(t *testing.T) {
	for _, method := range []string{"POST", "DELETE"} {
		t.Run(method, func(t *testing.T) {
			db, user, thread, reply := forumWriteFixture(t)
			fail := func(tx *gorm.DB) {
				if tx.Statement.Table == "forum_replies" {
					tx.AddError(errors.New(forumWriteFailure))
				}
			}
			id, message, code := thread.ID.String(), "Failed to create forum reply", "FORUM_CREATE_FAILED"
			log := map[string]string{"msg": message, "user_id": user.ID.String(), "thread_id": id, "err": forumWriteFailure}
			if method == "POST" {
				if err := db.Callback().Create().Before("gorm:create").Register("test:forum-write-failure", fail); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = db.Callback().Create().Remove("test:forum-write-failure") })
			} else {
				id, message, code = reply.ID.String(), "Failed to delete forum reply", "FORUM_DELETE_FAILED"
				log = map[string]string{"msg": message, "reply_id": id, "err": forumWriteFailure}
				if err := db.Callback().Delete().Before("gorm:delete").Register("test:forum-write-failure", fail); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = db.Callback().Delete().Remove("test:forum-write-failure") })
			}
			forumWriteSnapshot(t, db, &user, context.Background(), method, id, `{"body":"reply"}`, 500, `{"code":"`+code+`","error":"`+message+`"}`, log)
			var count int64
			if err := db.Model(&models.ForumReply{}).Where("thread_id = ?", thread.ID).Count(&count).Error; err != nil || count != 1 {
				t.Fatalf("live reply count = %d, err = %v; want original reply only", count, err)
			}
		})
	}
}

func TestForumReplyWritePostgresCancellationAfterLookup(t *testing.T) {
	db, user, thread, parent := forumWriteFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := db.Callback().Query().After("gorm:after_query").Register("test:cancel-forum-write", func(tx *gorm.DB) {
		if tx.Statement.Table == "forum_threads" {
			cancel()
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove("test:cancel-forum-write") })
	parentJSON := `"` + parent.ID.String() + `"`
	forumWriteSnapshot(t, db, &user, ctx, "POST", thread.ID.String(), `{"body":"  raw reply  ","parent_id":`+parentJSON+`}`, 201, forumCreatedReplyBody(parentJSON), nil)
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal("request was not cancelled after thread lookup")
	}
	forumWriteSnapshot(t, db, &user, ctx, "DELETE", forumReadID(201), "", 200, `{"message":"Reply deleted"}`, nil)
}
