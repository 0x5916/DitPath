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
	CallSign      *string   `json:"call_sign"`
	Username      string    `json:"username"`
	Email         string    `json:"email"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
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

type HttpErrorResponse struct {
	Status int
	Code   string
	Err    string
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

// ForumReplyResponse is one node of the nested reply tree. Soft-deleted replies
// with visible descendants are returned as tombstones: is_deleted=true with
// null body/author.
type ForumReplyResponse struct {
	ID        uuid.UUID            `json:"id"`
	ParentID  *uuid.UUID           `json:"parent_id"`
	Body      *string              `json:"body"`
	Author    *ForumAuthorResponse `json:"author"`
	IsDeleted bool                 `json:"is_deleted"`
	CreatedAt time.Time            `json:"created_at"`
	Children  []ForumReplyResponse `json:"children"`
}

type ForumReplyListResponse struct {
	Data  []ForumReplyResponse `json:"data"`
	Total int64                `json:"total"`
}
