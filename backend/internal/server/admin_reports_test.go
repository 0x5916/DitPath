package server

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"morsewell/internal/configs"
	"morsewell/internal/models"
	"morsewell/internal/utils"
)

// Keep all fixtures in one rolled-back transaction so this site-wide report
// observes stable historical dates independently of other test accounts.
func TestOwnerReportsReconcile(t *testing.T) {
	db := authHTTPDB(t).Begin()
	t.Cleanup(func() { db.Rollback() })
	start := time.Date(2003, 3, 1, 16, 0, 0, 0, time.UTC) // Singapore midnight, March 2
	createUser := func(at time.Time) models.User {
		id := uuid.NewString()
		user := models.User{Base: models.Base{CreatedAt: at}, Username: id, Email: id + "@example.invalid", Password: "test"}
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		return user
	}
	owner := createUser(start.Add(-48 * time.Hour))
	learner := createUser(start)
	second := createUser(start.Add(time.Hour))
	old := configs.App.AdminUserID
	configs.App.AdminUserID = owner.ID
	t.Cleanup(func() { configs.App.AdminUserID = old })
	router := authHTTPRouter(t, db, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now)
	token, err := utils.GenerateAccessToken(owner.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body string, result any) {
		t.Helper()
		res := authHTTPSend(router, authHTTPRequest{method: method, path: path, body: body, token: token})
		if res.Code != 200 || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d %s", path, res.Code, res.Body.String())
		}
		if err := json.Unmarshal(res.Body.Bytes(), result); err != nil {
			t.Fatal(err)
		}
	}
	native := func(user models.User, mode, status string, at time.Time) {
		end := at
		begin := end.Add(-time.Minute)
		row := models.TrainingSession{UserID: user.ID, SessionID: uuid.NewString(), SourceKind: "native", Mode: &mode, Status: status, OccurredAt: at, StartedAt: &begin, EndedAt: &end, EventIDs: []string{}, PayloadHash: []byte("test"), ReceivedAt: time.Now()}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	native(learner, "practice", "completed", start)
	native(learner, "guided", "completed", start.Add(24*time.Hour))
	native(learner, "guided", "abandoned", start.Add(time.Second))
	native(second, "guided", "completed", start.Add(-time.Microsecond))
	native(second, "guided", "completed", start.Add(7*24*time.Hour))
	for _, mirror := range []bool{true, false} {
		p := models.Progress{UserID: second.ID, Lesson: 1, ClientCreatedAt: &start}
		if err := db.Create(&p).Error; err != nil {
			t.Fatal(err)
		}
		if mirror {
			row := models.TrainingSession{UserID: second.ID, SessionID: "legacy:" + p.ID.String(), SourceKind: "legacy_v1", SourceRecordID: &p.ID, Status: "completed", OccurredAt: start, EventIDs: []string{}, PayloadHash: []byte("test"), ReceivedAt: time.Now()}
			if err := db.Create(&row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	const window = "days=7&until=2003-03-09"
	var overview struct {
		Current, Previous map[string]int
		Daily             []map[string]any
	}
	request("GET", "/v1/admin/reports/overview?"+window, "", &overview)
	want := map[string]int{"joined": 2, "learners": 2, "sessions": 4, "guided": 1, "practice": 1, "legacy": 2, "measured": 2, "duration_ms": 120000}
	for k, v := range want {
		if overview.Current[k] != v {
			t.Fatalf("current %s: got %v want %d", k, overview.Current, v)
		}
	}
	if overview.Previous["sessions"] != 1 || len(overview.Daily) != 7 || overview.Daily[0]["learners"] != float64(2) || overview.Daily[6]["sessions"] != float64(0) {
		t.Fatal(overview)
	}
	for metric, count := range map[string]int{"joined": 2, "learners": 2, "sessions": 2, "duration_ms": 1} {
		var list struct {
			Data []struct {
				ID         uuid.UUID
				Sessions   int
				DurationMS int `json:"duration_ms"`
			}
		}
		request("POST", "/v1/admin/users/search", fmt.Sprintf(`{"days":7,"until":"2003-03-09","metric":%q}`, metric), &list)
		if len(list.Data) != count {
			t.Fatalf("%s: %v", metric, list)
		}
		if metric == "sessions" && list.Data[0].Sessions+list.Data[1].Sessions != 4 {
			t.Fatal(list)
		}
		if metric == "duration_ms" && (list.Data[0].ID != learner.ID || list.Data[0].DurationMS != 120000) {
			t.Fatal(list)
		}
	}
	var detail struct {
		Totals          map[string]int
		Account         struct{ ID uuid.UUID }
		LastCompletedAt *time.Time `json:"last_completed_at"`
		Sessions        []struct {
			ID           uuid.UUID
			Kind, Status string
			DurationMS   *int `json:"duration_ms"`
		}
		Next *string `json:"next_cursor"`
	}
	learnerPath := "/v1/admin/users/" + learner.ID.String() + "/report?" + window
	request("GET", learnerPath, "", &detail)
	if detail.Account.ID != learner.ID || detail.Totals["sessions"] != 2 || detail.Totals["duration_ms"] != 120000 || len(detail.Sessions) != 3 || detail.Sessions[1].Status != "abandoned" || (detail.Sessions[1].DurationMS == nil || *detail.Sessions[1].DurationMS != 60000) {
		t.Fatal(detail)
	}
	request("GET", "/v1/admin/users/"+second.ID.String()+"/report?"+window, "", &detail)
	if detail.LastCompletedAt == nil || !detail.LastCompletedAt.Equal(start.AddDate(0, 0, 7)) || len(detail.Sessions) != 2 || detail.Totals["legacy"] != 2 || detail.Totals["measured"] != 0 || detail.Sessions[0].DurationMS != nil {
		t.Fatal(detail)
	}
	for range 26 {
		native(learner, "guided", "completed", start)
	}
	request("GET", learnerPath, "", &detail)
	if len(detail.Sessions) != 25 || detail.Next == nil {
		t.Fatal(detail)
	}
	seen := map[uuid.UUID]bool{}
	for _, s := range detail.Sessions {
		seen[s.ID] = true
	}
	request("GET", learnerPath+"&cursor="+*detail.Next, "", &detail)
	if len(detail.Sessions) != 4 || detail.Next != nil || detail.Totals["sessions"] != 28 {
		t.Fatal(detail)
	}
	for _, s := range detail.Sessions {
		if seen[s.ID] {
			t.Fatal("duplicate session", s.ID)
		}
	}
	var count int64
	if err := db.Model(&models.TrainingSyncState{}).Where("user_id IN ?", []uuid.UUID{learner.ID, second.ID}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("report created sync state: %v, %d", err, count)
	}
}
