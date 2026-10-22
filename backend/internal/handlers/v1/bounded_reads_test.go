package handlers

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"net/url"
	"opencw/internal/common"
	"opencw/internal/models"
	"strings"
	"testing"
	"time"
)

func boundedReadRequest(handler gin.HandlerFunc, user models.User, threadID uuid.UUID, query string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/bounded?"+query, nil)
	ctx.Set("user", &user)
	ctx.Params = gin.Params{{Key: "id", Value: threadID.String()}}
	handler(ctx)
	return recorder
}
func TestForumRepliesBoundedPagesAndParentPrivacy(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	thread := models.ForumThread{UserID: user.ID, Category: "general", Title: "bounded", Body: "body"}
	if err := db.Create(&thread).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	replies := make([]models.ForumReply, 250)
	for i := range replies {
		id := uuid.MustParse(fmt.Sprintf("00000000-0000-7000-8000-%012x", i+1))
		replies[i] = models.ForumReply{Base: models.Base{ID: id, CreatedAt: now}, ThreadID: thread.ID, UserID: user.ID, Body: strings.Repeat("語", 200)}
		if i > 0 {
			replies[i].ParentID = &replies[0].ID
		}
	}
	replies[200].ParentID = &replies[1].ID
	if err := db.Create(&replies).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&replies[0]).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&replies[249]).Error; err != nil {
		t.Fatal(err)
	}
	handler := ForumHandler{DB: db}
	cursor := ""
	seen := map[uuid.UUID]bool{}
	for pageIndex, want := range []int{100, 100, 50} {
		query := ""
		if cursor != "" {
			query = "cursor=" + url.QueryEscape(cursor)
		}
		response := boundedReadRequest(handler.GetThreadReplies, user, thread.ID, query)
		if response.Code != 200 {
			t.Fatalf("page %d status=%d: %s", pageIndex, response.Code, response.Body.String())
		}
		var page common.ForumReplyListResponse
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if len(page.Data) != want || page.Total != 248 || page.TotalRows != 250 || page.Limit != 100 {
			t.Fatalf("page counts: %+v", page)
		}
		for i, reply := range page.Data {
			if reply.ID != replies[pageIndex*100+i].ID || seen[reply.ID] || len(reply.Children) != 0 {
				t.Fatal("unstable, duplicated, or recursive page")
			}
			seen[reply.ID] = true
			if reply.IsDeleted && (reply.Body != nil || reply.Author != nil) {
				t.Fatal("deleted content exposed")
			}
			if reply.ParentID != nil {
				if reply.ParentContext == nil {
					t.Fatal("parent context missing")
				}
				if *reply.ParentID == replies[0].ID && (!reply.ParentContext.IsDeleted || reply.ParentContext.Body != nil || reply.ParentContext.Author != nil) {
					t.Fatal("deleted parent exposed")
				}
				if *reply.ParentID == replies[1].ID && (reply.ParentContext.Body == nil || len([]rune(*reply.ParentContext.Body)) != 160 || reply.ParentContext.Author == nil) {
					t.Fatal("live parent context missing or unbounded")
				}
			}
		}
		if pageIndex < 2 {
			if page.NextCursor == nil {
				t.Fatal("missing cursor")
			}
			cursor = *page.NextCursor
		} else if page.NextCursor != nil {
			t.Fatal("unexpected final cursor")
		}
	}
	for _, query := range []string{"limit=101", "cursor=malformed"} {
		if response := boundedReadRequest(handler.GetThreadReplies, user, thread.ID, query); response.Code != 400 {
			t.Fatalf("invalid query status=%d", response.Code)
		}
	}
}
func TestProgressBoundedPagesAndCompleteYearSummary(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	records := make([]models.Progress, 250)
	for i := range records {
		created := time.Date(2024, 2, 29, 12, 0, 0, 0, time.UTC)
		if i >= 120 {
			created = time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
		}
		records[i] = models.Progress{UserID: user.ID, Lesson: i + 1, CharWPM: 20, EffWPM: 10, Accuracy: 0.9, Base: models.Base{CreatedAt: created}}
	}
	if err := db.Create(&records).Error; err != nil {
		t.Fatal(err)
	}
	other := postgresTestUser(t, db, "")
	if err := db.Create(&models.Progress{UserID: other.ID, Lesson: 1, CharWPM: 20, EffWPM: 10, Accuracy: 1}).Error; err != nil {
		t.Fatal(err)
	}
	handler := ProgressHandler{DB: db}
	cursor := ""
	seen := map[string]bool{}
	for pageIndex, want := range []int{100, 100, 50} {
		query := ""
		if cursor != "" {
			query = "cursor=" + url.QueryEscape(cursor)
		}
		response := boundedReadRequest(handler.GetAllProgress, user, uuid.Nil, query)
		if response.Code != 200 {
			t.Fatalf("page %d: %s", pageIndex, response.Body.String())
		}
		var page struct {
			Data       []common.ProgressResponse
			Limit      int
			NextCursor *string `json:"next_cursor"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if len(page.Data) != want || page.Limit != 100 {
			t.Fatal("unbounded page")
		}
		for _, record := range page.Data {
			if seen[record.Lesson] {
				t.Fatal("duplicate record across tied timestamps")
			}
			seen[record.Lesson] = true
		}
		if pageIndex < 2 {
			if page.NextCursor == nil {
				t.Fatal("missing cursor")
			}
			cursor = *page.NextCursor
		} else if page.NextCursor != nil {
			t.Fatal("unexpected final cursor")
		}
	}
	response := boundedReadRequest(handler.GetAllProgress, user, uuid.Nil, "year=2024")
	var summary struct {
		Days   []common.ProgressDayResponse
		Recent []common.ProgressResponse
	}
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if len(summary.Days) != 1 || summary.Days[0].Date != "2024-02-29" || summary.Days[0].Count != 120 || len(summary.Recent) != 20 {
		t.Fatalf("incomplete or unbounded summary: %+v", summary)
	}
	for _, record := range summary.Recent {
		if record.CreatedAt.Year() != 2025 {
			t.Fatal("recent records incorrectly filtered to selected year")
		}
	}
	for _, query := range []string{"year=0", "year=10000", "year=no", "year=2024&year=2025", "year=2024&limit=1", "limit=101", "cursor=bad"} {
		if response := boundedReadRequest(handler.GetAllProgress, user, uuid.Nil, query); response.Code != 400 {
			t.Fatalf("invalid %s status=%d", query, response.Code)
		}
	}
}
