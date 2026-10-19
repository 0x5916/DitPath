package databases

import (
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"

	"opencw/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
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
		{"legacy training identity", 7, "migrate training indexes"},
		{"training history index", 8, "migrate training indexes"},
		{"training filter index", 9, "migrate training indexes"},
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
	want := []string{"User", "EmailOTP", "RefreshToken", "CWSettings", "PageSettings", "Progress", "ForumThread", "ForumReply", "TrainingEvent", "TrainingProfile", "TrainingSession", "TrainingSyncState", "TrainingChange"}
	if !reflect.DeepEqual(models, want) {
		t.Fatalf("models = %v, want %v", models, want)
	}
	if len(probe.statements) != 8 {
		t.Fatalf("required index statements = %d, want 8", len(probe.statements))
	}
	if !strings.Contains(probe.statements[3], "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_email") ||
		!strings.Contains(probe.statements[3], "email_verified = true AND deleted_at IS NULL") {
		t.Fatal("verified email uniqueness must be established before serving requests")
	}
	if !strings.Contains(probe.statements[4], "idx_forum_threads_created_at_id") {
		t.Fatal("forum index must be established before serving requests")
	}
	for i, name := range []string{"idx_training_sessions_legacy_source", "idx_training_sessions_history", "idx_training_sessions_filter"} {
		if !strings.Contains(probe.statements[i+5], name) {
			t.Fatalf("training index %s must be established before serving requests", name)
		}
	}
}

func TestTrainingHistoryOwnershipConstraints(t *testing.T) {
	for _, model := range []interface{}{&models.TrainingSession{}, &models.TrainingSyncState{}, &models.TrainingChange{}} {
		t.Run(reflect.TypeOf(model).Elem().Name(), func(t *testing.T) {
			parsed, err := schema.Parse(model, &sync.Map{}, schema.NamingStrategy{})
			if err != nil {
				t.Fatal(err)
			}
			user := parsed.Relationships.Relations["User"]
			if user == nil || user.ParseConstraint() == nil || user.ParseConstraint().OnDelete != "CASCADE" {
				t.Fatal("history must be removed when its owning account is deleted")
			}
			if parsed.FieldsByDBName["deleted_at"] != nil {
				t.Fatal("immutable history must not inherit soft-delete filtering")
			}
			if _, ok := model.(*models.TrainingChange); ok {
				if len(parsed.PrimaryFields) != 2 || !parsed.FieldsByName["UserID"].PrimaryKey || !parsed.FieldsByName["Revision"].PrimaryKey || parsed.FieldsByName["Revision"].AutoIncrement {
					t.Fatal("feed revisions must form a composite account/revision identity")
				}
			}
		})
	}
}
