package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TrainingSession stores immutable terminal history. Nullable measurements retain
// unknown legacy values rather than inventing timing, settings, or attempt counts.
type TrainingSession struct {
	ID                  uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID              uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_training_sessions_user_session,priority:1"`
	User                *User     `gorm:"constraint:OnDelete:CASCADE;"`
	SessionID           string    `gorm:"not null;uniqueIndex:idx_training_sessions_user_session,priority:2"`
	SchemaVersion       int16     `gorm:"not null"`
	Mode                *string
	SourceKind          string     `gorm:"not null"`
	SourceRecordID      *uuid.UUID `gorm:"type:uuid"`
	ClientID            *uuid.UUID `gorm:"type:uuid"`
	CurriculumVersion   string     `gorm:"not null"`
	Lesson              int        `gorm:"not null"`
	Status              string     `gorm:"not null"`
	CharWPM             *int
	EffWPM              *int
	FreqHz              *int
	StartedAt           *time.Time
	EndedAt             *time.Time
	OccurredAt          time.Time `gorm:"not null"`
	OccurredAtSource    string    `gorm:"not null"`
	PromptCount         *int
	AttemptCount        *int
	EventIDs            []string `gorm:"type:jsonb;serializer:json;not null"`
	ScoredAttemptCount  *int
	CorrectAttemptCount *int
	Accuracy            *float64
	ScoringVersion      string    `gorm:"not null"`
	PayloadHash         []byte    `gorm:"type:bytea;not null"`
	SyncRevision        int64     `gorm:"not null"`
	ReceivedAt          time.Time `gorm:"not null"`
}

func (TrainingSession) TableName() string { return "training_sessions" }

func (s *TrainingSession) BeforeCreate(_ *gorm.DB) error {
	if s.ID == uuid.Nil {
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		s.ID = id
	}
	return nil
}

// TrainingSyncState serializes an account's writers and tracks committed history.
type TrainingSyncState struct {
	UserID           uuid.UUID `gorm:"type:uuid;primaryKey"`
	User             *User     `gorm:"constraint:OnDelete:CASCADE;"`
	LastRevision     int64     `gorm:"not null;default:0"`
	FeedEpoch        int       `gorm:"not null;default:1"`
	BackfillComplete bool      `gorm:"not null;default:false"`
}

func (TrainingSyncState) TableName() string { return "training_sync_state" }

// TrainingChange is an immutable account revision; payloads retain the record
// returned for that committed revision independently of later read pagination.
type TrainingChange struct {
	UserID   uuid.UUID       `gorm:"type:uuid;primaryKey;uniqueIndex:idx_training_changes_user_kind_record,priority:1"`
	User     *User           `gorm:"constraint:OnDelete:CASCADE;"`
	Revision int64           `gorm:"primaryKey;autoIncrement:false"`
	Kind     string          `gorm:"not null;uniqueIndex:idx_training_changes_user_kind_record,priority:2"`
	RecordID string          `gorm:"not null;uniqueIndex:idx_training_changes_user_kind_record,priority:3"`
	Payload  json.RawMessage `gorm:"type:jsonb;serializer:json;not null"`
}

func (TrainingChange) TableName() string { return "training_changes" }
