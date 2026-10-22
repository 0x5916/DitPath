package handlers

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"opencw/internal/common"
)

// validatedTrainingEvent is a batch event that passed per-event validation.
type validatedTrainingEvent struct {
	input     common.TrainingEventInput
	createdAt time.Time
}

// validateTrainingEvents validates raw batch members individually so a single
// malformed event cannot poison valid siblings.
func validateTrainingEvents(rawEvents []json.RawMessage) ([]validatedTrainingEvent, []common.TrainingRejectedEvent) {
	valid := make([]validatedTrainingEvent, 0, len(rawEvents))
	rejected := make([]common.TrainingRejectedEvent, 0)

	for _, raw := range rawEvents {
		event, rejection := parseAndValidateTrainingEvent(raw)
		if rejection != nil {
			rejected = append(rejected, *rejection)
			continue
		}
		valid = append(valid, *event)
	}

	return valid, rejected
}

func parseAndValidateTrainingEvent(raw json.RawMessage) (*validatedTrainingEvent, *common.TrainingRejectedEvent) {
	var input common.TrainingEventInput
	if err := json.Unmarshal(raw, &input); err != nil {
		var partial struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(raw, &partial)
		return nil, rejectEvent(partial.ID, common.RejectCodeInvalidField, "event must be a JSON object")
	}

	if rejection := validateTrainingEventInput(&input); rejection != nil {
		return nil, rejection
	}

	createdAt, _ := time.Parse(time.RFC3339, strings.TrimSpace(*input.CreatedAt))
	return &validatedTrainingEvent{input: input, createdAt: createdAt.UTC()}, nil
}

func rejectEvent(id, code, message string) *common.TrainingRejectedEvent {
	return &common.TrainingRejectedEvent{ID: id, ErrorCode: code, Message: message}
}

func validateTrainingEventInput(in *common.TrainingEventInput) *common.TrainingRejectedEvent {
	id := strings.TrimSpace(in.ID)
	// Keep the existing length rules: trimmed event ID, raw session and prompt IDs.
	for _, field := range []struct {
		name, value string
	}{
		{"id", id},
		{"session_id", in.SessionID},
		{"prompt_id", in.PromptID},
	} {
		if strings.TrimSpace(field.value) == "" {
			return rejectEvent(id, common.RejectCodeMissingField, field.name+" is required")
		}
		if len(field.value) > 128 {
			return rejectEvent(id, common.RejectCodeInvalidField, field.name+" exceeds 128 characters")
		}
	}

	switch in.PromptKind {
	case "introduction", "unscored-match", "recall", "contrast", "short-group":
	default:
		return rejectEvent(id, common.RejectCodeInvalidPromptKind,
			"prompt_kind must be one of introduction, unscored-match, recall, contrast, short-group")
	}

	target := strings.TrimSpace(in.TargetCharacter)
	if target == "" {
		return rejectEvent(id, common.RejectCodeMissingField, "target_character is required")
	}
	if utf8.RuneCountInString(target) > 8 {
		return rejectEvent(id, common.RejectCodeInvalidField, "target_character exceeds 8 characters")
	}

	switch in.Classification {
	case "automatic", "developing", "incorrect", "missing", "unmeasured":
	default:
		return rejectEvent(id, common.RejectCodeInvalidClassification,
			"classification must be one of automatic, developing, incorrect, missing, unmeasured")
	}

	switch in.InputMode {
	case "keyboard", "grid", "touch":
	default:
		return rejectEvent(id, common.RejectCodeInvalidInputMode, "input_mode must be one of keyboard, grid, touch")
	}

	if utf8.RuneCountInString(strings.TrimSpace(in.EnteredText)) > 64 {
		return rejectEvent(id, common.RejectCodeInvalidField, "entered_text exceeds 64 characters")
	}

	if in.IsCorrect == nil {
		return rejectEvent(id, common.RejectCodeMissingField, "is_correct is required")
	}

	if in.LatencyMS == nil {
		return rejectEvent(id, common.RejectCodeMissingField, "latency_ms is required")
	}
	if *in.LatencyMS < 0 {
		return rejectEvent(id, common.RejectCodeInvalidTiming, "latency_ms cannot be negative")
	}
	if *in.LatencyMS > 600000 {
		return rejectEvent(id, common.RejectCodeInvalidTiming, "latency_ms exceeds the maximum of 600000")
	}

	for _, field := range []struct {
		name     string
		value    *int
		min, max int
	}{
		{"replay_count", in.ReplayCount, 0, 1000},
		{"char_wpm", in.CharWPM, 5, 50},
		{"eff_wpm", in.EffWPM, 5, 50},
		{"freq_hz", in.FreqHz, 300, 2000},
	} {
		if field.value == nil {
			return rejectEvent(id, common.RejectCodeMissingField, field.name+" is required")
		}
		if *field.value < field.min || *field.value > field.max {
			return rejectEvent(id, common.RejectCodeInvalidField,
				fmt.Sprintf("%s must be between %d and %d", field.name, field.min, field.max))
		}
	}

	if in.CreatedAt == nil {
		return rejectEvent(id, common.RejectCodeMissingField, "created_at is required")
	}
	if _, err := time.Parse(time.RFC3339, strings.TrimSpace(*in.CreatedAt)); err != nil {
		return rejectEvent(id, common.RejectCodeInvalidField, "created_at must be an ISO 8601 timestamp")
	}

	// Cross-field consistency keeps downstream aggregates trustworthy.
	entered := strings.TrimSpace(in.EnteredText)
	switch in.Classification {
	case "missing":
		if entered != "" || *in.IsCorrect {
			return rejectEvent(id, common.RejectCodeInvalidClassification,
				"missing answers must have empty entered_text and is_correct=false")
		}
	case "automatic", "developing":
		if !*in.IsCorrect {
			return rejectEvent(id, common.RejectCodeInvalidClassification,
				"automatic and developing classifications require is_correct=true")
		}
	case "incorrect":
		if *in.IsCorrect {
			return rejectEvent(id, common.RejectCodeInvalidClassification,
				"incorrect classifications require is_correct=false")
		}
	}

	return nil
}
