package models

type User struct {
	Base
	CallSign      *string       `gorm:"uniqueIndex"`
	Username      string        `gorm:"uniqueIndex;not null"`
	Email         string        `gorm:"index:idx_users_email;uniqueIndex:idx_users_verified_email,where:email_verified = true AND deleted_at IS NULL;not null"`
	EmailVerified bool          `gorm:"default:false;not null"`
	Password      string        `gorm:"not null"`
	CWSettings    *CWSettings   `gorm:"foreignKey:UserID;references:ID;constraint:OnDelete:CASCADE;"`
	PageSettings  *PageSettings `gorm:"foreignKey:UserID;references:ID;constraint:OnDelete:CASCADE;"`
}

func (User) TableName() string {
	return "users"
}
