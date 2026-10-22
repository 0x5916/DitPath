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
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"testing/synctest"
	"time"

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const snapshotUserID = "00000000-0000-7000-8000-000000000001"
const snapshotFailure = `{"code":"TRAINING_SNAPSHOT_FAILED","error":"Failed to build training snapshot"}`
const snapshotMasteries = `[{"character":"E","status":"learning","rolling_accuracy":0,"median_latency_ms":null,"total_attempts":1},{"character":"T","status":"learning","rolling_accuracy":1,"median_latency_ms":1000,"total_attempts":1}]`

type snapshotQuery struct {
	sql      string
	args     []any
	columns  []string
	values   [][]driver.Value
	err      error
	nextErr  error
	closeErr error
	cancel   context.CancelFunc
	delay    time.Duration
}

// This driver exercises GORM scanning and database/sql row lifetimes, including
// failures after a successful query. PostgreSQL ordering is covered separately.
type snapshotScript struct {
	t             *testing.T
	queries       []snapshotQuery
	recorder      *httptest.ResponseRecorder
	request       context.Context
	historyClosed bool
	closeBodySize int
}

func (s *snapshotScript) Connect(context.Context) (driver.Conn, error) { return s, nil }
func (s *snapshotScript) Driver() driver.Driver                        { return s }
func (s *snapshotScript) Open(string) (driver.Conn, error)             { return s, nil }
func (s *snapshotScript) Close() error                                 { return nil }
func (s *snapshotScript) Begin() (driver.Tx, error) {
	s.t.Error("unexpected transaction")
	return nil, errors.New("unexpected transaction")
}
func (s *snapshotScript) Prepare(string) (driver.Stmt, error) {
	s.t.Error("unexpected prepared statement or write")
	return nil, errors.New("unexpected prepared statement or write")
}
func (s *snapshotScript) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
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
	if ctx != s.request || query != want.sql || !reflect.DeepEqual(values, want.args) {
		s.t.Errorf("query = %s %v; want %s %v; request context preserved = %t", query, values, want.sql, want.args, ctx == s.request)
		return nil, errors.New("query mismatch")
	}
	history := len(want.columns) == 6
	if !history && !s.historyClosed {
		s.t.Error("profile read before history rows closed")
	}
	time.Sleep(want.delay)
	if want.cancel != nil && !history {
		want.cancel()
		return nil, ctx.Err()
	}
	if want.err != nil {
		return nil, want.err
	}
	return &snapshotRows{query: want, script: s, history: history}, nil
}

type snapshotRows struct {
	query   snapshotQuery
	script  *snapshotScript
	history bool
}

func (r *snapshotRows) Columns() []string { return r.query.columns }
func (r *snapshotRows) Close() error {
	if r.history {
		r.script.historyClosed = true
		r.script.closeBodySize = r.script.recorder.Body.Len()
	}
	return r.query.closeErr
}
func (r *snapshotRows) Next(dest []driver.Value) error {
	if len(r.query.values) > 0 {
		copy(dest, r.query.values[0])
		r.query.values = r.query.values[1:]
		return nil
	}
	if r.query.cancel != nil {
		r.query.cancel()
		return context.Canceled
	}
	if r.query.nextErr != nil {
		return r.query.nextErr
	}
	return io.EOF
}

func snapshotQueries() []snapshotQuery {
	day := func(n int) time.Time { return time.Date(2100, 1, n, 0, 0, 0, 0, time.UTC) }
	return []snapshotQuery{
		{sql: `SELECT "target_character","classification","is_correct","latency_ms","session_id","client_created_at" FROM "training_events" WHERE user_id = $1 AND "training_events"."deleted_at" IS NULL ORDER BY client_created_at ASC, id ASC`, args: []any{snapshotUserID}, columns: []string{"target_character", "classification", "is_correct", "latency_ms", "session_id", "client_created_at"}, values: [][]driver.Value{
			{"T", "automatic", true, int64(1000), "session", day(1)},
			{"E", "incorrect", false, int64(2000), "session", day(1)},
			{"Z", "unmeasured", false, int64(0), "session", day(2)},
			{" ", "automatic", true, int64(900), "session", day(3)},
		}},
		{sql: `SELECT * FROM "training_profiles" WHERE user_id = $1 AND "training_profiles"."deleted_at" IS NULL LIMIT $2`, args: []any{snapshotUserID, int64(1)}, columns: []string{"suggested_step", "unlocked_step", "last_active_at"}},
	}
}

func snapshotResponse(t *testing.T, ctx context.Context, queries []snapshotQuery, status int, body, logMessage string) *snapshotScript {
	t.Helper()
	recorder := httptest.NewRecorder()
	script := &snapshotScript{t: t, queries: queries, recorder: recorder, request: ctx, closeBodySize: -1}
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
			t.Errorf("%d expected queries not executed", len(script.queries))
		}
	})
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v2/training/snapshot", nil).WithContext(ctx)
	c.Set("user", &models.User{Base: models.Base{ID: uuid.MustParse(snapshotUserID)}})
	TrainingHandler{DB: db}.GetSnapshot(c)
	if recorder.Code != status || recorder.Body.String() != body || recorder.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("response = %d %s %s; want %d %s", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body, status, body)
	}
	if logMessage == "" {
		if logs.Len() != 0 {
			t.Fatalf("unexpected logs: %s", &logs)
		}
	} else {
		var record map[string]any
		if err := json.Unmarshal(logs.Bytes(), &record); err != nil {
			t.Fatal(err)
		}
		if record["msg"] != logMessage || record["level"] != "ERROR" || record["user_id"] != snapshotUserID || record["err"] == nil {
			t.Fatalf("log = %v", record)
		}
	}
	return script
}

func TestSnapshotResponseSnapshots(t *testing.T) {
	for _, test := range []struct {
		name, lastActive    string
		suggested, unlocked int
		profile             []driver.Value
		historyRows         int
		err                 error
	}{
		{"empty", `null`, 1, 1, nil, 0, nil},
		{"missing profile", `"2100-01-03T00:00:00Z"`, 1, 1, nil, 4, nil},
		{"wrapped missing profile", `"2100-01-03T00:00:00Z"`, 1, 1, nil, 4, fmt.Errorf("wrapped: %w", gorm.ErrRecordNotFound)},
		{"unmeasured activity fallback", `"2100-01-02T00:00:00Z"`, 1, 1, nil, 3, nil},
		{"older profile activity wins", `"2000-01-01T00:00:00Z"`, 4, 7, []driver.Value{int64(4), int64(7), time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)}, 4, nil},
		{"profile activity without history", `"2000-01-01T00:00:00Z"`, 4, 7, []driver.Value{int64(4), int64(7), time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)}, 0, nil},
		{"nil activity falls back and steps clamp", `"2100-01-03T00:00:00Z"`, 1, 1, []driver.Value{int64(0), int64(-1), nil}, 4, nil},
		{"steps clamp independently", `"2100-01-03T00:00:00Z"`, 3, 1, []driver.Value{int64(3), int64(1), nil}, 4, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			queries := snapshotQueries()
			queries[0].values = queries[0].values[:test.historyRows]
			masteries := snapshotMasteries
			if test.historyRows == 0 {
				masteries = `[]`
			}
			if test.profile != nil {
				queries[1].values = [][]driver.Value{test.profile}
			}
			queries[1].err = test.err
			body := fmt.Sprintf(`{"suggested_step":%d,"unlocked_step":%d,"last_active_at":%s,"character_masteries":%s}`, test.suggested, test.unlocked, test.lastActive, masteries)
			script := snapshotResponse(t, context.Background(), queries, 200, body, "")
			if !script.historyClosed || script.closeBodySize != 0 {
				t.Fatal("history EOF must close rows before profile and response")
			}
		})
	}
}

func TestSnapshotFailureSnapshotsAndRowsLifetime(t *testing.T) {
	for _, stage := range []string{"query", "scan", "iteration", "close at EOF", "profile", "cancel before query", "cancel in history", "cancel in profile"} {
		t.Run(stage, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			queries := snapshotQueries()
			message := "Failed to load training events"
			switch stage {
			case "query":
				queries[0].err = errors.New("injected query failure")
				queries = queries[:1]
			case "scan":
				queries[0].values[0][3] = "invalid integer"
				queries = queries[:1]
			case "iteration":
				queries[0].nextErr = errors.New("injected iteration failure")
				queries = queries[:1]
			case "close at EOF":
				queries[0].closeErr = errors.New("injected close failure")
				queries = queries[:1]
			case "profile":
				queries[1].err = errors.New("injected profile failure")
				message = "Failed to load training profile"
			case "cancel before query":
				cancel()
				queries = nil
			case "cancel in history":
				queries[0].cancel = cancel
				queries = queries[:1]
			case "cancel in profile":
				queries[1].cancel = cancel
				message = "Failed to load training profile"
			}
			script := snapshotResponse(t, ctx, queries, 500, snapshotFailure, message)
			if stage == "scan" && script.closeBodySize != len(snapshotFailure) {
				t.Fatal("scan failure must retain rows until after the HTTP response")
			}
		})
	}
}

func TestSnapshotMasteryTimePrecedesProfileLookup(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		queries := snapshotQueries()
		queries[0].values = nil
		for i := range 12 {
			session := "first"
			if i == 11 {
				session = "second"
			}
			queries[0].values = append(queries[0].values, []driver.Value{"T", "automatic", true, int64(1000), session, time.Now().UTC()})
		}
		// A profile lookup spanning the review boundary must not age the mastery.
		queries[1].delay = 72 * time.Hour
		const body = `{"suggested_step":1,"unlocked_step":1,"last_active_at":"2000-01-01T00:00:00Z","character_masteries":[{"character":"T","status":"stable","rolling_accuracy":1,"median_latency_ms":1000,"total_attempts":12}]}`
		snapshotResponse(t, context.Background(), queries, 200, body, "")
	})
}
