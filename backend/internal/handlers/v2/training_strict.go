package handlers

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/training"

	"github.com/google/uuid"
)

func containsUserID(raw json.RawMessage) bool {
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	for key := range fields {
		if strings.EqualFold(key, "user_id") {
			return true
		}
	}
	return false
}

func trainingEventModel(item validatedTrainingEvent, userID uuid.UUID) models.TrainingEvent {
	return models.TrainingEvent{
		UserID: userID, EventID: item.input.ID, SessionID: item.input.SessionID,
		PromptID: item.input.PromptID, PromptKind: item.input.PromptKind,
		TargetCharacter: strings.TrimSpace(item.input.TargetCharacter), EnteredText: strings.TrimSpace(item.input.EnteredText),
		IsCorrect: *item.input.IsCorrect, Classification: item.input.Classification,
		LatencyMS: *item.input.LatencyMS, ReplayCount: *item.input.ReplayCount, InputMode: item.input.InputMode,
		CharWPM: *item.input.CharWPM, EffWPM: *item.input.EffWPM, FreqHz: *item.input.FreqHz,
		ClientCreatedAt: item.createdAt.Truncate(time.Microsecond),
	}
}

func sameTrainingEvent(first, second models.TrainingEvent) bool {
	left, _ := json.Marshal(training.AttemptRecord(first))
	right, _ := json.Marshal(training.AttemptRecord(second))
	return bytes.Equal(left, right)
}

// Resolve all repeated IDs before writing anything, so conflicting repetitions
// cannot leave a first occurrence stored or acknowledged in a strict batch.
func validateStrictTrainingEvents(rawEvents []json.RawMessage) ([]validatedTrainingEvent, []common.TrainingRejectedEvent) {
	order := []string{}
	seen := map[string]bool{}
	valid := map[string]validatedTrainingEvent{}
	rejections := map[string]common.TrainingRejectedEvent{}
	for _, raw := range rawEvents {
		item, rejection := parseAndValidateTrainingEvent(raw)
		var partial struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(raw, &partial)
		id := partial.ID
		if !seen[id] {
			order = append(order, id)
			seen[id] = true
		}
		if rejection == nil && (containsUserID(raw) || len(item.input.ID) > 128 || strings.HasPrefix(item.input.ID, "legacy:") || strings.HasPrefix(item.input.SessionID, "legacy:") || *item.input.EffWPM > *item.input.CharWPM) {
			rejection = rejectEvent(id, common.RejectCodeInvalidField, "user_id and legacy: IDs are reserved; eff_wpm must not exceed char_wpm")
		}
		if rejection != nil {
			rejections[id] = *rejection
			continue
		}
		if previous, exists := valid[id]; exists {
			if !sameTrainingEvent(trainingEventModel(previous, uuid.Nil), trainingEventModel(*item, uuid.Nil)) {
				rejections[id] = *rejectEvent(id, common.RejectCodeIDConflict, "Conflicting repeated event ID")
			}
			continue
		}
		valid[id] = *item
	}
	accepted := make([]validatedTrainingEvent, 0, len(valid))
	rejected := []common.TrainingRejectedEvent{}
	for _, id := range order {
		if rejection, exists := rejections[id]; exists {
			rejected = append(rejected, rejection)
		} else if item, exists := valid[id]; exists {
			accepted = append(accepted, item)
		}
	}
	return accepted, rejected
}
