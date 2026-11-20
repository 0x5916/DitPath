package handlers

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"morsewell/internal/common"
	"morsewell/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TestResetProgressIsAccountScopedAndFencesOldDevices(t *testing.T) {
	db := postgresTestDB(t)
	user, other := postgresTestUser(t, db, ""), postgresTestUser(t, db, "")
	h := ProgressHandler{DB: db}
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user", &user) })
	router.DELETE("/user/progress", h.Reset)
	router.PUT("/cw/progress", h.AddProgress)
	router.POST("/settings/page", SettingsHandler{DB: db}.UpdatePageSettings)
	request := func(method, path, epoch, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if epoch != "" {
			r.Header.Set(common.TrainingEpochHeader, epoch)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s returned %d: %s", method, path, w.Code, w.Body.String())
		}
		return w
	}
	const progress = `{"lesson":3,"char_wpm":20,"eff_wpm":12,"accuracy":0.9}`
	request("PUT", "/cw/progress", "", progress, 201)
	request("POST", "/settings/page", "", `{"language":"de","cur_lesson":7}`, 200)
	sound := models.GetDefaultCWSettings()
	sound.UserID, sound.Freq = user.ID, 750
	for _, row := range []any{&sound, &models.Progress{UserID: other.ID, Lesson: 9},
		&models.TrainingEvent{UserID: user.ID, EventID: "before-reset"},
		&models.LearningEvidenceRecord{UserID: user.ID, RecordID: "plan", SemanticKey: "key", Payload: []byte("{}"), PayloadHash: []byte{0}},
		&models.LearningEvidenceChange{UserID: user.ID, Revision: 1, Payload: []byte("{}")}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Callback().Update().Before("gorm:update").Register("test:reset-rollback", func(tx *gorm.DB) {
		if tx.Statement.Table == "learning_evidence_sync_state" {
			tx.AddError(errors.New("interrupt the final reset update"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	request("DELETE", "/user/progress", "1", "", 500)
	if err := db.Callback().Update().Remove("test:reset-rollback"); err != nil {
		t.Fatal(err)
	}
	var retained models.TrainingEvent
	if err := db.Take(&retained, "user_id=? AND event_id=?", user.ID, "before-reset").Error; err != nil {
		t.Fatal("partial reset erased an event", err)
	}
	w := request("DELETE", "/user/progress", "1", "", 204)
	if w.Header().Get(common.TrainingEpochHeader) != "2" {
		t.Fatal("missing new generation")
	}
	for _, model := range []any{&models.Progress{}, &models.TrainingEvent{}, &models.TrainingSession{}, &models.TrainingProfile{}, &models.TrainingChange{}, &models.LearningEvidenceRecord{}, &models.LearningEvidenceChange{}} {
		var count int64
		if err := db.Unscoped().Model(model).Where("user_id=?", user.ID).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("%T not cleared: count %d, %v", model, count, err)
		}
	}
	var page models.PageSettings
	if err := db.Take(&page, "user_id=?", user.ID).Error; err != nil || page.Lang != "de" || page.CurLesson != 1 {
		t.Fatalf("page settings %#v: %v", page, err)
	}
	var kept models.CWSettings
	if err := db.Take(&kept, "user_id=?", user.ID).Error; err != nil || kept.Freq != 750 {
		t.Fatalf("sound settings %#v: %v", kept, err)
	}
	var survivor models.Progress
	if err := db.Take(&survivor, "user_id=?", other.ID).Error; err != nil || survivor.Lesson != 9 {
		t.Fatal("neighbor's progress changed", err)
	}
	request("PUT", "/cw/progress", "", progress, http.StatusConflict)
	request("POST", "/settings/page", "1", `{"language":"ja","cur_lesson":7}`, http.StatusConflict)
	request("PUT", "/cw/progress", "2", progress, http.StatusCreated)
	request("DELETE", "/user/progress", "1", "", http.StatusConflict)
	var count int64
	if err := db.Model(&models.Progress{}).Where("user_id=?", user.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("stale reset lost new progress", count, err)
	}
}
