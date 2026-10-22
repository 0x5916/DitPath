package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type forumReadQuery struct {
	SQL     string
	Args    []any
	Columns []string
	Rows    [][]driver.Value
	Err     error
}

// The scripted driver keeps GORM's SQL, scanning, and preloads in the test path.
// It supplies rows, not PostgreSQL semantics; bounded_reads_test.go covers those.
type forumReadScript struct {
	t       *testing.T
	queries []forumReadQuery
}

func (s *forumReadScript) Connect(context.Context) (driver.Conn, error) { return s, nil }
func (s *forumReadScript) Driver() driver.Driver                        { return s }
func (s *forumReadScript) Open(string) (driver.Conn, error)             { return s, nil }
func (s *forumReadScript) Close() error                                 { return nil }
func (s *forumReadScript) Begin() (driver.Tx, error) {
	s.t.Error("unexpected transaction")
	return nil, errors.New("unexpected transaction")
}
func (s *forumReadScript) Prepare(string) (driver.Stmt, error) {
	s.t.Error("unexpected prepared statement or write")
	return nil, errors.New("unexpected prepared statement or write")
}
func (s *forumReadScript) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if len(s.queries) == 0 {
		s.t.Errorf("unexpected query: %s", query)
		return nil, errors.New("unexpected query")
	}
	want := s.queries[0]
	s.queries = s.queries[1:]
	values := make([]any, len(args))
	for i, arg := range args {
		values[i] = arg.Value
	}
	if query != want.SQL || !reflect.DeepEqual(values, want.Args) {
		s.t.Errorf("query = %s, %v; want %s, %v", query, values, want.SQL, want.Args)
		return nil, errors.New("query mismatch")
	}
	if want.Err != nil {
		return nil, want.Err
	}
	return &forumReadRows{columns: want.Columns, rows: want.Rows}, nil
}

type forumReadRows struct {
	columns []string
	rows    [][]driver.Value
}

func (r *forumReadRows) Columns() []string { return r.columns }
func (r *forumReadRows) Close() error      { return nil }
func (r *forumReadRows) Next(dest []driver.Value) error {
	if len(r.rows) == 0 {
		return io.EOF
	}
	copy(dest, r.rows[0])
	r.rows = r.rows[1:]
	return nil
}

func forumReadDB(t *testing.T, queries []forumReadQuery) *gorm.DB {
	t.Helper()
	script := &forumReadScript{t: t, queries: queries}
	pool := sql.OpenDB(script)
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: pool}), &gorm.Config{DisableAutomaticPing: true, Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := pool.Close(); err != nil {
			t.Error(err)
		}
		if len(script.queries) != 0 {
			t.Errorf("%d expected queries were not executed", len(script.queries))
		}
	})
	return db
}

func forumReadID(n int) string { return fmt.Sprintf("00000000-0000-7000-8000-%012x", n) }

const forumReadCursor = "MjAyNi0xMC0xNlQwMDowMDowMFp8MDAwMDAwMDAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwMDBh"

func forumReadQueries() []forumReadQuery {
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	user := forumReadID(2)
	return []forumReadQuery{
		{SQL: `SELECT * FROM "forum_threads" WHERE "forum_threads"."id" = $1 AND "forum_threads"."deleted_at" IS NULL LIMIT $2`, Args: []any{forumReadID(1), int64(1)}, Columns: []string{"id", "user_id"}, Rows: [][]driver.Value{{forumReadID(1), user}}},
		{SQL: `SELECT * FROM "users" WHERE "users"."id" = $1 AND "users"."deleted_at" IS NULL`, Args: []any{user}, Columns: []string{"id", "username", "call_sign"}, Rows: [][]driver.Value{{user, "reader", "N0CALL"}}},
		{SQL: `SELECT count(*) FROM "forum_replies" WHERE thread_id = $1 AND "forum_replies"."deleted_at" IS NULL`, Args: []any{forumReadID(1)}, Columns: []string{"count"}, Rows: [][]driver.Value{{int64(5)}}},
		{SQL: `SELECT count(*) FROM "forum_replies" WHERE thread_id = $1`, Args: []any{forumReadID(1)}, Columns: []string{"count"}, Rows: [][]driver.Value{{int64(8)}}},
		{SQL: `SELECT * FROM "forum_replies" WHERE thread_id = $1 AND (created_at,id) > ($2,$3) ORDER BY created_at ASC,id ASC LIMIT $4`, Args: []any{forumReadID(1), now, forumReadID(10), int64(4)}, Columns: []string{"id", "user_id", "parent_id", "body", "created_at", "deleted_at"}, Rows: [][]driver.Value{
			{forumReadID(11), user, forumReadID(21), "live reply", now, nil},
			{forumReadID(12), user, forumReadID(22), "hidden reply", now, now},
			{forumReadID(13), user, forumReadID(23), "missing parent", now, nil},
			{forumReadID(14), user, forumReadID(24), "lookahead", now, nil},
		}},
		{SQL: `SELECT "id","username","call_sign" FROM "users" WHERE "users"."id" = $1`, Args: []any{user}, Columns: []string{"id", "username", "call_sign"}, Rows: [][]driver.Value{{user, "reader", "N0CALL"}}},
		{SQL: `SELECT "id","user_id","deleted_at",LEFT(body,160) AS body FROM "forum_replies" WHERE thread_id = $1 AND id IN ($2,$3,$4)`, Args: []any{forumReadID(1), forumReadID(21), forumReadID(22), forumReadID(23)}, Columns: []string{"id", "user_id", "deleted_at", "body"}, Rows: [][]driver.Value{
			{forumReadID(21), user, nil, "live context"},
			{forumReadID(22), user, now, "hidden context"},
		}},
		{SQL: `SELECT "id","username","call_sign" FROM "users" WHERE "users"."id" = $1`, Args: []any{user}, Columns: []string{"id", "username", "call_sign"}, Rows: [][]driver.Value{{user, "reader", "N0CALL"}}},
	}
}

func forumReadSnapshot(t *testing.T, queries []forumReadQuery, id, query string, status int, body string) {
	t.Helper()
	var expected bytes.Buffer
	if err := json.Compact(&expected, []byte(body)); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/forum/threads/"+id+"/replies?"+query, nil)
	ctx.Params = gin.Params{{Key: "id", Value: id}}
	ForumHandler{DB: forumReadDB(t, queries)}.GetThreadReplies(ctx)
	if recorder.Code != status || !bytes.Equal(recorder.Body.Bytes(), expected.Bytes()) {
		t.Fatalf("response = %d %s; want %d %s", recorder.Code, recorder.Body, status, expected.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
}

func TestForumReadReplyErrorSnapshots(t *testing.T) {
	for _, query := range []string{"limit=101", "limit=1&limit=2", "cursor=malformed"} {
		t.Run(query, func(t *testing.T) {
			forumReadSnapshot(t, nil, "malformed", query, 400, `{"code":"INVALID_QUERY_PARAMETER","error":"Invalid query parameters"}`)
		})
	}
	t.Run("malformed thread", func(t *testing.T) {
		forumReadSnapshot(t, nil, "malformed", "", 404, `{"code":"THREAD_NOT_FOUND","error":"Thread not found"}`)
	})
	t.Run("missing thread", func(t *testing.T) {
		queries := forumReadQueries()[:1]
		queries[0].Rows = nil
		forumReadSnapshot(t, queries, forumReadID(1), "", 404, `{"code":"THREAD_NOT_FOUND","error":"Thread not found"}`)
	})
	for i, name := range []string{"thread lookup", "thread author", "live count", "all count", "reply page", "reply authors", "parent context", "parent authors"} {
		t.Run(name, func(t *testing.T) {
			queries := forumReadQueries()[:i+1]
			queries[i].Err = errors.New("injected read failure")
			message := `{"code":"FORUM_QUERY_FAILED","error":"Failed to query forum replies"}`
			if i < 2 {
				message = `{"code":"FORUM_QUERY_FAILED","error":"Failed to query forum thread"}`
			}
			forumReadSnapshot(t, queries, forumReadID(1), "limit=3&cursor="+forumReadCursor, 500, message)
		})
	}
}

func TestForumReadEmptyReplySnapshot(t *testing.T) {
	queries := forumReadQueries()[:5]
	queries[2].Rows = [][]driver.Value{{int64(0)}}
	queries[3].Rows = [][]driver.Value{{int64(0)}}
	queries[4] = forumReadQuery{SQL: `SELECT * FROM "forum_replies" WHERE thread_id = $1 ORDER BY created_at ASC,id ASC LIMIT $2`, Args: []any{forumReadID(1), int64(101)}, Columns: []string{"id"}}
	forumReadSnapshot(t, queries, forumReadID(1), "", 200, `{"data":[],"total":0,"total_rows":0,"limit":100,"next_cursor":null}`)
}

func TestForumReadReplyPageSnapshot(t *testing.T) {
	// Literal cursor encodes the third retained reply, not the fourth lookahead.
	const snapshot = `{
		"data":[{
			"id":"00000000-0000-7000-8000-00000000000b",
			"parent_id":"00000000-0000-7000-8000-000000000015",
			"body":"live reply","author":{"username":"reader","call_sign":"N0CALL"},
			"is_deleted":false,"created_at":"2026-10-16T00:00:00Z","children":[],
			"parent_context":{"author":{"username":"reader","call_sign":"N0CALL"},"body":"live context","is_deleted":false}
		},{
			"id":"00000000-0000-7000-8000-00000000000c",
			"parent_id":"00000000-0000-7000-8000-000000000016",
			"body":null,"author":null,"is_deleted":true,
			"created_at":"2026-10-16T00:00:00Z","children":[],
			"parent_context":{"author":null,"body":null,"is_deleted":true}
		},{
			"id":"00000000-0000-7000-8000-00000000000d",
			"parent_id":"00000000-0000-7000-8000-000000000017",
			"body":"missing parent","author":{"username":"reader","call_sign":"N0CALL"},
			"is_deleted":false,"created_at":"2026-10-16T00:00:00Z","children":[]
		}],
		"total":5,"total_rows":8,"limit":3,
		"next_cursor":"MjAyNi0xMC0xNlQwMDowMDowMFp8MDAwMDAwMDAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwMDBk"
	}`
	forumReadSnapshot(t, forumReadQueries(), forumReadID(1), "limit=3&cursor="+forumReadCursor, 200, snapshot)
}

func TestForumReadFinalReplyWithoutParentSnapshot(t *testing.T) {
	queries := forumReadQueries()[:5]
	queries[2].Rows = [][]driver.Value{{int64(1)}}
	queries[3].Rows = [][]driver.Value{{int64(1)}}
	queries[4] = forumReadQuery{SQL: `SELECT * FROM "forum_replies" WHERE thread_id = $1 ORDER BY created_at ASC,id ASC LIMIT $2`, Args: []any{forumReadID(1), int64(2)}, Columns: []string{"id", "body", "created_at"}, Rows: [][]driver.Value{{forumReadID(11), "no parent", time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)}}}
	const snapshot = `{"data":[{"id":"00000000-0000-7000-8000-00000000000b","parent_id":null,"body":"no parent","author":null,"is_deleted":false,"created_at":"2026-10-16T00:00:00Z","children":[]}],"total":1,"total_rows":1,"limit":1,"next_cursor":null}`
	forumReadSnapshot(t, queries, forumReadID(1), "limit=1", 200, snapshot)
}
