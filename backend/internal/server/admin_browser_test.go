package server

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"opencw/internal/configs"
	"opencw/internal/models"
	"opencw/internal/utils"
)

// Opt in after building the static frontend with PUBLIC_API_BASE=/v1.
func TestOwnerDashboardBrowser(t *testing.T) {
	if os.Getenv("MORSEWELL_TEST_ADMIN_BROWSER") != "1" {
		t.Skip("enable MORSEWELL_TEST_ADMIN_BROWSER with a same-origin frontend build")
	}
	db := authHTTPDB(t)
	owner, learner := authHTTPUser(t, db, true), authHTTPUser(t, db, true)
	old := configs.App.AdminUserID
	configs.App.AdminUserID = owner.ID
	t.Cleanup(func() { configs.App.AdminUserID = old })
	pass := uuid.NewString()
	work := utils.DefaultPasswordWork()
	reservation, err := work.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	hash, err := reservation.Hash(pass)
	reservation.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&models.User{}).Where("id IN ?", []uuid.UUID{owner.ID, learner.ID}).Update("password", hash).Error; err != nil {
		t.Fatal(err)
	}
	end := time.Now().UTC().Add(-48 * time.Hour)
	start := end.Add(-4 * time.Minute)
	mode := "practice"
	score := 0.875
	wpm := 20
	row := models.TrainingSession{UserID: learner.ID, SessionID: uuid.NewString(), SourceKind: "native", Mode: &mode, Status: "completed", Lesson: 2, OccurredAt: end, StartedAt: &start, EndedAt: &end, Accuracy: &score, CharWPM: &wpm, EffWPM: &wpm, EventIDs: []string{}, PayloadHash: []byte("fixture"), ReceivedAt: time.Now()}
	if err = db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	api := authHTTPRouter(t, db, work, authHTTPPolicy(), time.Now)
	frontend := filepath.Join("..", "..", "..", "frontend")
	build := os.DirFS(filepath.Join(frontend, "build"))
	if _, err = fs.Stat(build, "en/admin.html"); err != nil {
		t.Fatal("build the frontend with PUBLIC_API_BASE=/v1 before running browser acceptance")
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/", api)
	assets := http.FileServerFS(build)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/") + ".html"
		if fs.ValidPath(name) {
			if _, err := fs.Stat(build, name); err == nil {
				http.ServeFileFS(w, r, build, name)
				return
			}
		}
		assets.ServeHTTP(w, r)
	})
	site := httptest.NewServer(mux)
	defer site.Close()
	cmd := exec.CommandContext(t.Context(), "node", "e2e/owner-dashboard.ts")
	cmd.Dir = frontend
	fixture, _ := json.Marshal(map[string]string{"base": site.URL, "owner": owner.Username, "learner": learner.Username, "password": pass, "id": learner.ID.String()})
	cmd.Stdin = bytes.NewReader(fixture)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser acceptance: %s: %v", output, err)
	}
	t.Log(string(output))
}
