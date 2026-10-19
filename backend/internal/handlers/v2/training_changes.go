package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const trainingChangesMaxBytes = 1024 * 1024

type trainingChangesCursor struct {
	Version   int       `json:"v"`
	UserID    uuid.UUID `json:"user"`
	Epoch     int       `json:"epoch"`
	After     int64     `json:"after,string"`
	HighWater int64     `json:"high_water,string"`
}

type trainingChangeRecord struct {
	Revision string          `json:"revision"`
	Kind     string          `json:"kind"`
	Record   json.RawMessage `json:"record"`
}

type trainingChangesResponse struct {
	Changes    []trainingChangeRecord `json:"changes"`
	NextCursor string                 `json:"next_cursor"`
	HasMore    bool                   `json:"has_more"`
}

// GetChanges downloads immutable revisions in commit order. A drained cursor is
// retained as a checkpoint; its next request captures a new committed ceiling.
func (h TrainingHandler) GetChanges(c *gin.Context) {
	limit, encoded, err := parseTrainingChangesQuery(c.Request.URL.Query())
	if err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, err.Error()))
		return
	}
	user := utils.MustGetUser(c)
	var cursor trainingChangesCursor
	if encoded != "" {
		cursor, err = decodeTrainingChangesCursor(encoded, configs.App.JWTSecret)
		if err != nil || cursor.UserID != user.ID {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid training changes cursor"))
			return
		}
	}
	var state *models.TrainingSyncState
	var rows []models.TrainingChange
	var retired, invalid bool
	err = h.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var bootstrapErr error
		state, bootstrapErr = ensureSessionHistory(tx, user.ID)
		if bootstrapErr != nil || !state.BackfillComplete {
			return bootstrapErr // Commit bounded bootstrap progress before 503.
		}
		if encoded == "" {
			cursor = trainingChangesCursor{Version: 1, UserID: user.ID, Epoch: state.FeedEpoch, HighWater: state.LastRevision}
		} else {
			retired = cursor.Epoch != state.FeedEpoch
			invalid = cursor.HighWater > state.LastRevision
			if retired || invalid {
				return nil
			}
			if cursor.After == cursor.HighWater {
				cursor.HighWater = state.LastRevision
			}
		}
		return tx.Where("user_id = ? AND revision > ? AND revision <= ?", user.ID, cursor.After, cursor.HighWater).
			Order("revision ASC").Limit(limit + 1).Find(&rows).Error
	})
	if err != nil {
		slog.Error("Failed to download training changes", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Failed to download training changes"))
		return
	}
	if retired {
		c.JSON(http.StatusGone, common.NewErrorResponse(common.ErrorCodeTrainingCursorResetRequired, "Training cursor has expired; restart download"))
		return
	}
	if invalid {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid training changes cursor"))
		return
	}
	if !state.BackfillComplete {
		c.Header("Retry-After", "1")
		c.JSON(http.StatusServiceUnavailable, common.NewErrorResponse(common.ErrorCodeTrainingSyncInitializing, "Training history is initializing; retry shortly"))
		return
	}
	payload, err := marshalTrainingChangesPage(rows, limit, cursor, configs.App.JWTSecret)
	if err != nil {
		slog.Error("Failed to encode training changes", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to encode training changes"))
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
}

func parseTrainingChangesQuery(values url.Values) (int, string, error) {
	limit := 100
	for _, key := range []string{"limit", "cursor"} {
		if raw, present := values[key]; present && (len(raw) != 1 || raw[0] == "") {
			return 0, "", errors.New("Invalid " + key)
		}
	}
	if raw := values.Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			return 0, "", errors.New("limit must be between 1 and 100")
		}
		limit = value
	}
	return limit, values.Get("cursor"), nil
}

// Include the signed checkpoint and complete JSON envelope in the byte bound.
func marshalTrainingChangesPage(rows []models.TrainingChange, limit int, cursor trainingChangesCursor, key []byte) ([]byte, error) {
	response := trainingChangesResponse{Changes: []trainingChangeRecord{}}
	encode := func(accepted int) ([]byte, error) {
		response.HasMore = accepted < len(rows)
		next := cursor
		if accepted > 0 {
			next.After = rows[accepted-1].Revision
		}
		if !response.HasMore {
			next.After = next.HighWater
		}
		var err error
		response.NextCursor, err = encodeTrainingChangesCursor(next, key)
		if err != nil {
			return nil, err
		}
		return json.Marshal(response)
	}
	payload, err := encode(0)
	if err != nil {
		return nil, err
	}
	for i, row := range rows {
		if i == limit {
			break
		}
		response.Changes = append(response.Changes, trainingChangeRecord{Revision: strconv.FormatInt(row.Revision, 10), Kind: row.Kind, Record: row.Payload})
		candidate, err := encode(i + 1)
		if err != nil {
			return nil, err
		}
		if len(candidate) > trainingChangesMaxBytes {
			if i == 0 {
				return nil, errors.New("training change exceeds response byte limit")
			}
			break
		}
		payload = candidate
	}
	return payload, nil
}

func encodeTrainingChangesCursor(cursor trainingChangesCursor, key []byte) (string, error) {
	if len(key) == 0 {
		return "", errors.New("training changes signing key is unavailable")
	}
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(trainingChangesSignature(payload, key)), nil
}

func decodeTrainingChangesCursor(encoded string, key []byte) (trainingChangesCursor, error) {
	var cursor trainingChangesCursor
	parts := strings.Split(encoded, ".")
	if len(key) == 0 || len(encoded) > 4096 || len(parts) != 2 {
		return cursor, errors.New("invalid training changes cursor")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return cursor, err
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(signature, trainingChangesSignature(payload, key)) {
		return cursor, errors.New("invalid training changes cursor signature")
	}
	// Required fields are checked separately because zero is a valid checkpoint.
	var fields map[string]json.RawMessage
	if json.Unmarshal(payload, &cursor) != nil || json.Unmarshal(payload, &fields) != nil {
		return cursor, errors.New("invalid training changes cursor contents")
	}
	if cursor.Version != 1 || cursor.UserID == uuid.Nil || cursor.Epoch < 1 || cursor.After < 0 || cursor.HighWater < cursor.After || fields["after"] == nil || fields["high_water"] == nil || string(fields["after"]) == "null" || string(fields["high_water"]) == "null" {
		return cursor, errors.New("invalid training changes cursor contents")
	}
	return cursor, nil
}

func trainingChangesSignature(payload, key []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("ditpath:training-changes:v1\x00"))
	mac.Write(payload)
	return mac.Sum(nil)
}
