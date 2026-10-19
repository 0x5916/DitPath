package training

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"opencw/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LockHistoryAccount must be called inside a transaction by every history writer.
// The row lock serializes event insertion, terminal manifests and legacy mirrors.
func LockHistoryAccount(tx *gorm.DB, userID uuid.UUID) (*models.TrainingSyncState, error) {
	state := models.TrainingSyncState{UserID: userID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&state).Error; err != nil {
		return nil, err
	}
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&state, "user_id = ?", userID).Error
	return &state, err
}

// AppendHistoryChange allocates a revision only for a newly inserted record.
// Both the record and this immutable payload must commit in the same transaction.
func AppendHistoryChange(tx *gorm.DB, state *models.TrainingSyncState, kind, id string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	state.LastRevision++
	change := models.TrainingChange{UserID: state.UserID, Revision: state.LastRevision, Kind: kind, RecordID: id, Payload: raw}
	if err := tx.Create(&change).Error; err != nil {
		return err
	}
	return tx.Model(state).Update("last_revision", state.LastRevision).Error
}

// EnsureSessionHistory performs bounded, resumable bootstrap work while holding
// the account lock. Readers must wait for BackfillComplete before serving pages.
func EnsureSessionHistory(tx *gorm.DB, userID uuid.UUID) (*models.TrainingSyncState, error) {
	state, err := LockHistoryAccount(tx, userID)
	if err != nil || state.BackfillComplete {
		return state, err
	}
	const batchSize = 100
	var events []models.TrainingEvent
	if err := tx.Where("user_id = ? AND sync_revision = 0", userID).Order("id").Limit(batchSize).Find(&events).Error; err != nil {
		return nil, err
	}
	for i := range events {
		event := &events[i]
		if err := RecordAttemptChange(tx, state, event); err != nil {
			return nil, err
		}
	}
	if len(events) > 0 {
		latest := events[0].ClientCreatedAt
		for _, event := range events[1:] {
			if event.ClientCreatedAt.After(latest) {
				latest = event.ClientCreatedAt
			}
		}
		if err := TouchHistoryProfile(tx, userID, latest); err != nil {
			return nil, err
		}
	}
	var legacy []models.Progress
	if err := tx.Where("user_id = ? AND NOT EXISTS (SELECT 1 FROM training_sessions s WHERE s.user_id = lesson_progress.user_id AND s.source_kind = 'legacy_v1' AND s.source_record_id = lesson_progress.id)", userID).
		Order("id").Limit(batchSize).Find(&legacy).Error; err != nil {
		return nil, err
	}
	for _, progress := range legacy {
		if err := MirrorLegacyProgress(tx, state, progress); err != nil {
			return nil, err
		}
	}
	if len(events) < batchSize && len(legacy) < batchSize {
		state.BackfillComplete = true
		if err := tx.Model(state).Update("backfill_complete", true).Error; err != nil {
			return nil, err
		}
	}
	return state, nil
}

func RecordAttemptChange(tx *gorm.DB, state *models.TrainingSyncState, event *models.TrainingEvent) error {
	payload := AttemptRecord(*event)
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(raw)
	event.PayloadHash = hash[:]
	event.SyncRevision = state.LastRevision + 1
	if err := tx.Model(event).Updates(map[string]any{"payload_hash": event.PayloadHash, "sync_revision": event.SyncRevision}).Error; err != nil {
		return err
	}
	return AppendHistoryChange(tx, state, "attempt", event.EventID, payload)
}

// AttemptRecord is the normalized immutable event representation used for both
// strict retry comparison and change downloads. Server metadata is excluded.
func AttemptRecord(event models.TrainingEvent) map[string]any {
	return map[string]any{
		"id": event.EventID, "session_id": event.SessionID, "prompt_id": event.PromptID,
		"prompt_kind": event.PromptKind, "target_character": event.TargetCharacter, "entered_text": event.EnteredText,
		"is_correct": event.IsCorrect, "classification": event.Classification, "latency_ms": event.LatencyMS,
		"replay_count": event.ReplayCount, "input_mode": event.InputMode, "char_wpm": event.CharWPM,
		"eff_wpm": event.EffWPM, "freq_hz": event.FreqHz, "created_at": event.ClientCreatedAt.UTC(),
	}
}

// MirrorLegacyProgress preserves unknown mode, timing and counts. Native history
// is never copied back into lesson_progress or counted twice by the legacy API.
func MirrorLegacyProgress(tx *gorm.DB, state *models.TrainingSyncState, progress models.Progress) error {
	occurred, source := progress.CreatedAt, "legacy_server_receipt"
	if progress.ClientCreatedAt != nil {
		occurred, source = *progress.ClientCreatedAt, "legacy_client_completion"
	}
	session := models.TrainingSession{
		UserID: progress.UserID, SessionID: "legacy:" + progress.ID.String(), SchemaVersion: 1,
		SourceKind: "legacy_v1", SourceRecordID: &progress.ID, Status: "completed", Lesson: progress.Lesson,
		CharWPM: &progress.CharWPM, EffWPM: &progress.EffWPM, Accuracy: &progress.Accuracy,
		EndedAt: progress.ClientCreatedAt, OccurredAt: occurred, OccurredAtSource: source,
		EventIDs: []string{}, ScoringVersion: "legacy-summary", ReceivedAt: progress.CreatedAt,
		SyncRevision: state.LastRevision + 1,
	}
	raw, err := json.Marshal(SessionRecord(session))
	if err != nil {
		return err
	}
	hash := sha256.Sum256(raw)
	session.PayloadHash = hash[:]
	if err := tx.Create(&session).Error; err != nil {
		return err
	}
	if err := AppendHistoryChange(tx, state, "session", session.SessionID, SessionRecord(session)); err != nil {
		return err
	}
	return TouchHistoryProfile(tx, state.UserID, occurred)
}

func SessionRecord(s models.TrainingSession) map[string]any {
	return map[string]any{
		"id": s.ID, "session_id": s.SessionID, "schema_version": s.SchemaVersion, "mode": s.Mode,
		"source_kind": s.SourceKind, "source_record_id": s.SourceRecordID, "client_id": s.ClientID,
		"curriculum_version": s.CurriculumVersion, "lesson": s.Lesson, "status": s.Status,
		"char_wpm": s.CharWPM, "eff_wpm": s.EffWPM, "freq_hz": s.FreqHz,
		"started_at": s.StartedAt, "ended_at": s.EndedAt, "occurred_at": s.OccurredAt,
		"occurred_at_source": s.OccurredAtSource, "prompt_count": s.PromptCount, "attempt_count": s.AttemptCount,
		"event_ids": s.EventIDs, "scored_attempt_count": s.ScoredAttemptCount, "correct_attempt_count": s.CorrectAttemptCount,
		"accuracy": s.Accuracy, "scoring_version": s.ScoringVersion, "sync_revision": strconv.FormatInt(s.SyncRevision, 10), "received_at": s.ReceivedAt,
	}
}

// TouchHistoryProfile only advances activity; course position keeps its existing
// page-settings seed and is never unlocked by practice or session completion.
func TouchHistoryProfile(tx *gorm.DB, userID uuid.UUID, active time.Time) error {
	var page models.PageSettings
	seed := 1
	err := tx.Take(&page, "user_id = ?", userID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if page.CurLesson > seed {
		seed = page.CurLesson
	}
	profile := models.TrainingProfile{UserID: userID, SuggestedStep: seed, UnlockedStep: seed, LastActiveAt: &active}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&profile).Error; err != nil {
		return err
	}
	return tx.Model(&models.TrainingProfile{}).Where("user_id = ? AND (last_active_at IS NULL OR last_active_at < ?)", userID, active).Update("last_active_at", active).Error
}
