package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSessionHistoryQuery(t *testing.T) {
	defaults, err := parseSessionHistoryQuery(url.Values{})
	if err != nil || defaults.Mode != "all" || defaults.Status != "completed" || defaults.Limit != 20 || defaults.IncludeSummary {
		t.Fatalf("unexpected defaults: %+v, %v", defaults, err)
	}
	for _, raw := range []string{
		"mode=other", "status=started", "limit=0", "limit=101", "limit=1.5", "limit=",
		"include_summary=1", "include_summary=", "from=2026-10-01", "to=bad", "cursor=",
		"from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z",
		"from=2026-10-01T00:00:00Z&to=2026-10-01T00:00:00Z",
		"mode=guided&mode=practice", "limit=1&limit=2", "cursor=a&cursor=b",
	} {
		t.Run(raw, func(t *testing.T) {
			values, err := url.ParseQuery(raw)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := parseSessionHistoryQuery(values); err == nil {
				t.Fatal("accepted invalid query")
			}
		})
	}
	first, err := parseSessionHistoryQuery(url.Values{"mode": {"practice"}, "status": {"all"}, "from": {"2026-10-20T08:00:00+08:00"}, "to": {"2026-10-21T00:00:00Z"}})
	if err != nil {
		t.Fatal(err)
	}
	equivalent, err := parseSessionHistoryQuery(url.Values{"mode": {"practice"}, "status": {"all"}, "from": {"2026-10-20T00:00:00Z"}, "to": {"2026-10-21T00:00:00Z"}, "limit": {"100"}, "include_summary": {"true"}})
	if err != nil || first.fingerprint() != equivalent.fingerprint() {
		t.Fatalf("equivalent filters must share a fingerprint: %v", err)
	}
	equivalent.Status = "completed"
	if first.fingerprint() == equivalent.fingerprint() {
		t.Fatal("changed status did not change cursor binding")
	}
}

func TestSessionHistoryCursorAuthentication(t *testing.T) {
	key := []byte("history-test-key")
	before := sessionHistoryCursor{Version: 1, UserID: uuid.New(), Filters: "filter", Epoch: 2, HighWater: 9007199254740993, Occurred: time.Date(2026, 10, 20, 1, 2, 3, 456000, time.UTC), ID: uuid.New()}
	encoded, err := encodeSessionHistoryCursor(before, key)
	if err != nil {
		t.Fatal(err)
	}
	after, err := decodeSessionHistoryCursor(encoded, key)
	if err != nil || before != after {
		t.Fatalf("cursor round trip lost data: %+v, %v", after, err)
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.Split(encoded, ".")[0])
	if err != nil || !strings.Contains(string(payload), `"high_water":"9007199254740993"`) {
		t.Fatalf("revision must be encoded losslessly: %s, %v", payload, err)
	}
	tampered := strings.Split(encoded, ".")
	tampered[0] = base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(string(payload), "9007199254740993", "9007199254740994", 1)))
	for name, value := range map[string]string{"tampered": strings.Join(tampered, "."), "malformed": "bad", "truncated": strings.Split(encoded, ".")[0], "too_long": strings.Repeat("x", 4097)} {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeSessionHistoryCursor(value, key); err == nil {
				t.Fatal("accepted invalid cursor")
			}
		})
	}
	if _, err := decodeSessionHistoryCursor(encoded, []byte("another key")); err == nil {
		t.Fatal("accepted cursor with wrong signing key")
	}
	if _, err := encodeSessionHistoryCursor(before, nil); err == nil {
		t.Fatal("signed a cursor without a configured key")
	}
	before.Epoch = 0
	invalid, err := encodeSessionHistoryCursor(before, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeSessionHistoryCursor(invalid, key); err == nil {
		t.Fatal("accepted structurally invalid signed cursor")
	}
}

func TestSessionHistoryCursorPreservesZeroOccurrence(t *testing.T) {
	key := []byte("history-test-key")
	cursor := sessionHistoryCursor{Version: 1, UserID: uuid.New(), Filters: "filter", Epoch: 1, HighWater: 1, Occurred: time.Time{}, ID: uuid.New()}
	encoded, err := encodeSessionHistoryCursor(cursor, key)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeSessionHistoryCursor(encoded, key)
	if err != nil || decoded != cursor {
		t.Fatalf("valid year-one occurrence did not round trip: %+v, %v", decoded, err)
	}
	for _, missing := range []bool{true, false} {
		name := "null"
		if missing {
			name = "missing"
		}
		t.Run(name, func(t *testing.T) {
			raw, err := json.Marshal(cursor)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(raw, &fields); err != nil {
				t.Fatal(err)
			}
			if missing {
				delete(fields, "occurred")
			} else {
				fields["occurred"] = json.RawMessage("null")
			}
			payload, err := json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			signed := base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(sessionHistorySignature(payload, key))
			if _, err := decodeSessionHistoryCursor(signed, key); err == nil {
				t.Fatal("accepted signed cursor without an occurrence timestamp")
			}
		})
	}
}

func TestSessionHistoryFilterSQL(t *testing.T) {
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=localhost user=unused dbname=unused", PreferSimpleProtocol: true}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	from, to := time.Now().UTC(), time.Now().UTC().Add(time.Hour)
	query := sessionHistoryQuery{Mode: "legacy", Status: "completed", From: &from, To: &to}
	var records []models.TrainingSession
	statement := query.scope(db.Model(&models.TrainingSession{})).Find(&records).Statement
	sql := statement.SQL.String()
	for _, expected := range []string{"source_kind =", "status =", "occurred_at >=", "occurred_at <"} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("missing %q in %s", expected, sql)
		}
	}
	if len(statement.Vars) != 4 || statement.Vars[0] != "legacy_v1" || statement.Vars[2] != from || statement.Vars[3] != to {
		t.Fatalf("wrong filter arguments: %+v", statement.Vars)
	}
	query.Mode, query.Status, query.From, query.To = "all", "all", nil, nil
	statement = query.scope(db.Model(&models.TrainingSession{})).Find(&records).Statement
	if strings.Contains(statement.SQL.String(), "WHERE") {
		t.Fatalf("all filter unexpectedly restricts history: %s", statement.SQL.String())
	}
}

func TestSessionHistoryRejectsInvalidQueryBeforeDatabaseAccess(t *testing.T) {
	for _, query := range []string{"limit=101", "cursor=malformed"} {
		t.Run(query, func(t *testing.T) {
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest(http.MethodGet, "/v1/training/sessions?"+query, nil)
			c.Set("user", &models.User{Base: models.Base{ID: uuid.New()}})
			TrainingHandler{}.GetSessions(c)
			var body common.ErrorResponse
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusBadRequest || body.Code != common.ErrorCodeInvalidQueryParameter {
				t.Fatalf("unexpected query error: %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestSessionHistoryFixedRevisionPagesAndCompleteRangeSummary(t *testing.T) {
	db, user := sessionStorageDB(t)
	previousKey := configs.App.JWTSecret
	configs.App.JWTSecret = []byte("disposable-history-test-signing-key")
	t.Cleanup(func() { configs.App.JWTSecret = previousKey })
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	legacyTime := base.Add(150 * time.Minute)
	legacy := models.Progress{UserID: user.ID, Lesson: 4, CharWPM: 20, EffWPM: 15, Accuracy: .8, ClientCreatedAt: &legacyTime}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	makeSession := func(id, mode string, end time.Time, elapsed time.Duration) map[string]any {
		session := sessionStorageSession(id, mode)
		session["started_at"], session["ended_at"] = end.Add(-elapsed).Format(time.RFC3339Nano), end.Format(time.RFC3339Nano)
		if mode == "guided" {
			session["attempt_count"], session["event_ids"] = 0, []string{}
		}
		return session
	}
	p1 := makeSession("history-practice-1", "practice", base.Add(3*time.Hour), time.Second)
	p2 := makeSession("history-practice-2", "practice", base.Add(3*time.Hour), 2*time.Second)
	guided := makeSession("history-guided", "guided", base.Add(2*time.Hour), 3*time.Second)
	abandoned := makeSession("history-abandoned", "guided", base.Add(time.Hour), time.Second)
	abandoned["status"], abandoned["started_at"], abandoned["ended_at"] = "abandoned", base.Add(time.Hour).Format(time.RFC3339), nil
	sessionStoragePost(t, db, user, p1, p2, guided, abandoned)
	other := sessionStorageUser(t, db)
	sessionStoragePost(t, db, other, makeSession("history-other", "practice", base.Add(5*time.Hour), time.Second))
	type historyPage struct {
		Sessions          []map[string]any      `json:"sessions"`
		NextCursor        *string               `json:"next_cursor"`
		HasMore           bool                  `json:"has_more"`
		HighWaterRevision string                `json:"high_water_revision"`
		Summary           sessionHistorySummary `json:"summary"`
	}
	read := func(query string) historyPage {
		t.Helper()
		response := sessionStorageRequest(t, db, user, http.MethodGet, "/v1/training/sessions?"+query, nil, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("history status=%d: %s", response.Code, response.Body.String())
		}
		var page historyPage
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		return page
	}
	page := read("status=all&limit=1&include_summary=true")
	if len(page.Sessions) != 1 || !page.HasMore || page.NextCursor == nil {
		t.Fatalf("missing pagination: %+v", page)
	}
	firstCursor, highWater := *page.NextCursor, page.HighWaterRevision
	counts := page.Summary.CompletedCounts
	if counts.Guided != 1 || counts.Practice != 2 || counts.Legacy != 1 || page.Summary.CompletedWithMeasuredTiming != 3 || page.Summary.RecordedElapsedMS != 6000 {
		t.Fatalf("summary must cover the full range with known durations: %+v", page.Summary)
	}
	sessionStoragePost(t, db, user, makeSession("history-late", "practice", base.Add(90*time.Minute), 4*time.Second))
	seen := map[string]bool{}
	ordered := []string{}
	for {
		for _, record := range page.Sessions {
			id, _ := record["session_id"].(string)
			if seen[id] || id == "history-late" || id == "history-other" {
				t.Fatalf("page leaked or repeated session %q", id)
			}
			seen[id], ordered = true, append(ordered, id)
			if _, ok := record["sync_revision"].(string); !ok {
				t.Fatalf("revision is not a lossless string: %+v", record)
			}
		}
		if !page.HasMore {
			if page.NextCursor != nil {
				t.Fatal("final history page retained a cursor")
			}
			break
		}
		if page.NextCursor == nil {
			t.Fatal("history has more without a cursor")
		}
		page = read("status=all&limit=1&include_summary=true&cursor=" + url.QueryEscape(*page.NextCursor))
		if page.HighWaterRevision != highWater || page.Summary.RecordedElapsedMS != 6000 {
			t.Fatalf("pagination changed its revision ceiling or totals: %+v", page)
		}
	}
	if len(seen) != 5 || ordered[2] != "legacy:"+legacy.ID.String() || !seen["history-abandoned"] {
		t.Fatalf("lost terminal history or occurrence ordering: %+v", ordered)
	}
	var tied []models.TrainingSession
	if err := db.Where("user_id = ? AND session_id IN ?", user.ID, []string{"history-practice-1", "history-practice-2"}).Order("id DESC").Find(&tied).Error; err != nil {
		t.Fatal(err)
	}
	if len(tied) != 2 || ordered[0] != tied[0].SessionID || ordered[1] != tied[1].SessionID {
		t.Fatalf("equal occurrence times did not use ID keyset ordering: %+v", ordered)
	}
	filtered := read("mode=practice&from=" + url.QueryEscape(base.Add(3*time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(base.Add(4*time.Hour).Format(time.RFC3339)) + "&include_summary=true")
	if len(filtered.Sessions) != 2 || filtered.Summary.RecordedElapsedMS != 3000 {
		t.Fatalf("inclusive from/exclusive to filters failed: %+v", filtered)
	}
	legacyPage := read("mode=legacy&include_summary=true")
	if len(legacyPage.Sessions) != 1 || legacyPage.Sessions[0]["mode"] != nil || legacyPage.Sessions[0]["started_at"] != nil || legacyPage.Summary.CompletedWithMeasuredTiming != 0 {
		t.Fatalf("invented legacy mode or timing: %+v", legacyPage)
	}
	abandonedPage := read("status=abandoned&include_summary=true")
	if len(abandonedPage.Sessions) != 1 || abandonedPage.Summary.RecordedElapsedMS != 0 {
		t.Fatalf("abandoned sessions affected completed timing: %+v", abandonedPage)
	}
	fresh := read("status=all&include_summary=true")
	if len(fresh.Sessions) != 6 || fresh.Summary.RecordedElapsedMS != 10000 {
		t.Fatalf("fresh history did not include late offline upload: %+v", fresh)
	}
	wrongAccount := sessionStorageRequest(t, db, other, http.MethodGet, "/v1/training/sessions?status=all&cursor="+url.QueryEscape(firstCursor), nil, nil)
	wrongFilters := sessionStorageRequest(t, db, user, http.MethodGet, "/v1/training/sessions?mode=guided&status=all&cursor="+url.QueryEscape(firstCursor), nil, nil)
	if wrongAccount.Code != http.StatusBadRequest || wrongFilters.Code != http.StatusBadRequest {
		t.Fatalf("cursor account/filter binding failed: account=%d filters=%d", wrongAccount.Code, wrongFilters.Code)
	}
	if err := db.Model(&models.TrainingSyncState{}).Where("user_id = ?", user.ID).Update("feed_epoch", 2).Error; err != nil {
		t.Fatal(err)
	}
	retired := sessionStorageRequest(t, db, user, http.MethodGet, "/v1/training/sessions?status=all&cursor="+url.QueryEscape(firstCursor), nil, nil)
	if retired.Code != http.StatusGone || !strings.Contains(retired.Body.String(), "TRAINING_CURSOR_RESET_REQUIRED") {
		t.Fatalf("retired cursor status=%d: %s", retired.Code, retired.Body.String())
	}
}

func TestSessionHistoryCommitsBoundedBootstrapBeforeRetry(t *testing.T) {
	db, user := sessionStorageDB(t)
	events := make([]models.TrainingEvent, 101)
	for i := range events {
		events[i] = models.TrainingEvent{UserID: user.ID, EventID: uuid.NewString(), SessionID: "unfinished", PromptID: "prompt", PromptKind: "recall", TargetCharacter: "K", EnteredText: "K", IsCorrect: true, Classification: "automatic", LatencyMS: 1000, InputMode: "keyboard", CharWPM: 20, EffWPM: 12, FreqHz: 600, ClientCreatedAt: time.Now().UTC()}
	}
	if err := db.CreateInBatches(&events, 100).Error; err != nil {
		t.Fatal(err)
	}
	response := sessionStorageRequest(t, db, user, http.MethodGet, "/v1/training/sessions", nil, nil)
	if response.Code != http.StatusServiceUnavailable || response.Header().Get("Retry-After") != "1" || !strings.Contains(response.Body.String(), "TRAINING_SYNC_INITIALIZING") {
		t.Fatalf("partial bootstrap was served as complete: %d %s", response.Code, response.Body.String())
	}
	var state models.TrainingSyncState
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.BackfillComplete || state.LastRevision != 100 {
		t.Fatalf("503 discarded bounded bootstrap progress: %+v, %v", state, err)
	}
	response = sessionStorageRequest(t, db, user, http.MethodGet, "/v1/training/sessions", nil, nil)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"high_water_revision":"101"`) || !strings.Contains(response.Body.String(), `"sessions":[]`) {
		t.Fatalf("bootstrap retry lost orphan attempts or fabricated terminal history: %d %s", response.Code, response.Body.String())
	}
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || !state.BackfillComplete || state.LastRevision != 101 {
		t.Fatalf("bootstrap did not drain exactly once: %+v, %v", state, err)
	}
}
