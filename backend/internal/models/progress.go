package models

import (
	"time"

	"github.com/google/uuid"
)

type Progress struct {
	Base
	UserID          uuid.UUID  `gorm:"type:uuid;index;not null"`
	User            *User      `gorm:"constraint:OnDelete:CASCADE;"`
	Lesson          int        `gorm:"not null"`
	CharWPM         int        `gorm:"not null"`
	EffWPM          int        `gorm:"not null"`
	Accuracy        float64    `gorm:"not null"`
	ClientCreatedAt *time.Time `gorm:"index"`
}

func (Progress) TableName() string {
	return "lesson_progress"
}
