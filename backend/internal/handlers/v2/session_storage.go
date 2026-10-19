package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/training"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func ensureSessionHistory(tx *gorm.DB, userID uuid.UUID) (*models.TrainingSyncState, error) {
	return training.EnsureSessionHistory(tx, userID)
}

// PostSessionsBatch finalizes immutable native session summaries. Event evidence
// must already exist; the same account lock protects both upload paths.
func (h TrainingHandler) PostSessionsBatch(c *gin.Context) {
	user := utils.MustGetUser(c)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, common.TrainingSessionMaxPayloadBytes)
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			c.JSON(http.StatusRequestEntityTooLarge, common.NewErrorResponse(common.ErrorCodeTrainingPayloadTooLarge, "Payload exceeds the 256 KB batch limit"))
		} else {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		}
		return
	}
	var input common.TrainingSessionBatchInput
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &input) != nil || json.Unmarshal(raw, &fields) != nil || fields == nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}
	for key := range fields {
		if strings.EqualFold(key, "user_id") {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "user_id must not be supplied"))
			return
		}
	}
	if input.SchemaVersion != common.TrainingSessionSchemaVersion {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeTrainingSchemaVersion, "Unsupported schema_version; expected 1"))
		return
	}
	clientID, err := uuid.Parse(input.ClientID)
	if err != nil || clientID == uuid.Nil || len(input.Sessions) == 0 || len(input.Sessions) > common.TrainingSessionMaxBatch {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Require client_id UUID and 1–20 sessions"))
		return
	}
	if input.ClientSentAt != nil {
		if _, err := time.Parse(time.RFC3339Nano, *input.ClientSentAt); err != nil {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "client_sent_at must be RFC3339"))
			return
		}
	}
	response := common.TrainingSessionBatchResponse{AcknowledgedIDs: []string{}, RejectedSessions: []common.TrainingRejectedSession{}}
	valid := make(map[string]common.ValidatedTrainingSession)
	canonical := make(map[string][]byte)
	order := []string{}
	rejected := make(map[string]common.TrainingRejectedSession)
	for _, raw := range input.Sessions {
		id := common.SessionIDFromRaw(raw)
		session, err := common.ValidateTrainingSession(raw)
		if err != nil {
			rejected[id] = sessionRejection(id, common.RejectCodeInvalidField, err.Error(), false)
			if _, exists := canonical[id]; !exists {
				order = append(order, id)
				canonical[id] = nil
			}
			continue
		}
		payload, err := common.CanonicalTrainingSession(session)
		if err != nil {
			rejected[id] = sessionRejection(id, common.RejectCodeInvalidField, "Session cannot be represented canonically", false)
			if _, exists := canonical[id]; !exists {
				order = append(order, id)
				canonical[id] = nil
			}
			continue
		}
		if previous, exists := canonical[id]; exists {
			if !bytes.Equal(previous, payload) {
				rejected[id] = sessionRejection(id, common.RejectCodeIDConflict, "Conflicting repeated session ID", false)
			}
			continue
		}
		order = append(order, id)
		canonical[id], valid[id] = payload, session
	}
	if len(valid) > 0 {
		err = h.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
			state, err := ensureSessionHistory(tx, user.ID)
			if err != nil {
				return err
			}
			for _, id := range order {
				if _, bad := rejected[id]; bad {
					continue
				}
				rejection, err := storeTrainingSession(tx, state, clientID, valid[id], canonical[id])
				if err != nil {
					return err
				}
				if rejection != nil {
					rejected[id] = *rejection
				} else {
					response.AcknowledgedIDs = append(response.AcknowledgedIDs, id)
				}
			}
			return nil
		})
		if err != nil {
			slog.Error("Failed to store training sessions", "user_id", user.ID, "err", err)
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeTrainingIngestFailed, "Failed to store training sessions"))
			return
		}
	}
	for _, id := range order {
		if rejection, exists := rejected[id]; exists {
			response.RejectedSessions = append(response.RejectedSessions, rejection)
		}
	}
	c.JSON(http.StatusOK, response)
}

func sessionRejection(id, code, message string, retryable bool) common.TrainingRejectedSession {
	return common.TrainingRejectedSession{ID: id, ErrorCode: code, Message: message, Retryable: retryable}
}

func storeTrainingSession(tx *gorm.DB, state *models.TrainingSyncState, clientID uuid.UUID, in common.ValidatedTrainingSession, canonical []byte) (*common.TrainingRejectedSession, error) {
	var existing models.TrainingSession
	err := tx.Take(&existing, "user_id = ? AND session_id = ?", state.UserID, in.SessionID).Error
	if err == nil {
		previous := sessionSemanticInput(existing)
		raw, _ := common.CanonicalTrainingSession(previous)
		if existing.SourceKind != "native" || !bytes.Equal(raw, canonical) {
			rejection := sessionRejection(in.SessionID, common.RejectCodeIDConflict, "Terminal session content is immutable", false)
			return &rejection, nil
		}
		return nil, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	// Read at most one more than the maximum manifest size to bound corrupt or
	// legacy evidence sets without ever accepting an incomplete set.
	var events []models.TrainingEvent
	if err := tx.Where("user_id = ? AND session_id = ?", state.UserID, in.SessionID).Limit(1001).Find(&events).Error; err != nil {
		return nil, err
	}
	expected := make(map[string]bool, len(in.EventIDs))
	for _, id := range in.EventIDs {
		expected[id] = true
	}
	scored, correct := 0, 0
	for _, event := range events {
		if !expected[event.EventID] {
			rejection := sessionRejection(in.SessionID, common.RejectCodeSessionEventConflict, "Stored events are outside the terminal manifest", false)
			return &rejection, nil
		}
		if event.Classification != "unmeasured" {
			scored++
			if event.IsCorrect {
				correct++
			}
		}
	}
	if len(events) != len(expected) {
		rejection := sessionRejection(in.SessionID, common.RejectCodeMissingSessionEvents, "Upload all manifest events before finalizing", true)
		return &rejection, nil
	}
	session := models.TrainingSession{
		UserID: state.UserID, SessionID: in.SessionID, SchemaVersion: 1, Mode: &in.Mode,
		SourceKind: "native", ClientID: &clientID, CurriculumVersion: in.CurriculumVersion,
		Lesson: in.Lesson, Status: in.Status, CharWPM: &in.CharWPM, EffWPM: &in.EffWPM, FreqHz: &in.FreqHz,
		StartedAt: &in.StartedAt, EndedAt: in.EndedAt, PromptCount: &in.PromptCount, AttemptCount: &in.AttemptCount,
		EventIDs: in.EventIDs, Accuracy: in.Accuracy, ScoringVersion: in.ScoringVersion,
		OccurredAt: in.StartedAt, OccurredAtSource: "client_start", SyncRevision: state.LastRevision + 1, ReceivedAt: time.Now().UTC().Truncate(time.Microsecond),
	}
	if in.EndedAt != nil {
		session.OccurredAt, session.OccurredAtSource = *in.EndedAt, "client_end"
	}
	if in.Mode == "guided" {
		session.ScoredAttemptCount, session.CorrectAttemptCount = &scored, &correct
		session.ScoringVersion = "guided-recognition-v1"
		if scored > 0 {
			accuracy := math.Round(float64(correct)/float64(scored)*1000) / 1000
			session.Accuracy = &accuracy
		}
	}
	hash := sha256.Sum256(canonical)
	session.PayloadHash = hash[:]
	if err := tx.Create(&session).Error; err != nil {
		return nil, err
	}
	if err := training.AppendHistoryChange(tx, state, "session", session.SessionID, training.SessionRecord(session)); err != nil {
		return nil, err
	}
	return nil, training.TouchHistoryProfile(tx, state.UserID, session.OccurredAt)
}

func sessionSemanticInput(s models.TrainingSession) common.ValidatedTrainingSession {
	in := common.ValidatedTrainingSession{
		SessionID: s.SessionID, CurriculumVersion: s.CurriculumVersion, Lesson: s.Lesson, Status: s.Status,
		EndedAt: s.EndedAt, EventIDs: s.EventIDs,
	}
	if s.Mode != nil && s.StartedAt != nil && s.CharWPM != nil && s.EffWPM != nil && s.FreqHz != nil && s.PromptCount != nil && s.AttemptCount != nil {
		in.Mode, in.StartedAt = *s.Mode, *s.StartedAt
		in.CharWPM, in.EffWPM, in.FreqHz = *s.CharWPM, *s.EffWPM, *s.FreqHz
		in.PromptCount, in.AttemptCount = *s.PromptCount, *s.AttemptCount
		if in.Mode == "practice" {
			in.Accuracy, in.ScoringVersion = s.Accuracy, s.ScoringVersion
		}
	}
	return in
}

func checkTerminalEvent(tx *gorm.DB, event models.TrainingEvent) (*common.TrainingRejectedEvent, error) {
	var session models.TrainingSession
	err := tx.Take(&session, "user_id = ? AND session_id = ?", event.UserID, event.SessionID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if session.Mode == nil || *session.Mode != "guided" || !slices.Contains(session.EventIDs, event.EventID) {
		return rejectEvent(event.EventID, common.RejectCodeSessionEventConflict, "Event is outside the finalized guided manifest"), nil
	}
	return nil, nil
}
