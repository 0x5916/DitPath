package databases

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"opencw/internal/models"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This explicit opt-in uses a disposable database, never application settings.
func TestHistoryMigrationPreservesData(t *testing.T) {
	dsn := os.Getenv("OPENCW_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("set OPENCW_TEST_DATABASE_DSN to a disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	// Keep the opt-in disposable-database bootstrap above, but exercise the old
	// schema upgrade in a private namespace without altering shared test tables.
	schemaName := "ditpath_history_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quotedSchema := `"` + schemaName + `"`
	if err := db.Exec("CREATE SCHEMA " + quotedSchema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Exec("DROP SCHEMA " + quotedSchema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
	})
	err = db.Connection(func(tx *gorm.DB) (result error) {
		// Connection pins the SQL connection but reuses its statement unless each
		// operation starts a fresh session; keep model/error state isolated too.
		tx = tx.Session(&gorm.Session{NewDB: true})
		if err := tx.Exec("SET search_path TO " + quotedSchema).Error; err != nil {
			return err
		}
		defer func() {
			if err := tx.Exec("RESET search_path").Error; result == nil {
				result = err
			}
		}()
		if err := tx.AutoMigrate(&models.User{}, &models.Progress{}, &models.TrainingProfile{}); err != nil {
			return err
		}
		// This is the pre-history training_events table: neither new column nor
		// the account/session index exists when the existing rows are written.
		oldStatements := []string{
			`CREATE TABLE training_events (
				id uuid PRIMARY KEY, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz,
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				event_id text NOT NULL, session_id text NOT NULL, prompt_id text NOT NULL,
				prompt_kind text NOT NULL, target_character text NOT NULL, entered_text text NOT NULL,
				is_correct boolean NOT NULL, classification text NOT NULL,
				latency_ms bigint NOT NULL, replay_count bigint NOT NULL, input_mode text NOT NULL,
				char_wpm bigint NOT NULL, eff_wpm bigint NOT NULL, freq_hz bigint NOT NULL,
				client_created_at timestamptz NOT NULL
			)`,
			`CREATE UNIQUE INDEX idx_training_events_user_event ON training_events (user_id, event_id)`,
			`CREATE INDEX idx_training_events_user_created ON training_events (user_id, client_created_at)`,
		}
		for _, statement := range oldStatements {
			if err := tx.Exec(statement).Error; err != nil {
				return err
			}
		}
		if tx.Migrator().HasColumn(&models.TrainingEvent{}, "PayloadHash") || tx.Migrator().HasColumn(&models.TrainingEvent{}, "SyncRevision") || tx.Migrator().HasIndex(&models.TrainingEvent{}, "idx_training_events_user_session") {
			return fmt.Errorf("old event fixture unexpectedly contains history columns or index")
		}
		clientTime := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
		base := func() models.Base {
			return models.Base{CreatedAt: clientTime.Add(time.Hour), UpdatedAt: clientTime.Add(time.Hour)}
		}
		user := models.User{Base: base(), Username: "history-migration-" + uuid.NewString(), Email: uuid.NewString() + "@example.invalid", Password: "unused"}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		progress := models.Progress{Base: base(), UserID: user.ID, Lesson: 70, CharWPM: 20, EffWPM: 12, Accuracy: .75, ClientCreatedAt: &clientTime}
		profile := models.TrainingProfile{Base: base(), UserID: user.ID, SuggestedStep: 7, UnlockedStep: 5, LastActiveAt: &clientTime}
		event := models.TrainingEvent{Base: base(), UserID: user.ID, EventID: "migration-event", SessionID: "orphan", PromptID: "prompt", PromptKind: "recall", TargetCharacter: "K", EnteredText: "K", IsCorrect: true, Classification: "developing", LatencyMS: 1500, ReplayCount: 2, InputMode: "grid", CharWPM: 20, EffWPM: 12, FreqHz: 600, ClientCreatedAt: clientTime}
		for _, record := range []any{&progress, &profile} {
			if err := tx.Create(record).Error; err != nil {
				return err
			}
		}
		if err := tx.Omit("PayloadHash", "SyncRevision").Create(&event).Error; err != nil {
			return err
		}
		var keptUser models.User
		var keptProgress models.Progress
		var keptProfile models.TrainingProfile
		var keptEvent models.TrainingEvent
		comparisons := []struct {
			before, after any
			id            uuid.UUID
		}{{&user, &keptUser, user.ID}, {&progress, &keptProgress, progress.ID}, {&profile, &keptProfile, profile.ID}, {&event, &keptEvent, event.ID}}
		// Capture the old database's representation, including its timezone,
		// instead of comparing client UTC formatting with equivalent DB offsets.
		for _, pair := range comparisons {
			if err := tx.Take(pair.before, "id = ?", pair.id).Error; err != nil {
				return err
			}
		}
		for run := 0; run < 2; run++ {
			if err := migrate(tx); err != nil {
				return fmt.Errorf("migration run %d: %w", run+1, err)
			}
		}
		for _, pair := range comparisons {
			if err := tx.Take(pair.after, "id = ?", pair.id).Error; err != nil {
				return err
			}
			before, err := json.Marshal(pair.before)
			if err != nil {
				return err
			}
			after, err := json.Marshal(pair.after)
			if err != nil {
				return err
			}
			if !bytes.Equal(before, after) {
				return fmt.Errorf("migration changed %T: before=%s after=%s", pair.before, before, after)
			}
		}
		if keptEvent.SyncRevision != 0 || keptEvent.PayloadHash != nil {
			return fmt.Errorf("existing event must remain pending backfill without a fabricated hash")
		}
		for _, model := range []any{&models.TrainingSession{}, &models.TrainingSyncState{}, &models.TrainingChange{}} {
			if !tx.Migrator().HasTable(model) {
				return fmt.Errorf("migration did not create %T", model)
			}
		}
		for _, name := range []string{"idx_training_sessions_legacy_source", "idx_training_sessions_history", "idx_training_sessions_filter", "idx_training_sessions_user_session", "idx_training_events_user_session", "idx_training_changes_user_kind_record"} {
			var count int64
			if err := tx.Raw("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = ? AND indexname = ?", schemaName, name).Scan(&count).Error; err != nil {
				return err
			}
			if count != 1 {
				return fmt.Errorf("migration did not create private index %s", name)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
