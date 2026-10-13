package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TrainingHandler serves the V2 training synchronization API:
//
//	POST /v2/training/events/batch
//	GET  /v2/training/snapshot
//	PUT  /v2/training/settings
//
// See backend/docs/training-events-v2.md for the wire contract. The legacy
// /v1/cw/progress endpoint remains active and is not affected.
type TrainingHandler struct {
	DB *gorm.DB
}

// validPromptKinds mirrors the client PromptKind union.
var validPromptKinds = map[string]bool{
	"introduction":   true,
	"unscored-match": true,
	"recall":         true,
	"contrast":       true,
	"short-group":    true,
}

// validClassifications mirrors the client AttemptClassification union.
var validClassifications = map[string]bool{
	"automatic":  true,
	"developing": true,
	"incorrect":  true,
	"missing":    true,
	"unmeasured": true,
}

// validInputModes mirrors the client InputMode union.
var validInputModes = map[string]bool{
	"keyboard": true,
	"grid":     true,
	"touch":    true,
}

// masteryPolicy mirrors the client's DEFAULT_MASTERY_POLICY
// (frontend/src/lib/training/v2/types.ts). Keep both definitions in sync.
var masteryPolicy = struct {
	minAttemptsForStability int
	minSessionsForStability int
	targetAccuracy          float64
	maxAutomaticLatencyMS   int
	reviewIntervalDays      int
	rollingWindowSize       int
}{
	minAttemptsForStability: 12,
	minSessionsForStability: 2,
	targetAccuracy:          0.9,
	maxAutomaticLatencyMS:   1500,
	reviewIntervalDays:      3,
	rollingWindowSize:       20,
}

// validatedTrainingEvent is a batch event that passed per-event validation.
type validatedTrainingEvent struct {
	input     common.TrainingEventInput
	createdAt time.Time
}

// PostEventsBatch ingests a batch of immutable prompt attempt events.
//
// Semantics (see spec section 2.1):
//   - Idempotent by (user_id, event_id): duplicates are acknowledged, not stored twice.
//   - Partial acceptance: individually invalid events are reported in
//     rejected_events while valid siblings are stored (HTTP 200 either way).
func (h TrainingHandler) PostEventsBatch(c *gin.Context) {
	user := utils.MustGetUser(c)

	if c.Request.ContentLength > common.TrainingV2MaxPayloadBytes {
		c.JSON(http.StatusRequestEntityTooLarge, common.NewErrorResponse(
			common.ErrorCodeTrainingPayloadTooLarge, "Payload exceeds the 256 KB batch limit"))
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, common.TrainingV2MaxPayloadBytes)

	var input common.TrainingEventBatchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			c.JSON(http.StatusRequestEntityTooLarge, common.NewErrorResponse(
				common.ErrorCodeTrainingPayloadTooLarge, "Payload exceeds the 256 KB batch limit"))
			return
		}
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(
			common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	if input.SchemaVersion != common.TrainingV2SchemaVersion {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(
			common.ErrorCodeTrainingSchemaVersion, "Unsupported schema_version; expected 1"))
		return
	}
	if len(input.Events) == 0 {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(
			common.ErrorCodeInvalidRequestBody, "events must not be empty"))
		return
	}
	if len(input.Events) > common.TrainingV2MaxBatchEvents {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(
			common.ErrorCodeTrainingBatchTooLarge, "Batch exceeds the 100 event limit"))
		return
	}

	valid, rejected := validateTrainingEvents(input.Events)

	if len(valid) > 0 {
		events := make([]models.TrainingEvent, 0, len(valid))
		latestClientTime := time.Time{}
		for _, item := range valid {
			events = append(events, models.TrainingEvent{
				UserID:          user.ID,
				EventID:         item.input.ID,
				SessionID:       item.input.SessionID,
				PromptID:        item.input.PromptID,
				PromptKind:      item.input.PromptKind,
				TargetCharacter: strings.TrimSpace(item.input.TargetCharacter),
				EnteredText:     strings.TrimSpace(item.input.EnteredText),
				IsCorrect:       *item.input.IsCorrect,
				Classification:  item.input.Classification,
				LatencyMS:       *item.input.LatencyMS,
				ReplayCount:     *item.input.ReplayCount,
				InputMode:       item.input.InputMode,
				CharWPM:         *item.input.CharWPM,
				EffWPM:          *item.input.EffWPM,
				FreqHz:          *item.input.FreqHz,
				ClientCreatedAt: item.createdAt,
			})
			if item.createdAt.After(latestClientTime) {
				latestClientTime = item.createdAt
			}
		}

		// ON CONFLICT DO NOTHING honours the (user_id, event_id) idempotency key.
		if err := h.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&events).Error; err != nil {
			slog.Error("Failed to ingest training events", "user_id", user.ID, "count", len(events), "err", err)
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(
				common.ErrorCodeTrainingIngestFailed, "Failed to store training events"))
			return
		}

		h.touchTrainingProfile(user.ID, latestClientTime)
	}

	acknowledged := make([]string, 0, len(valid))
	for _, item := range valid {
		acknowledged = append(acknowledged, item.input.ID)
	}

	c.JSON(http.StatusOK, common.TrainingEventBatchResponse{
		AcknowledgedIDs: acknowledged,
		RejectedEvents:  rejected,
	})
}

// GetSnapshot returns the user's aggregated learning snapshot. Character
// masteries are derived from stored events on read using the same policy
// constants as the client reducer; only characters with at least one scored
// attempt are reported. Failures to compute are non-fatal to unrelated data.
func (h TrainingHandler) GetSnapshot(c *gin.Context) {
	user := utils.MustGetUser(c)

	var events []models.TrainingEvent
	if err := h.DB.Where("user_id = ?", user.ID).
		Order("client_created_at ASC, id ASC").
		Find(&events).Error; err != nil {
		slog.Error("Failed to load training events", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(
			common.ErrorCodeTrainingSnapshotFailed, "Failed to build training snapshot"))
		return
	}

	response := common.TrainingSnapshotResponse{
		SuggestedStep:      1,
		UnlockedStep:       1,
		CharacterMasteries: computeCharacterMasteries(events, time.Now()),
	}

	var profile models.TrainingProfile
	if err := h.DB.Where("user_id = ?", user.ID).Take(&profile).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Error("Failed to load training profile", "user_id", user.ID, "err", err)
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(
				common.ErrorCodeTrainingSnapshotFailed, "Failed to build training snapshot"))
			return
		}
	} else {
		if profile.SuggestedStep > 1 {
			response.SuggestedStep = profile.SuggestedStep
		}
		if profile.UnlockedStep > 1 {
			response.UnlockedStep = profile.UnlockedStep
		}
		response.LastActiveAt = profile.LastActiveAt
	}

	if response.LastActiveAt == nil && len(events) > 0 {
		last := events[len(events)-1].ClientCreatedAt
		response.LastActiveAt = &last
	}

	c.JSON(http.StatusOK, response)
}

// PutSettings updates cloud-synchronized CW and learning preferences. It
// upserts the shared cw_settings row (the same source of truth as the V1
// settings endpoint) and stores the V2-only target_daily_minutes field.
func (h TrainingHandler) PutSettings(c *gin.Context) {
	var input common.TrainingSettingsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(
			common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	user := utils.MustGetUser(c)

	updates := map[string]any{
		"char_wpm":             *input.CharWPM,
		"eff_wpm":              *input.EffWPM,
		"freq":                 *input.Freq,
		"start_delay":          *input.StartDelay,
		"target_daily_minutes": *input.TargetDailyMinutes,
	}

	settings := models.CWSettings{UserID: user.ID}
	if err := h.DB.Where(&settings).Assign(updates).FirstOrCreate(&settings).Error; err != nil {
		slog.Error("Failed to update training settings", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(
			common.ErrorCodeTrainingSettingsFailed, "Failed to update training settings"))
		return
	}

	var updatedAt time.Time
	if err := h.DB.Model(&models.CWSettings{}).
		Where("user_id = ?", user.ID).
		Pluck("updated_at", &updatedAt).Error; err != nil {
		updatedAt = time.Now().UTC()
	}

	c.JSON(http.StatusOK, common.TrainingSettingsUpdateResponse{UpdatedAt: updatedAt})
}

// touchTrainingProfile creates the profile on first ingestion (seeding the
// course position from the legacy page settings) and advances last_active_at.
func (h TrainingHandler) touchTrainingProfile(userID uuid.UUID, lastActive time.Time) {
	seedStep := 1
	var pageSettings models.PageSettings
	if err := h.DB.Take(&pageSettings, "user_id = ?", userID).Error; err == nil && pageSettings.CurLesson > 1 {
		seedStep = pageSettings.CurLesson
	}

	profile := models.TrainingProfile{UserID: userID}
	createErr := h.DB.Where(&profile).
		Attrs(models.TrainingProfile{SuggestedStep: seedStep, UnlockedStep: seedStep}).
		FirstOrCreate(&profile).Error
	if createErr != nil {
		// A concurrent first batch may have created the row; fall back to the winner.
		if err := h.DB.Where("user_id = ?", userID).Take(&profile).Error; err != nil {
			slog.Error("Failed to upsert training profile", "user_id", userID, "err", createErr)
			return
		}
	}

	if profile.LastActiveAt == nil || lastActive.After(*profile.LastActiveAt) {
		if err := h.DB.Model(&profile).Update("last_active_at", lastActive).Error; err != nil {
			slog.Error("Failed to update training profile activity", "user_id", userID, "err", err)
		}
	}
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
	if id == "" {
		return rejectEvent(id, common.RejectCodeMissingField, "id is required")
	}
	if len(id) > 128 {
		return rejectEvent(id, common.RejectCodeInvalidField, "id exceeds 128 characters")
	}

	if strings.TrimSpace(in.SessionID) == "" {
		return rejectEvent(id, common.RejectCodeMissingField, "session_id is required")
	}
	if len(in.SessionID) > 128 {
		return rejectEvent(id, common.RejectCodeInvalidField, "session_id exceeds 128 characters")
	}

	if strings.TrimSpace(in.PromptID) == "" {
		return rejectEvent(id, common.RejectCodeMissingField, "prompt_id is required")
	}
	if len(in.PromptID) > 128 {
		return rejectEvent(id, common.RejectCodeInvalidField, "prompt_id exceeds 128 characters")
	}

	if !validPromptKinds[in.PromptKind] {
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

	if !validClassifications[in.Classification] {
		return rejectEvent(id, common.RejectCodeInvalidClassification,
			"classification must be one of automatic, developing, incorrect, missing, unmeasured")
	}

	if !validInputModes[in.InputMode] {
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

	if in.ReplayCount == nil {
		return rejectEvent(id, common.RejectCodeMissingField, "replay_count is required")
	}
	if *in.ReplayCount < 0 || *in.ReplayCount > 1000 {
		return rejectEvent(id, common.RejectCodeInvalidField, "replay_count must be between 0 and 1000")
	}

	if in.CharWPM == nil {
		return rejectEvent(id, common.RejectCodeMissingField, "char_wpm is required")
	}
	if *in.CharWPM < 5 || *in.CharWPM > 50 {
		return rejectEvent(id, common.RejectCodeInvalidField, "char_wpm must be between 5 and 50")
	}

	if in.EffWPM == nil {
		return rejectEvent(id, common.RejectCodeMissingField, "eff_wpm is required")
	}
	if *in.EffWPM < 5 || *in.EffWPM > 50 {
		return rejectEvent(id, common.RejectCodeInvalidField, "eff_wpm must be between 5 and 50")
	}

	if in.FreqHz == nil {
		return rejectEvent(id, common.RejectCodeMissingField, "freq_hz is required")
	}
	if *in.FreqHz < 300 || *in.FreqHz > 2000 {
		return rejectEvent(id, common.RejectCodeInvalidField, "freq_hz must be between 300 and 2000")
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

// computeCharacterMasteries mirrors the client CharacterMastery reducer
// (frontend/src/lib/training/v2/mastery.ts) for the reduced snapshot shape:
// rolling window accuracy, median correct latency, and the two-session
// stability rule (a single session can never produce a stable character).
func computeCharacterMasteries(events []models.TrainingEvent, now time.Time) []common.TrainingCharacterMasteryResponse {
	byCharacter := make(map[string][]models.TrainingEvent)
	for _, event := range events {
		if event.Classification == "unmeasured" {
			continue
		}
		character := strings.ToUpper(strings.TrimSpace(event.TargetCharacter))
		if character == "" {
			continue
		}
		byCharacter[character] = append(byCharacter[character], event)
	}

	characters := make([]string, 0, len(byCharacter))
	for character := range byCharacter {
		characters = append(characters, character)
	}
	sort.Strings(characters)

	masteries := make([]common.TrainingCharacterMasteryResponse, 0, len(characters))
	for _, character := range characters {
		// Events arrive ordered by client_created_at, so the window is the tail.
		attempts := byCharacter[character]
		totalAttempts := len(attempts)

		sessions := make(map[string]struct{})
		for _, attempt := range attempts {
			sessions[attempt.SessionID] = struct{}{}
		}

		windowStart := totalAttempts - masteryPolicy.rollingWindowSize
		if windowStart < 0 {
			windowStart = 0
		}
		window := attempts[windowStart:]

		correctInWindow := 0
		correctLatencies := make([]int, 0, len(window))
		for _, attempt := range window {
			if attempt.IsCorrect {
				correctInWindow++
				correctLatencies = append(correctLatencies, attempt.LatencyMS)
			}
		}

		rollingAccuracy := float64(correctInWindow) / float64(len(window))
		medianLatency := medianOfInts(correctLatencies)

		status := "learning"
		hasMinAttempts := totalAttempts >= masteryPolicy.minAttemptsForStability
		hasMultiSession := len(sessions) >= masteryPolicy.minSessionsForStability
		hasAccuracy := rollingAccuracy >= masteryPolicy.targetAccuracy
		hasAutomaticSpeed := medianLatency != nil && *medianLatency <= masteryPolicy.maxAutomaticLatencyMS

		if hasMinAttempts && hasMultiSession && hasAccuracy && hasAutomaticSpeed {
			lastPractisedAt := attempts[totalAttempts-1].ClientCreatedAt
			dueAt := lastPractisedAt.Add(time.Duration(masteryPolicy.reviewIntervalDays) * 24 * time.Hour)
			if !now.Before(dueAt) {
				status = "review"
			} else {
				status = "stable"
			}
		}

		masteries = append(masteries, common.TrainingCharacterMasteryResponse{
			Character:       character,
			Status:          status,
			RollingAccuracy: math.Round(rollingAccuracy*1000) / 1000,
			MedianLatencyMS: medianLatency,
			TotalAttempts:   totalAttempts,
		})
	}

	return masteries
}

// medianOfInts matches the client median helper: midpoint for even counts,
// rounded half away from zero. Returns nil when no samples exist.
func medianOfInts(values []int) *int {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]int(nil), values...)
	sort.Ints(sorted)

	mid := len(sorted) / 2
	if len(sorted)%2 == 1 {
		median := sorted[mid]
		return &median
	}
	median := int(math.Round(float64(sorted[mid-1]+sorted[mid]) / 2))
	return &median
}
