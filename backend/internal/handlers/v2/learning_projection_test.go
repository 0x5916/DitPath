package handlers

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"net/url"
	"opencw/internal/configs"
	"opencw/internal/models"
	"testing"
	"time"
)

// Each delivery has its own durable guard; first tone can follow guard persistence.
func mixedEvidenceFixture(id string, start time.Time) []map[string]any {
	stamp := func(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
	plan := learningPlanFixture()
	plan["id"], plan["session_id"], plan["purpose"], plan["feedback"] = "plan_"+id, id, "mixed-check", "after-check"
	plan["started_at"], plan["recorded_at"] = stamp(start), stamp(start)
	prompts := []any{}
	records := []map[string]any{plan}
	ids := []string{}
	for i := 0; i < 20; i++ {
		ch := "K"
		if i%2 == 1 {
			ch = "M"
		}
		prompt, presentation := fmt.Sprintf("p_%s_%d", id, i), fmt.Sprintf("tone_%s_%d", id, i)
		prompts = append(prompts, map[string]any{"id": prompt, "character": ch, "role": "target"})
		tone := start.Add(time.Duration(i*3+1) * time.Second)
		open := learningFixture("exposure-open", "open_"+presentation, map[string]any{"session_id": id, "presentation_id": presentation, "characters": []string{ch}, "source": "mixed-check", "started_at": learningBounds(stamp(tone.Add(-500 * time.Millisecond)))})
		close := learningFixture("exposure-close", "close_"+presentation, map[string]any{"open_id": open["id"], "end_reason": "completed", "last_exposure": map[string]any{ch: learningBounds(stamp(tone.Add(time.Second)))}})
		observation := learningFixture("observation", "answer_"+prompt, map[string]any{"session_id": id, "prompt_id": prompt, "presentation_id": presentation, "first_response": ch, "final_response": ch, "skipped": false, "replay_count_before_response": 0, "help_before_response": false, "audio_valid": true, "interruption_invalidated": false, "response_interface": "keyboard", "first_presented_at": learningBounds(stamp(tone)), "prior_exposure": nil, "char_wpm": 20, "eff_wpm": 12, "freq_hz": 600})
		records = append(records, open, close, observation)
		ids = append(ids, observation["id"].(string))
	}
	plan["prompts"] = prompts
	records = append(records, learningFixture("terminal", "end_"+id, map[string]any{"session_id": id, "status": "completed", "ended_at": stamp(start.Add(time.Minute)), "observation_ids": ids}))
	return records
}
func milestoneRows(t *testing.T, db *gorm.DB, user models.User, kind string) []map[string]any {
	t.Helper()
	var rows []models.LearningEvidenceRecord
	if err := db.Where("user_id = ? AND kind = ?", user.ID, kind).Order("revision ASC").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	result := []map[string]any{}
	for _, row := range rows {
		var payload map[string]any
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		result = append(result, payload)
	}
	return result
}
func TestLearningProjectionPostgresMilestonesAndLateExposure(t *testing.T) {
	db, user := sessionStorageDB(t)
	oldKey := configs.App.JWTSecret
	configs.App.JWTSecret = []byte("projection-feed-test")
	t.Cleanup(func() { configs.App.JWTSecret = oldKey })
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	for i, day := range []int{0, 1, 3, 9} {
		records := mixedEvidenceFixture(fmt.Sprint("check", i), base.Add(time.Duration(day)*24*time.Hour))
		response := learningPost(t, db, user, records...)
		if len(response.RejectedRecords) != 0 || len(response.AcknowledgedIDs) != len(records) {
			t.Fatalf("check %d: %+v", i, response)
		}
	}
	claims := milestoneRows(t, db, user, "milestone")
	if len(claims) != 4 {
		t.Fatalf("want K/M proficiency and retention: %+v", claims)
	}
	for _, claim := range claims {
		if claim["scope"] != "available-recorded-history" || claim["source_revision"] == "" {
			t.Fatal("unbounded claim", claim)
		}
	}
	// Identical upload does not repeat either claim or review transitions.
	learningPost(t, db, user, mixedEvidenceFixture("check3", base.Add(9*24*time.Hour))...)
	if len(milestoneRows(t, db, user, "milestone")) != 4 {
		t.Fatal("duplicate milestones")
	}
	// Another device uploads a previously unseen warm exposure just before a cold probe.
	warm := base.Add(9*24*time.Hour - time.Hour)
	open := learningFixture("exposure-open", "late_open", map[string]any{"session_id": nil, "presentation_id": "late_sound", "characters": []string{"K"}, "source": "reference", "started_at": learningBounds(warm.Format(time.RFC3339Nano))})
	if r := learningPost(t, db, user, open); len(r.AcknowledgedIDs) != 1 {
		t.Fatal(r)
	}
	if len(milestoneRows(t, db, user, "milestone-correction")) != 0 {
		t.Fatal("unresolved guard irreversibly revoked a claim")
	}
	close := learningFixture("exposure-close", "late_close", map[string]any{"open_id": "late_open", "end_reason": "completed", "last_exposure": map[string]any{"K": learningBounds(warm.Add(time.Second).Format(time.RFC3339Nano))}})
	if r := learningPost(t, db, user, close); len(r.AcknowledgedIDs) != 1 {
		t.Fatal(r)
	}
	corrections := milestoneRows(t, db, user, "milestone-correction")
	if len(corrections) != 1 || corrections[0]["status"] != "unverified" || corrections[0]["reason"] != "late-evidence-invalidated" {
		t.Fatalf("missing auditable correction: %+v", corrections)
	}
	// A different account's feed cannot expose any of these claims.
	other := sessionStorageUser(t, db)
	response := learningRequest(t, db, other, "GET", "/v1/training/learning-evidence/changes?limit=100", nil)
	var page learningChangesResponse
	if json.Unmarshal(response.Body.Bytes(), &page) != nil || len(page.Changes) != 0 {
		t.Fatal("cross-account claims", response.Body)
	}
	// The normal paged feed includes claims and corrections, with checkpoints.
	cursor := ""
	kinds := map[string]int{}
	for i := 0; i < 10; i++ {
		path := "/v1/training/learning-evidence/changes?limit=100"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		response = learningRequest(t, db, user, "GET", path, nil)
		if response.Code != 200 {
			t.Fatal(response.Code, response.Body)
		}
		if json.Unmarshal(response.Body.Bytes(), &page) != nil {
			t.Fatal(response.Body)
		}
		for _, change := range page.Changes {
			kinds[change.Kind]++
		}
		cursor = page.NextCursor
		if !page.HasMore {
			break
		}
	}
	if kinds["milestone"] != 4 || kinds["milestone-correction"] != 1 {
		t.Fatal("feed omitted server claims", kinds)
	}
}

func TestLearningProjectionPostgresClaimFailureRollsBackInput(t *testing.T) {
	db, user := sessionStorageDB(t)
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	learningPost(t, db, user, mixedEvidenceFixture("first", base)...)
	var before models.LearningEvidenceSyncState
	if err := db.Take(&before, "user_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	hook := "projection-fail-" + user.ID.String()
	if err := db.Callback().Create().Before("gorm:create").Register(hook, func(tx *gorm.DB) {
		if change, ok := tx.Statement.Dest.(*models.LearningEvidenceChange); ok && change.Kind == "milestone" {
			tx.AddError(fmt.Errorf("synthetic milestone change failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Callback().Create().Remove(hook) })
	response := learningRequest(t, db, user, "POST", "/v1/training/learning-evidence/batch", map[string]any{"schema_version": 1, "client_id": user.ID.String(), "records": mixedEvidenceFixture("second", base.Add(24*time.Hour))})
	if response.Code != 500 {
		t.Fatal("projection failure acknowledged input", response.Code, response.Body)
	}
	var after models.LearningEvidenceSyncState
	if err := db.Take(&after, "user_id = ?", user.ID).Error; err != nil || after.LastRevision != before.LastRevision {
		t.Fatal("revision escaped rollback", err, after)
	}
	if len(milestoneRows(t, db, user, "milestone")) != 0 {
		t.Fatal("claim escaped rollback")
	}
	db.Callback().Create().Remove(hook)
	result := learningPost(t, db, user, mixedEvidenceFixture("second", base.Add(24*time.Hour))...)
	if len(result.RejectedRecords) != 0 || len(milestoneRows(t, db, user, "milestone")) != 2 {
		t.Fatal("identical retry failed", result)
	}
}
func TestLearningProjectionPostgresEarlierAttainmentIsAuditable(t *testing.T) {
	db, user := sessionStorageDB(t)
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	for i, day := range []int{10, 11, 0} {
		result := learningPost(t, db, user, mixedEvidenceFixture(fmt.Sprint("earlier", i), base.Add(time.Duration(day)*24*time.Hour))...)
		if len(result.RejectedRecords) != 0 {
			t.Fatal(result)
		}
	}
	if len(milestoneRows(t, db, user, "milestone")) != 4 {
		t.Fatal("earlier attainment not recorded")
	}
	corrections := milestoneRows(t, db, user, "milestone-correction")
	if len(corrections) != 2 {
		t.Fatal("missing supersession", corrections)
	}
	for _, correction := range corrections {
		if correction["status"] != "superseded" || correction["replacement_id"] == nil {
			t.Fatal(correction)
		}
	}
}

func TestLearningProjectionPostgresConcurrentTerminalRetryAwardsOnce(t *testing.T) {
	db, user := sessionStorageDB(t)
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	learningPost(t, db, user, mixedEvidenceFixture("concurrent_first", base)...)
	input := map[string]any{"schema_version": 1, "client_id": user.ID.String(), "records": mixedEvidenceFixture("concurrent_second", base.Add(24*time.Hour))}
	responses := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			responses <- learningRequest(t, db, user, "POST", "/v1/training/learning-evidence/batch", input).Code
		}()
	}
	for i := 0; i < 2; i++ {
		if code := <-responses; code != 200 {
			t.Fatal("concurrent upload failed", code)
		}
	}
	if len(milestoneRows(t, db, user, "milestone")) != 2 {
		t.Fatal("concurrent upload repeated claims")
	}
	var state models.LearningEvidenceSyncState
	if err := db.Take(&state, "user_id = ?", user.ID).Error; err != nil || state.LastRevision != 126 {
		t.Fatal("retry advanced watermark", state.LastRevision, err)
	}
}
