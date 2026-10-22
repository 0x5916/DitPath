package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/training"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TrainingHandler serves canonical V1 training routes and temporary V2 aliases:
//
//	POST /v1/training/events/batch
//	GET  /v1/training/snapshot
//	PUT  /v1/training/settings
//
// See backend/docs/training-events-v2.md for the wire contract. The legacy
// /v1/cw/progress endpoint remains active and is not affected.
type TrainingHandler struct {
	DB *gorm.DB
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

	var raw json.RawMessage
	if err := c.ShouldBindJSON(&raw); err != nil {
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

	var input common.TrainingEventBatchInput
	if json.Unmarshal(raw, &input) != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}
	strict := input.SchemaVersion == common.TrainingEventStrictSchemaVersion
	if input.SchemaVersion != common.TrainingV2SchemaVersion && !strict {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(
			common.ErrorCodeTrainingSchemaVersion, "Unsupported schema_version; expected 1 or 2"))
		return
	}

	if strict {
		clientID, err := uuid.Parse(input.ClientID)
		if err != nil || clientID == uuid.Nil || containsUserID(raw) {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Schema 2 requires a client_id UUID and forbids user_id"))
			return
		}
		if input.ClientSentAt != nil {
			if _, err := time.Parse(time.RFC3339Nano, *input.ClientSentAt); err != nil {
				c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "client_sent_at must be RFC3339"))
				return
			}
		}
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
	if strict {
		valid, rejected = validateStrictTrainingEvents(input.Events)
	}
	acknowledged := make([]string, 0, len(valid))

	if len(valid) > 0 {
		events := make([]models.TrainingEvent, 0, len(valid))
		for _, item := range valid {
			events = append(events, trainingEventModel(item, user.ID))
		}

		if err := h.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
			state, err := training.LockHistoryAccount(tx, user.ID)
			if err != nil {
				return err
			}
			var latest *time.Time
			for i := range events {
				event := &events[i]
				var stored models.TrainingEvent
				err := tx.Take(&stored, "user_id = ? AND event_id = ?", user.ID, event.EventID).Error
				if errors.Is(err, gorm.ErrRecordNotFound) {
					rejection, err := checkTerminalEvent(tx, *event)
					if err != nil {
						return err
					}
					if rejection != nil {
						rejected = append(rejected, *rejection)
						continue
					}
					if err := tx.Create(event).Error; err != nil {
						return err
					}
					if err := training.RecordAttemptChange(tx, state, event); err != nil {
						return err
					}
					stored = *event
				} else if err != nil {
					return err
				} else if strict && !sameTrainingEvent(stored, *event) {
					rejected = append(rejected, *rejectEvent(event.EventID, common.RejectCodeIDConflict, "Event content is immutable"))
					continue
				}
				// Schema 1 retries keep first-write-wins semantics and activity from
				// the canonical stored event, never the conflicting retry payload.
				if latest == nil || stored.ClientCreatedAt.After(*latest) {
					active := stored.ClientCreatedAt
					latest = &active
				}
				acknowledged = append(acknowledged, event.EventID)
			}
			if latest != nil {
				return training.TouchHistoryProfile(tx, user.ID, *latest)
			}
			return nil
		}); err != nil {
			slog.Error("Failed to ingest training events", "user_id", user.ID, "count", len(events), "err", err)
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(
				common.ErrorCodeTrainingIngestFailed, "Failed to store training events"))
			return
		}
	}

	c.JSON(http.StatusOK, common.TrainingEventBatchResponse{
		AcknowledgedIDs: acknowledged,
		RejectedEvents:  rejected,
	})
}

// GetSnapshot returns the user's aggregated learning snapshot. Character
// masteries are derived from stored events on read using the same policy
// constants as the client reducer; only characters with at least one scored
// attempt are reported.
func (h TrainingHandler) GetSnapshot(c *gin.Context) {
	user := utils.MustGetUser(c)

	db := h.DB.WithContext(c.Request.Context())
	var accumulator training.MasteryAccumulator
	var lastActive *time.Time
	rows, err := db.Model(&models.TrainingEvent{}).
		Select("target_character", "classification", "is_correct", "latency_ms", "session_id", "client_created_at").
		Where("user_id = ?", user.ID).Order("client_created_at ASC, id ASC").Rows()
	if err == nil {
		defer rows.Close()
		accumulator, lastActive, err = scanTrainingHistory(db, rows)
	}
	if err != nil {
		slog.Error("Failed to load training events", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(
			common.ErrorCodeTrainingSnapshotFailed, "Failed to build training snapshot"))
		return
	}

	response := common.TrainingSnapshotResponse{
		SuggestedStep:      1,
		UnlockedStep:       1,
		CharacterMasteries: accumulator.Masteries(time.Now()),
	}

	var profile models.TrainingProfile
	err = db.Where("user_id = ?", user.ID).Take(&profile).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Error("Failed to load training profile", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(
			common.ErrorCodeTrainingSnapshotFailed, "Failed to build training snapshot"))
		return
	}
	if err == nil {
		response.SuggestedStep = max(1, profile.SuggestedStep)
		response.UnlockedStep = max(1, profile.UnlockedStep)
		response.LastActiveAt = profile.LastActiveAt
	}

	if response.LastActiveAt == nil {
		response.LastActiveAt = lastActive
	}

	c.JSON(http.StatusOK, response)
}

// The handler retains row ownership so scan failures close after the error response.
func scanTrainingHistory(db *gorm.DB, rows *sql.Rows) (training.MasteryAccumulator, *time.Time, error) {
	var accumulator training.MasteryAccumulator
	var lastActive *time.Time
	for rows.Next() {
		var event models.TrainingEvent
		if err := db.ScanRows(rows, &event); err != nil {
			return accumulator, lastActive, err
		}
		accumulator.Add(event)
		last := event.ClientCreatedAt
		lastActive = &last
	}
	return accumulator, lastActive, rows.Err()
}

// PutSettings updates cloud-synchronized CW and learning preferences. It
// upserts the shared cw_settings row (the same source of truth as the V1
// settings endpoint) and stores the training target_daily_minutes field.
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
