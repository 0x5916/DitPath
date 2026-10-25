package common

import (
	"time"

	"github.com/google/uuid"
)

type ProgressResponse struct {
	Lesson          string     `json:"lesson"`
	CharWPM         int        `json:"char_wpm"`
	EffWPM          int        `json:"eff_wpm"`
	Accuracy        float64    `json:"accuracy"`
	CreatedAt       time.Time  `json:"created_at"`
	ClientCreatedAt *time.Time `json:"client_created_at"`
}

type CWSettingsResponse struct {
	CharWPM    int       `json:"char_wpm"`
	EffWPM     int       `json:"eff_wpm"`
	Freq       int       `json:"freq"`
	StartDelay float64   `json:"start_delay"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type PageSettingsResponse struct {
	Lang      string    `json:"language"`
	CurLesson int       `json:"cur_lesson"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AuthTokenPairResponse struct {
	RefreshToken string `json:"refresh_token"`
	AccessToken  string `json:"access_token"`
}

type UserInfoResponse struct {
	CallSign        *string   `json:"call_sign"`
	Username        string    `json:"username"`
	Email           string    `json:"email"`
	EmailVerified   bool      `json:"email_verified"`
	PasswordEnabled bool      `json:"password_enabled"`
	CreatedAt       time.Time `json:"created_at"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

// ── V2 Training API (see backend/docs/training-events-v2.md) ──

// TrainingRejectedEvent describes a single event that failed per-event
// validation inside an otherwise accepted batch.
type TrainingRejectedEvent struct {
	ID        string `json:"id"`
	ErrorCode string `json:"error_code"`
	Message   string `json:"message"`
}

type TrainingEventBatchResponse struct {
	AcknowledgedIDs []string                `json:"acknowledged_ids"`
	RejectedEvents  []TrainingRejectedEvent `json:"rejected_events"`
}

type TrainingCharacterMasteryResponse struct {
	Character       string  `json:"character"`
	Status          string  `json:"status"`
	RollingAccuracy float64 `json:"rolling_accuracy"`
	MedianLatencyMS *int    `json:"median_latency_ms"`
	TotalAttempts   int     `json:"total_attempts"`
}

type TrainingSnapshotResponse struct {
	SuggestedStep      int                                `json:"suggested_step"`
	UnlockedStep       int                                `json:"unlocked_step"`
	LastActiveAt       *time.Time                         `json:"last_active_at"`
	CharacterMasteries []TrainingCharacterMasteryResponse `json:"character_masteries"`
}

type TrainingSettingsUpdateResponse struct {
	UpdatedAt time.Time `json:"updated_at"`
}

type ErrorResponse struct {
	Code  string `json:"code"`
	Error string `json:"error"`
}

type ForumAuthorResponse struct {
	Username string  `json:"username"`
	CallSign *string `json:"call_sign"`
}

type ForumThreadSummaryResponse struct {
	ID         uuid.UUID            `json:"id"`
	Category   string               `json:"category"`
	Title      string               `json:"title"`
	Author     *ForumAuthorResponse `json:"author"`
	ReplyCount int64                `json:"reply_count"`
	CreatedAt  time.Time            `json:"created_at"`
}

type ForumThreadResponse struct {
	ID         uuid.UUID            `json:"id"`
	Category   string               `json:"category"`
	Title      string               `json:"title"`
	Body       string               `json:"body"`
	Author     *ForumAuthorResponse `json:"author"`
	ReplyCount int64                `json:"reply_count"`
	CreatedAt  time.Time            `json:"created_at"`
	UpdatedAt  time.Time            `json:"updated_at"`
}

type ForumThreadListResponse struct {
	Data       []ForumThreadSummaryResponse `json:"data"`
	Total      int64                        `json:"total"`
	Limit      int                          `json:"limit"`
	NextCursor *string                      `json:"next_cursor"`
}

// ForumReplyResponse represents a reply. Reply pages are flat; deleted rows
// expose null body and author. Children remains [] for wire compatibility.
// ParentContext provides optional bounded parent context.
type ForumReplyResponse struct {
	ID            uuid.UUID            `json:"id"`
	ParentID      *uuid.UUID           `json:"parent_id"`
	Body          *string              `json:"body"`
	Author        *ForumAuthorResponse `json:"author"`
	IsDeleted     bool                 `json:"is_deleted"`
	CreatedAt     time.Time            `json:"created_at"`
	Children      []ForumReplyResponse `json:"children"`
	ParentContext *ForumParentContext  `json:"parent_context,omitempty"`
}

type ForumReplyListResponse struct {
	Data       []ForumReplyResponse `json:"data"`
	Total      int64                `json:"total"`
	TotalRows  int64                `json:"total_rows"`
	Limit      int                  `json:"limit"`
	NextCursor *string              `json:"next_cursor"`
}

// ProgressDayResponse is a complete UTC-day count for a requested calendar year.
type ProgressDayResponse struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

// ForumParentContext provides bounded context even when the parent is on an
// earlier page. Deleted parents expose neither their body nor author.
type ForumParentContext struct {
	Author    *ForumAuthorResponse `json:"author"`
	Body      *string              `json:"body"`
	IsDeleted bool                 `json:"is_deleted"`
}
