package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/models"

	"github.com/google/uuid"
)

func TestTrainingChangesQuery(t *testing.T) {
	for _, raw := range []string{"limit=0", "limit=101", "limit=no", "limit=", "limit=1&limit=2", "cursor=", "cursor=a&cursor=b"} {
		t.Run(raw, func(t *testing.T) {
			values, _ := url.ParseQuery(raw)
			if _, _, err := parseTrainingChangesQuery(values); err == nil {
				t.Fatal("invalid query accepted")
			}
		})
	}
	limit, cursor, err := parseTrainingChangesQuery(url.Values{})
	if err != nil || limit != 100 || cursor != "" {
		t.Fatalf("defaults: %d %q %v", limit, cursor, err)
	}
}

func TestTrainingChangesCursor(t *testing.T) {
	key := []byte("training-changes-test")
	cursor := trainingChangesCursor{Version: 1, UserID: uuid.New(), Epoch: 1, After: 9007199254740992, HighWater: 9007199254740993}
	encoded, err := encodeTrainingChangesCursor(cursor, key)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := decodeTrainingChangesCursor(encoded, key)
	if err != nil || actual != cursor {
		t.Fatalf("cursor lost exact integer: %+v %v", actual, err)
	}
	for _, bad := range []string{encoded + "x", strings.Repeat("x", 4097), "wrong", strings.Split(encoded, ".")[0] + ".invalid"} {
		if _, err := decodeTrainingChangesCursor(bad, key); err == nil {
			t.Fatal("malformed or tampered cursor accepted")
		}
	}
	if _, err := decodeTrainingChangesCursor(encoded, []byte("different")); err == nil {
		t.Fatal("wrong signing key accepted")
	}
	for _, bad := range []trainingChangesCursor{
		{Version: 2, UserID: cursor.UserID, Epoch: 1},
		{Version: 1, Epoch: 1}, {Version: 1, UserID: cursor.UserID},
		{Version: 1, UserID: cursor.UserID, Epoch: 1, After: 2, HighWater: 1},
		{Version: 1, UserID: cursor.UserID, Epoch: 1, After: -1},
	} {
		encoded, _ := encodeTrainingChangesCursor(bad, key)
		if _, err := decodeTrainingChangesCursor(encoded, key); err == nil {
			t.Fatalf("invalid contents accepted: %+v", bad)
		}
	}
	payload, _ := json.Marshal(cursor)
	wrongDomain := base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(sessionHistorySignature(payload, key))
	if _, err := decodeTrainingChangesCursor(wrongDomain, key); err == nil {
		t.Fatal("session-history signature accepted for changes")
	}
}

func TestTrainingChangesPageByteBoundAndCheckpoint(t *testing.T) {
	key := []byte("page-test")
	cursor := trainingChangesCursor{Version: 1, UserID: uuid.New(), Epoch: 1, HighWater: 3}
	large, _ := json.Marshal(map[string]string{"text": strings.Repeat("<", 200000)})
	rows := []models.TrainingChange{{Revision: 1, Kind: "session", Payload: large}, {Revision: 2, Kind: "session", Payload: large}, {Revision: 3, Kind: "attempt", Payload: json.RawMessage(`{"id":"small"}`)}}
	// JSON escaping, the cursor and the envelope all count toward the cap.
	if len(large) < trainingChangesMaxBytes {
		t.Fatal("test must exercise escaping over the single-record cap")
	}
	if _, err := marshalTrainingChangesPage(rows, 100, cursor, key); err == nil {
		t.Fatal("oversized single record accepted")
	}
	medium, _ := json.Marshal(map[string]string{"text": strings.Repeat("a", 600000)})
	rows[0].Payload, rows[1].Payload = medium, medium
	payload, err := marshalTrainingChangesPage(rows, 100, cursor, key)
	var page trainingChangesResponse
	if err != nil || json.Unmarshal(payload, &page) != nil || len(payload) > trainingChangesMaxBytes || len(page.Changes) != 1 || !page.HasMore {
		t.Fatalf("byte bounded page: %d %+v %v", len(payload), page, err)
	}
	next, _ := decodeTrainingChangesCursor(page.NextCursor, key)
	if next.After != 1 || next.HighWater != 3 {
		t.Fatalf("page skipped or changed ceiling: %+v", next)
	}
	payload, err = marshalTrainingChangesPage(rows[1:], 1, next, key)
	if err != nil || json.Unmarshal(payload, &page) != nil || !page.HasMore || len(page.Changes) != 1 || page.Changes[0].Revision != "2" {
		t.Fatalf("count-bounded page: %+v %v", page, err)
	}
	next, _ = decodeTrainingChangesCursor(page.NextCursor, key)
	payload, _ = marshalTrainingChangesPage(rows[2:], 100, next, key)
	_ = json.Unmarshal(payload, &page)
	next, _ = decodeTrainingChangesCursor(page.NextCursor, key)
	if page.HasMore || next.After != 3 || next.HighWater != 3 {
		t.Fatalf("drain did not checkpoint: %+v %+v", page, next)
	}
	payload, _ = marshalTrainingChangesPage(nil, 100, next, key)
	_ = json.Unmarshal(payload, &page)
	if page.HasMore || len(page.Changes) != 0 || page.NextCursor == "" {
		t.Fatalf("empty checkpoint missing: %+v", page)
	}
}

func TestTrainingChangesBootstrapFixedCeilingLateCommitAndIsolation(t *testing.T) {
	db, user := sessionStorageDB(t)
	oldKey := configs.App.JWTSecret
	configs.App.JWTSecret = []byte("feed-db-test")
	t.Cleanup(func() { configs.App.JWTSecret = oldKey })
	for i := range 101 {
		event := models.TrainingEvent{UserID: user.ID, EventID: "old-" + strconv.Itoa(i), SessionID: "unfinished", PromptID: "p", PromptKind: "recall", TargetCharacter: "K", EnteredText: "K", IsCorrect: true, Classification: "automatic", LatencyMS: 1000, InputMode: "keyboard", CharWPM: 20, EffWPM: 12, FreqHz: 600, ClientCreatedAt: time.Now().UTC()}
		if err := db.Create(&event).Error; err != nil {
			t.Fatal(err)
		}
	}
	response := sessionStorageRequest(t, db, user, "GET", "/v1/training/changes", nil, nil)
	if response.Code != 503 || response.Header().Get("Retry-After") != "1" {
		t.Fatalf("bootstrap: %d %s", response.Code, response.Body.String())
	}
	var state models.TrainingSyncState
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 100 || state.BackfillComplete {
		t.Fatalf("bounded bootstrap was not committed: %+v %v", state, err)
	}
	get := func(cursor string, limit int) trainingChangesResponse {
		t.Helper()
		query := "limit=" + strconv.Itoa(limit)
		if cursor != "" {
			query += "&cursor=" + url.QueryEscape(cursor)
		}
		response := sessionStorageRequest(t, db, user, "GET", "/v1/training/changes?"+query, nil, nil)
		var page trainingChangesResponse
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &page) != nil {
			t.Fatalf("download: %d %s", response.Code, response.Body.String())
		}
		return page
	}
	first := get("", 1)
	if len(first.Changes) != 1 || first.Changes[0].Revision != "1" || !first.HasMore {
		t.Fatalf("first page: %+v", first)
	}
	late := validEventMap()
	late["id"], late["created_at"] = "late-offline", "2020-01-01T00:00:00Z"
	sessionStorageEvents(t, db, user, late)
	cursor := first.NextCursor
	seen := map[string]bool{"1": true}
	for {
		page := get(cursor, 100)
		for _, change := range page.Changes {
			if seen[change.Revision] || change.Revision == "102" {
				t.Fatalf("duplicate or ceiling breach: %+v", change)
			}
			seen[change.Revision] = true
		}
		cursor = page.NextCursor
		if !page.HasMore {
			break
		}
	}
	if len(seen) != 101 {
		t.Fatalf("backfill lost revisions: %d", len(seen))
	}
	latePage := get(cursor, 100)
	if len(latePage.Changes) != 1 || latePage.Changes[0].Revision != "102" || latePage.HasMore || !strings.Contains(string(latePage.Changes[0].Record), "late-offline") {
		t.Fatalf("late commit was skipped: %+v", latePage)
	}
	other := sessionStorageUser(t, db)
	response = sessionStorageRequest(t, db, other, "GET", "/v1/training/changes?cursor="+url.QueryEscape(cursor), nil, nil)
	if response.Code != 400 {
		t.Fatalf("cross-account cursor accepted: %d", response.Code)
	}
	if err := db.Model(&models.TrainingSyncState{}).Where("user_id = ?", user.ID).Update("feed_epoch", 2).Error; err != nil {
		t.Fatal(err)
	}
	response = sessionStorageRequest(t, db, user, "GET", "/v1/training/changes?cursor="+url.QueryEscape(cursor), nil, nil)
	if response.Code != 410 || !strings.Contains(response.Body.String(), common.ErrorCodeTrainingCursorResetRequired) {
		t.Fatalf("retired cursor: %d %s", response.Code, response.Body.String())
	}
}

func TestTrainingChangesIncludesBothModesLegacyAndConcurrentWrites(t *testing.T) {
	db, user := sessionStorageDB(t)
	oldKey := configs.App.JWTSecret
	configs.App.JWTSecret = []byte("feed-modes-test")
	t.Cleanup(func() { configs.App.JWTSecret = oldKey })
	legacy := models.Progress{UserID: user.ID, Lesson: 9, CharWPM: 20, EffWPM: 12, Accuracy: .7}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	sessionStoragePost(t, db, user, sessionStorageSession("practice-history", "practice"))
	// Every writer takes the same account lock, so revisions remain contiguous
	// despite concurrent request completion and deliberately old client times.
	const writers = 8
	responses := make(chan int, writers)
	for i := range writers {
		go func(i int) {
			event := sessionStorageEvent("concurrent-"+strconv.Itoa(i), "guided-history", "automatic", true)
			event["created_at"] = "2020-01-01T00:00:00Z"
			response := sessionStorageRequest(t, db, user, "POST", "/v1/training/events/batch", map[string]any{"schema_version": 2, "client_id": uuid.NewString(), "events": []any{event}}, nil)
			responses <- response.Code
		}(i)
	}
	for range writers {
		if code := <-responses; code != http.StatusOK {
			t.Fatalf("concurrent upload: %d", code)
		}
	}
	guided := sessionStorageSession("guided-history", "guided")
	ids := make([]string, writers)
	for i := range writers {
		ids[i] = "concurrent-" + strconv.Itoa(i)
	}
	guided["prompt_count"], guided["attempt_count"], guided["event_ids"] = writers+1, writers, ids
	if result := sessionStoragePost(t, db, user, guided); len(result.AcknowledgedIDs) != 1 {
		t.Fatalf("guided finalization: %+v", result)
	}
	response := sessionStorageRequest(t, db, user, "GET", "/v1/training/changes", nil, nil)
	var page trainingChangesResponse
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &page) != nil || page.HasMore || len(page.Changes) != writers+3 {
		t.Fatalf("complete feed: %d %s", response.Code, response.Body.String())
	}
	modes := map[string]bool{}
	for i, change := range page.Changes {
		if change.Revision != strconv.Itoa(i+1) {
			t.Fatalf("revision gap or wrong order: %+v", change)
		}
		if change.Kind == "session" {
			var record map[string]any
			if err := json.Unmarshal(change.Record, &record); err != nil {
				t.Fatal(err)
			}
			if record["source_kind"] == "legacy_v1" {
				modes["legacy"] = true
				if record["session_id"] != "legacy:"+legacy.ID.String() || record["mode"] != nil || record["started_at"] != nil || record["ended_at"] != nil || record["prompt_count"] != nil {
					t.Fatalf("legacy identity or unknowns changed: %+v", record)
				}
			} else {
				modes[record["mode"].(string)] = true
			}
		}
	}
	if !modes["guided"] || !modes["practice"] || !modes["legacy"] {
		t.Fatalf("missing history modes: %+v", modes)
	}
}
