package databases

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"gorm.io/gorm"
)

type migrationProbe struct {
	failAt     int
	calls      int
	err        error
	models     []interface{}
	statements []string
}

func (p *migrationProbe) failure() error {
	p.calls++
	if p.calls == p.failAt {
		return p.err
	}
	return nil
}

func (p *migrationProbe) AutoMigrate(models ...interface{}) error {
	p.models = models
	return p.failure()
}

func (p *migrationProbe) Exec(statement string, _ ...interface{}) *gorm.DB {
	p.statements = append(p.statements, statement)
	return &gorm.DB{Error: p.failure()}
}

func TestMigrateStopsAtEveryRequiredFailure(t *testing.T) {
	for _, tc := range []struct {
		name   string
		failAt int
		stage  string
	}{
		{"models", 1, "migrate database"},
		{"legacy email constraint", 2, "migrate user email indexes"},
		{"legacy email index", 3, "migrate user email indexes"},
		{"email lookup index", 4, "migrate user email indexes"},
		{"verified email uniqueness", 5, "migrate user email indexes"},
		{"forum index", 6, "migrate forum indexes"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cause := errors.New("injected schema failure")
			probe := &migrationProbe{failAt: tc.failAt, err: cause}
			err := migrate(probe)
			if !errors.Is(err, cause) || !strings.HasPrefix(err.Error(), tc.stage+":") {
				t.Fatalf("expected %s wrapping cause, got %v", tc.stage, err)
			}
			if probe.calls != tc.failAt {
				t.Fatalf("continued after failure: %d calls, want %d", probe.calls, tc.failAt)
			}
		})
	}
}

func TestMigrateRequiresAllCurrentModelsAndIndexes(t *testing.T) {
	probe := &migrationProbe{}
	if err := migrate(probe); err != nil {
		t.Fatal(err)
	}
	var models []string
	for _, model := range probe.models {
		models = append(models, reflect.TypeOf(model).Elem().Name())
	}
	want := []string{"User", "EmailOTP", "RefreshToken", "CWSettings", "PageSettings", "Progress", "ForumThread", "ForumReply", "TrainingEvent", "TrainingProfile"}
	if !reflect.DeepEqual(models, want) {
		t.Fatalf("models = %v, want %v", models, want)
	}
	if len(probe.statements) != 5 {
		t.Fatalf("required index statements = %d, want 5", len(probe.statements))
	}
	if !strings.Contains(probe.statements[3], "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_email") ||
		!strings.Contains(probe.statements[3], "email_verified = true AND deleted_at IS NULL") {
		t.Fatal("verified email uniqueness must be established before serving requests")
	}
	if !strings.Contains(probe.statements[4], "idx_forum_threads_created_at_id") {
		t.Fatal("forum index must be established before serving requests")
	}
}
