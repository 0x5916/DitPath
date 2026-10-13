package models

import (
	"github.com/google/uuid"
)

type PageSettings struct {
	Base
	UserID    uuid.UUID `gorm:"type:uuid;uniqueIndex;not null"`
	User      *User     `gorm:"constraint:OnDelete:CASCADE;"`
	Lang      string    `gorm:"not null"`
	CurLesson int       `gorm:"not null"`
}

func (PageSettings) TableName() string {
	return "page_settings"
}

func GetDefaultPageSettings() PageSettings {
	return PageSettings{
		Lang: "auto",
	}
}
