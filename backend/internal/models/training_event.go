package models

import (
	"time"

	"github.com/google/uuid"
)

// TrainingEvent is an immutable AttemptEvent record ingested through
// POST /v2/training/events/batch (see backend/docs/training-events-v2.md).
//
// Idempotency contract: the client-generated EventID is unique per user, so a
// re-upload of the same event is acknowledged but never duplicated in storage.
// ClientCreatedAt records the client-side measurement time; Base.CreatedAt
// records server ingestion time.
type TrainingEvent struct {
	Base
	UserID          uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_training_events_user_event,priority:1;index:idx_training_events_user_created,priority:1"`
	User            *User     `gorm:"constraint:OnDelete:CASCADE;"`
	EventID         string    `gorm:"not null;uniqueIndex:idx_training_events_user_event,priority:2"`
	SessionID       string    `gorm:"not null"`
	PromptID        string    `gorm:"not null"`
	PromptKind      string    `gorm:"not null"`
	TargetCharacter string    `gorm:"not null"`
	EnteredText     string    `gorm:"not null"`
	IsCorrect       bool      `gorm:"not null"`
	Classification  string    `gorm:"not null"`
	LatencyMS       int       `gorm:"not null"`
	ReplayCount     int       `gorm:"not null"`
	InputMode       string    `gorm:"not null"`
	CharWPM         int       `gorm:"not null"`
	EffWPM          int       `gorm:"not null"`
	FreqHz          int       `gorm:"not null"`
	ClientCreatedAt time.Time `gorm:"not null;index:idx_training_events_user_created,priority:2"`
}

func (TrainingEvent) TableName() string {
	return "training_events"
}

// TrainingProfile tracks the per-user V2 course position served by
// GET /v2/training/snapshot.
//
// SuggestedStep and UnlockedStep are seeded from the legacy
// page_settings.cur_lesson on first event ingestion (default 1) and are
// otherwise reserved for a future session-sync endpoint. LastActiveAt is
// advanced to the newest ingested event timestamp.
type TrainingProfile struct {
	Base
	UserID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex"`
	User          *User     `gorm:"constraint:OnDelete:CASCADE;"`
	SuggestedStep int       `gorm:"not null;default:1"`
	UnlockedStep  int       `gorm:"not null;default:1"`
	LastActiveAt  *time.Time
}

func (TrainingProfile) TableName() string {
	return "training_profiles"
}
