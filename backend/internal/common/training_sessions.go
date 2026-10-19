package common

import (
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	TrainingSessionSchemaVersion   = 1
	TrainingSessionMaxBatch        = 20
	TrainingSessionMaxPayloadBytes = 256 * 1024
)

// Records stay raw until validation so malformed siblings can be rejected alone.
type TrainingSessionBatchInput struct {
	SchemaVersion int               `json:"schema_version"`
	ClientID      string            `json:"client_id"`
	ClientSentAt  *string           `json:"client_sent_at"`
	Sessions      []json.RawMessage `json:"sessions"`
}

type TrainingSessionInput struct {
	SessionID         string   `json:"session_id"`
	Mode              string   `json:"mode"`
	CurriculumVersion string   `json:"curriculum_version"`
	Lesson            *int     `json:"lesson"`
	Status            string   `json:"status"`
	StartedAt         *string  `json:"started_at"`
	EndedAt           *string  `json:"ended_at"`
	CharWPM           *int     `json:"char_wpm"`
	EffWPM            *int     `json:"eff_wpm"`
	FreqHz            *int     `json:"freq_hz"`
	PromptCount       *int     `json:"prompt_count"`
	AttemptCount      *int     `json:"attempt_count"`
	EventIDs          []string `json:"event_ids"`
	Accuracy          *float64 `json:"accuracy"`
	ScoringVersion    string   `json:"scoring_version"`
}

// ValidatedTrainingSession contains semantic client input only. Guided derived
// scores and counts are computed from stored events, never supplied by clients.
type ValidatedTrainingSession struct {
	SessionID         string     `json:"session_id"`
	Mode              string     `json:"mode"`
	CurriculumVersion string     `json:"curriculum_version"`
	Lesson            int        `json:"lesson"`
	Status            string     `json:"status"`
	StartedAt         time.Time  `json:"started_at"`
	EndedAt           *time.Time `json:"ended_at"`
	CharWPM           int        `json:"char_wpm"`
	EffWPM            int        `json:"eff_wpm"`
	FreqHz            int        `json:"freq_hz"`
	PromptCount       int        `json:"prompt_count"`
	AttemptCount      int        `json:"attempt_count"`
	EventIDs          []string   `json:"event_ids"`
	Accuracy          *float64   `json:"accuracy,omitempty"`
	ScoringVersion    string     `json:"scoring_version,omitempty"`
}

type TrainingRejectedSession struct {
	ID        string `json:"id"`
	ErrorCode string `json:"error_code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type TrainingSessionBatchResponse struct {
	AcknowledgedIDs  []string                  `json:"acknowledged_ids"`
	RejectedSessions []TrainingRejectedSession `json:"rejected_sessions"`
}

func SessionIDFromRaw(raw json.RawMessage) string {
	var record struct {
		SessionID string `json:"session_id"`
	}
	_ = json.Unmarshal(raw, &record)
	return record.SessionID
}

func validTrainingSessionID(id string) bool {
	return strings.TrimSpace(id) != "" && len(id) <= 128 && utf8.ValidString(id) &&
		!strings.HasPrefix(id, "legacy:") && !strings.ContainsRune(id, '\x00')
}

func hasSessionField(fields map[string]json.RawMessage, name string) bool {
	for field := range fields {
		if strings.EqualFold(field, name) {
			return true
		}
	}
	return false
}

// ValidateTrainingSession validates one native terminal record, normalizing
// optional values, time zones, database timestamp precision and manifest order.
func ValidateTrainingSession(raw json.RawMessage) (ValidatedTrainingSession, error) {
	var result ValidatedTrainingSession
	var fields map[string]json.RawMessage
	if !utf8.Valid(raw) || json.Unmarshal(raw, &fields) != nil || fields == nil {
		return result, errors.New("session must be a JSON object")
	}
	if hasSessionField(fields, "user_id") {
		return result, errors.New("user_id must not be supplied")
	}
	var input TrainingSessionInput
	if json.Unmarshal(raw, &input) != nil {
		return result, errors.New("invalid session field type")
	}
	if !validTrainingSessionID(input.SessionID) {
		return result, errors.New("session_id must be a nonblank native ID of at most 128 UTF-8 bytes")
	}
	if input.Mode != "guided" && input.Mode != "practice" {
		return result, errors.New("mode must be guided or practice")
	}
	if input.CurriculumVersion != "koch-39-v1" || input.Lesson == nil || *input.Lesson < 1 || *input.Lesson > 39 {
		return result, errors.New("curriculum_version must be koch-39-v1 and lesson must be 1–39")
	}
	if input.Status != "completed" && input.Status != "abandoned" {
		return result, errors.New("status must be completed or abandoned")
	}
	if input.CharWPM == nil || input.EffWPM == nil || input.FreqHz == nil ||
		*input.CharWPM < 5 || *input.CharWPM > 50 || *input.EffWPM < 5 || *input.EffWPM > *input.CharWPM ||
		*input.FreqHz < 300 || *input.FreqHz > 2000 {
		return result, errors.New("invalid session playback settings")
	}
	if input.PromptCount == nil || input.AttemptCount == nil || *input.PromptCount < 1 || *input.PromptCount > 1000 ||
		*input.AttemptCount < 0 || *input.AttemptCount > *input.PromptCount {
		return result, errors.New("prompt_count must be 1–1000 and attempt_count must be 0–prompt_count")
	}
	if input.StartedAt == nil {
		return result, errors.New("started_at is required")
	}
	startedAt, err := time.Parse(time.RFC3339Nano, *input.StartedAt)
	if err != nil || !validTrainingSessionTime(startedAt) {
		return result, errors.New("started_at must be RFC3339 with a UTC year from 1–9999")
	}
	var endedAt *time.Time
	if input.EndedAt != nil {
		parsed, err := time.Parse(time.RFC3339Nano, *input.EndedAt)
		if err != nil || !validTrainingSessionTime(parsed) || parsed.Before(startedAt) {
			return result, errors.New("ended_at must be RFC3339 with a UTC year from 1–9999 and not precede started_at")
		}
		parsed = parsed.UTC().Truncate(time.Microsecond)
		endedAt = &parsed
	} else if input.Status == "completed" {
		return result, errors.New("completed sessions require ended_at")
	}
	manifest := append([]string{}, input.EventIDs...)
	if len(manifest) > 1000 {
		return result, errors.New("event_ids exceeds the 1000 event limit")
	}
	sort.Strings(manifest)
	for i, id := range manifest {
		if !validTrainingSessionID(id) || (i > 0 && manifest[i-1] == id) {
			return result, errors.New("event_ids must contain unique native IDs of at most 128 UTF-8 bytes")
		}
	}
	if input.Mode == "guided" {
		for _, field := range []string{"accuracy", "scoring_version", "scored_attempt_count", "correct_attempt_count"} {
			if hasSessionField(fields, field) {
				return result, errors.New("guided scores and scored counts are server-derived")
			}
		}
		if len(manifest) != *input.AttemptCount {
			return result, errors.New("guided event_ids length must equal attempt_count")
		}
	} else if input.Status != "completed" || *input.PromptCount != 1 || *input.AttemptCount != 1 || len(manifest) != 0 ||
		input.Accuracy == nil || math.IsNaN(*input.Accuracy) || math.IsInf(*input.Accuracy, 0) ||
		*input.Accuracy < 0 || *input.Accuracy > 1 || input.ScoringVersion != "practice-copy-v1" {
		return result, errors.New("practice requires completed status, counts 1/1, no events, accuracy 0–1 and practice-copy-v1 scoring")
	}
	result = ValidatedTrainingSession{
		SessionID: input.SessionID, Mode: input.Mode, CurriculumVersion: input.CurriculumVersion,
		Lesson: *input.Lesson, Status: input.Status, StartedAt: startedAt.UTC().Truncate(time.Microsecond), EndedAt: endedAt,
		CharWPM: *input.CharWPM, EffWPM: *input.EffWPM, FreqHz: *input.FreqHz,
		PromptCount: *input.PromptCount, AttemptCount: *input.AttemptCount, EventIDs: manifest,
		Accuracy: input.Accuracy, ScoringVersion: input.ScoringVersion,
	}
	return result, nil
}

func validTrainingSessionTime(value time.Time) bool {
	year := value.UTC().Year()
	return value.Year() > 0 && year >= 1 && year <= 9999
}

// CanonicalTrainingSession encodes only normalized semantic content for retry
// comparisons. The manifest is a set; envelope diagnostics are intentionally absent.
func CanonicalTrainingSession(session ValidatedTrainingSession) ([]byte, error) {
	session.StartedAt = session.StartedAt.UTC().Truncate(time.Microsecond)
	if session.EndedAt != nil {
		end := session.EndedAt.UTC().Truncate(time.Microsecond)
		session.EndedAt = &end
	}
	session.EventIDs = append([]string{}, session.EventIDs...)
	sort.Strings(session.EventIDs)
	if session.Accuracy != nil && *session.Accuracy == 0 {
		zero := 0.0 // JSON -0 and 0 have the same score.
		session.Accuracy = &zero
	}
	return json.Marshal(session)
}
