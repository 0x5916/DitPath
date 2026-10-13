package models

import (
	"github.com/google/uuid"
)

// ForumThread is a top-level forum post. Only users with a verified email
// address can create threads; reading the forum is public.
type ForumThread struct {
	Base
	UserID   uuid.UUID `gorm:"type:uuid;index;not null"`
	User     *User     `gorm:"constraint:OnDelete:CASCADE;"`
	Category string    `gorm:"index;not null"`
	Title    string    `gorm:"not null"`
	Body     string    `gorm:"type:text;not null"`
}

func (ForumThread) TableName() string {
	return "forum_threads"
}

// ForumReply is a reply within a thread. ParentID is optional and points to
// another reply in the same thread, allowing nested discussions.
type ForumReply struct {
	Base
	ThreadID uuid.UUID    `gorm:"type:uuid;index;not null"`
	Thread   *ForumThread `gorm:"constraint:OnDelete:CASCADE;"`
	UserID   uuid.UUID    `gorm:"type:uuid;index;not null"`
	User     *User        `gorm:"constraint:OnDelete:CASCADE;"`
	ParentID *uuid.UUID   `gorm:"type:uuid;index"`
	Parent   *ForumReply  `gorm:"foreignKey:ParentID;constraint:OnDelete:SET NULL;"`
	Body     string       `gorm:"type:text;not null"`
}

func (ForumReply) TableName() string {
	return "forum_replies"
}
