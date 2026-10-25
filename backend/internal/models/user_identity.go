package models

import "github.com/google/uuid"

// UserIdentity keeps external sign-in credentials separate from account ownership.
// Deleted identities retain their issuer/subject reservation.
type UserIdentity struct {
	Base
	UserID   uuid.UUID `gorm:"type:uuid;not null;index;uniqueIndex:idx_user_identities_active_provider,where:deleted_at IS NULL"`
	Provider string    `gorm:"not null;check:chk_user_identity_provider,octet_length(provider) BETWEEN 1 AND 32 AND octet_length(provider) = char_length(provider);uniqueIndex:idx_user_identities_active_provider,where:deleted_at IS NULL"`
	Issuer   string    `gorm:"not null;check:chk_user_identity_issuer,octet_length(issuer) BETWEEN 1 AND 2048;uniqueIndex:idx_user_identities_issuer_subject"`
	Subject  string    `gorm:"not null;check:chk_user_identity_subject,octet_length(subject) BETWEEN 1 AND 255;uniqueIndex:idx_user_identities_issuer_subject"`
	User     User      `gorm:"foreignKey:UserID;references:ID;constraint:OnDelete:CASCADE;"`
}
