package common

import (
	"encoding/json"
	"time"

	"opencw/internal/models"

	"github.com/google/uuid"
)

type RegisterInput struct {
	Username string `json:"username" binding:"required,username"`
	Email    string `json:"email"    binding:"required,email,max=254"`
	Password string `json:"password" binding:"required,min=8,max=256"`
}

type LoginInput struct {
	Identifier string `json:"identifier" binding:"required"`
	Password   string `json:"password"   binding:"required"`
}

type RefreshInput struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type VerifyEmailInput struct {
	Code string `json:"code" binding:"required,len=6,numeric"`
}

type UpdateCallSignInput struct {
	CallSign string `json:"call_sign" binding:"required,max=254"`
}

type UpdateEmailInput struct {
	Email string `json:"email" binding:"required,email,max=254"`
}

type UpdatePasswordInput struct {
	OldPassword string `json:"old_password" binding:"required,min=8,max=256"`
	NewPassword string `json:"new_password" binding:"required,min=8,max=256"`
}

type CWSettingsInput struct {
	CharWPM    int      `json:"char_wpm"    binding:"required,min=5,max=50"`
	EffWPM     int      `json:"eff_wpm"     binding:"required,min=5,max=50"`
	Freq       int      `json:"freq"        binding:"required,min=300,max=2000"`
	StartDelay *float64 `json:"start_delay" binding:"required,min=0.0,max=10.0"`
}

func FromCwSettingsModel(obj models.CWSettings) CWSettingsInput {
	return CWSettingsInput{
		CharWPM:    obj.CharWPM,
		EffWPM:     obj.EffWPM,
		Freq:       obj.Freq,
		StartDelay: &obj.StartDelay,
	}
}

type PageSettingsInput struct {
	Lang      string `json:"language"   binding:"required"`
	CurLesson int    `json:"cur_lesson" binding:"required"`
}

func FromPageSettingsModel(obj models.PageSettings) PageSettingsInput {
	return PageSettingsInput{
		Lang:      obj.Lang,
		CurLesson: obj.CurLesson,
	}
}

type ProgressInput struct {
	Lesson          int        `json:"lesson"            binding:"required"`
	CharWPM         int        `json:"char_wpm"          binding:"required,min=5,max=50"`
	EffWPM          int        `json:"eff_wpm"           binding:"required,min=5,max=50"`
	Accuracy        *float64   `json:"accuracy"          binding:"required,min=0.0,max=1.0"`
	ClientCreatedAt *time.Time `json:"client_created_at"`
}

// Forum categories are a fixed set: general, help, showcase, feedback.
type CreateThreadInput struct {
	Category string `json:"category" binding:"required,oneof=general help showcase feedback"`
	Title    string `json:"title"    binding:"required,min=3,max=200"`
	Body     string `json:"body"     binding:"required,min=1,max=10000"`
}

// CreateReplyInput's ParentID, when set, must reference a live reply in the
// same thread, allowing nested replies.
type CreateReplyInput struct {
	Body     string     `json:"body"      binding:"required,min=1,max=10000"`
	ParentID *uuid.UUID `json:"parent_id"`
}

// ListThreadsQuery is bound from query parameters of GET /v1/forum/threads.
type ListThreadsQuery struct {
	Category string `form:"category" binding:"omitempty,oneof=general help showcase feedback"`
	Limit    int    `form:"limit"    binding:"omitempty,min=1,max=100"`
	Cursor   string `form:"cursor"`
}

// ── V2 Training API (see backend/docs/training-events-v2.md) ──

const (
	// TrainingV2SchemaVersion is the only accepted events payload schema version.
	TrainingV2SchemaVersion = 1
	// TrainingV2MaxBatchEvents bounds the number of events per upload batch.
	TrainingV2MaxBatchEvents = 100
	// TrainingV2MaxPayloadBytes bounds the total request body size of a batch.
	TrainingV2MaxPayloadBytes = 256 * 1024
)

// TrainingEventBatchInput is the POST /v2/training/events/batch request body.
// Events are bound as raw JSON so a single malformed event can be rejected
// individually without poisoning valid siblings (partial acceptance).
// SchemaVersion is validated by the handler so unsupported versions receive a
// dedicated error code.
type TrainingEventBatchInput struct {
	SchemaVersion int               `json:"schema_version"`
	ClientID      string            `json:"client_id"`
	ClientSentAt  *string           `json:"client_sent_at"`
	Events        []json.RawMessage `json:"events"`
}

// TrainingEventInput is a single attempt event inside a batch. Numeric and
// boolean fields are pointers so a missing field is distinguishable from a
// zero value during per-event validation.
type TrainingEventInput struct {
	ID              string  `json:"id"`
	SessionID       string  `json:"session_id"`
	PromptID        string  `json:"prompt_id"`
	PromptKind      string  `json:"prompt_kind"`
	TargetCharacter string  `json:"target_character"`
	EnteredText     string  `json:"entered_text"`
	IsCorrect       *bool   `json:"is_correct"`
	Classification  string  `json:"classification"`
	LatencyMS       *int    `json:"latency_ms"`
	ReplayCount     *int    `json:"replay_count"`
	InputMode       string  `json:"input_mode"`
	CharWPM         *int    `json:"char_wpm"`
	EffWPM          *int    `json:"eff_wpm"`
	FreqHz          *int    `json:"freq_hz"`
	CreatedAt       *string `json:"created_at"`
}

// TrainingSettingsInput is the PUT /v2/training/settings request body.
type TrainingSettingsInput struct {
	CharWPM            *int     `json:"char_wpm"             binding:"required,min=5,max=50"`
	EffWPM             *int     `json:"eff_wpm"              binding:"required,min=5,max=50"`
	Freq               *int     `json:"freq"                 binding:"required,min=300,max=2000"`
	StartDelay         *float64 `json:"start_delay"          binding:"required,min=0.0,max=10.0"`
	TargetDailyMinutes *int     `json:"target_daily_minutes" binding:"required,min=1,max=240"`
}
