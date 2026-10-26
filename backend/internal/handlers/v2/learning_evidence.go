package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"io"
	"log/slog"
	"net/http"
	"opencw/internal/common"
	"opencw/internal/learning"
	"opencw/internal/utils"
	"time"
)

type learningBatchResponse struct {
	AcknowledgedIDs []string             `json:"acknowledged_ids"`
	RejectedRecords []learning.Rejection `json:"rejected_records"`
}

// PostLearningEvidence stores prospective metadata without changing legacy history.
func (h TrainingHandler) PostLearningEvidence(c *gin.Context) {
	user := utils.MustGetUser(c)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, learning.MaxPayloadBytes)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var size *http.MaxBytesError
		if errors.As(err, &size) {
			c.JSON(413, common.NewErrorResponse("LEARNING_EVIDENCE_PAYLOAD_TOO_LARGE", "Payload exceeds 256 KiB"))
		} else {
			c.JSON(400, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid body"))
		}
		return
	}
	input, err := learning.DecodeObject(body)
	if err != nil {
		c.JSON(400, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid envelope"))
		return
	}
	for key := range input {
		if key != "schema_version" && key != "client_id" && key != "client_sent_at" && key != "records" {
			c.JSON(400, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Unsupported envelope field"))
			return
		}
	}
	if input["schema_version"] != json.Number("1") {
		c.JSON(400, common.NewErrorResponse("LEARNING_EVIDENCE_UNSUPPORTED_SCHEMA_VERSION", "Expected schema_version 1"))
		return
	}
	clientText, _ := input["client_id"].(string)
	clientID, err := uuid.Parse(clientText)
	records, ok := input["records"].([]any)
	if err != nil || clientID == uuid.Nil || !ok || len(records) < 1 || len(records) > 100 {
		c.JSON(400, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Require client_id UUID and 1–100 records"))
		return
	}
	if value := input["client_sent_at"]; value != nil {
		sent, ok := value.(string)
		_, err := time.Parse(time.RFC3339Nano, sent)
		if !ok || err != nil {
			c.JSON(400, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid client_sent_at"))
			return
		}
	}
	order := []string{}
	seen := map[string]bool{}
	valid := map[string]learning.Record{}
	rejected := map[string]learning.Rejection{}
	for _, value := range records {
		raw, _ := json.Marshal(value)
		record, rejection := learning.Validate(raw)
		if !seen[record.ID] {
			order = append(order, record.ID)
			seen[record.ID] = true
		}
		if rejection != nil {
			rejected[record.ID] = *rejection
			continue
		}
		if previous, exists := valid[record.ID]; exists && !bytes.Equal(previous.Canonical, record.Canonical) {
			rejected[record.ID] = *learning.Reject(record.ID, "ID_CONFLICT", "Conflicting repeated record ID", false)
		} else {
			valid[record.ID] = record
		}
	}
	response := learningBatchResponse{AcknowledgedIDs: []string{}, RejectedRecords: []learning.Rejection{}}
	if len(valid) > 0 {
		err = h.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
			state, err := learning.LockAccount(tx, user.ID)
			if err != nil {
				return err
			}
			for _, id := range order {
				if _, bad := rejected[id]; bad {
					continue
				}
				rejection, err := learning.Store(tx, state, clientID, valid[id])
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
			slog.Error("Failed to store learning evidence", "user_id", user.ID, "err", err)
			c.JSON(500, common.NewErrorResponse("LEARNING_EVIDENCE_INGEST_FAILED", "Failed to store learning evidence"))
			return
		}
	}
	for _, id := range order {
		if rejection, exists := rejected[id]; exists {
			response.RejectedRecords = append(response.RejectedRecords, rejection)
		}
	}
	c.JSON(http.StatusOK, response)
}
