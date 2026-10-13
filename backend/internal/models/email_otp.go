package models

import (
	"time"

	"github.com/google/uuid"
)

type EmailOTP struct {
	Base
	UserID    *uuid.UUID `gorm:"type:uuid;index"` // nullable: OTP before user exists
	Email     string     `gorm:"not null;index"`
	Code      string     `gorm:"not null"`
	ExpiredAt time.Time  `gorm:"not null"`
	Verified  bool       `gorm:"default:false;not null"`
}

func (EmailOTP) TableName() string {
	return "email_otp"
}
