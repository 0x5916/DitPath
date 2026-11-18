package models

import (
	"time"

	"github.com/google/uuid"
)

// Each new consent has a distinct generation and a separate unsubscribe secret.
// Revoking consent deletes this row; outstanding messages keep their reviewed generation.
type EmailConsent struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_email_consent_topic"`
	User      *User     `gorm:"constraint:OnDelete:CASCADE"`
	Topic     string    `gorm:"not null;uniqueIndex:idx_email_consent_topic"`
	Email     string    `gorm:"not null"`
	Token     uuid.UUID `gorm:"type:uuid;uniqueIndex;not null"`
	CreatedAt time.Time
}

type OwnerMessage struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	OwnerID        uuid.UUID `gorm:"type:uuid;not null;index" json:"-"`
	Topic          string    `json:"topic"`
	Subject        string    `json:"subject"`
	Body           string    `json:"body"`
	Sender         string    `json:"from"`
	ReplyTo        string    `json:"reply_to"`
	Footer         string    `json:"footer"`
	UnsubscribeURL string    `json:"-"`
	CreatedAt      time.Time `json:"created_at"`
}

type OwnerRecipient struct {
	MessageID    uuid.UUID     `gorm:"type:uuid;primaryKey" json:"-"`
	Message      *OwnerMessage `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	UserID       uuid.UUID     `gorm:"type:uuid;primaryKey" json:"id"`
	ConsentID    uuid.UUID     `gorm:"type:uuid" json:"-"`
	Username     string        `json:"username"`
	Email        string        `json:"email"`
	Status       string        `gorm:"index:idx_owner_mail_due" json:"status"`
	Reason       string        `json:"reason"`
	NextAttempt  time.Time     `gorm:"index:idx_owner_mail_due" json:"-"`
	FirstAttempt *time.Time    `json:"-"`
	Attempts     int           `json:"-"`
	ProviderID   string        `json:"-"`
}
