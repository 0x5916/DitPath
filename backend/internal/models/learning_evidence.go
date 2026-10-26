package models

import (
	"encoding/json"
	"github.com/google/uuid"
	"time"
)

// LearningEvidenceRecord is separate from legacy training attempts and history.
// SemanticKey prevents a second first response or terminal under a different ID.
type LearningEvidenceRecord struct {
	UserID         uuid.UUID       `gorm:"type:uuid;primaryKey;uniqueIndex:idx_learning_semantic,priority:1;uniqueIndex:idx_learning_presentation,priority:1;index:idx_learning_session,priority:1;index:idx_learning_profile,priority:1"`
	User           *User           `gorm:"constraint:OnDelete:CASCADE;"`
	RecordID       string          `gorm:"primaryKey"`
	Kind           string          `gorm:"not null;index:idx_learning_session,priority:2;index:idx_learning_profile,priority:2"`
	SessionID      string          `gorm:"index:idx_learning_session,priority:3"`
	ProfileID      string          `gorm:"index:idx_learning_profile,priority:3"`
	PresentationID *string         `gorm:"uniqueIndex:idx_learning_presentation,priority:2"`
	SemanticKey    string          `gorm:"not null;uniqueIndex:idx_learning_semantic,priority:2"`
	PolicyVersion  string          `gorm:"not null"`
	Payload        json.RawMessage `gorm:"type:jsonb;serializer:json;not null"`
	PayloadHash    []byte          `gorm:"type:bytea;not null"`
	ClientID       uuid.UUID       `gorm:"type:uuid;not null"`
	ReceivedAt     time.Time       `gorm:"not null"`
	Revision       int64           `gorm:"not null"`
}

func (LearningEvidenceRecord) TableName() string { return "learning_evidence_records" }

type LearningEvidenceSyncState struct {
	UserID       uuid.UUID `gorm:"type:uuid;primaryKey"`
	User         *User     `gorm:"constraint:OnDelete:CASCADE;"`
	LastRevision int64     `gorm:"not null;default:0"`
	FeedEpoch    int       `gorm:"not null;default:1"`
}

func (LearningEvidenceSyncState) TableName() string { return "learning_evidence_sync_state" }

type LearningEvidenceChange struct {
	UserID   uuid.UUID       `gorm:"type:uuid;primaryKey"`
	User     *User           `gorm:"constraint:OnDelete:CASCADE;"`
	Revision int64           `gorm:"primaryKey;autoIncrement:false"`
	Kind     string          `gorm:"not null"`
	RecordID string          `gorm:"not null"`
	Payload  json.RawMessage `gorm:"type:jsonb;serializer:json;not null"`
}

func (LearningEvidenceChange) TableName() string { return "learning_evidence_changes" }
