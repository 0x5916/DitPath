package models

import (
	"time"

	"github.com/google/uuid"
)

type RefreshToken struct {
	Base
	UserID    uuid.UUID `gorm:"type:uuid;index;not null"`
	User      *User     `gorm:"constraint:OnDelete:CASCADE;"`
	Token     string    `gorm:"uniqueIndex;not null"`
	ExpiresAt time.Time `gorm:"not null"`
	Revoked   bool      `gorm:"default:false;not null"`
}

func (RefreshToken) TableName() string {
	return "refresh_tokens"
}
