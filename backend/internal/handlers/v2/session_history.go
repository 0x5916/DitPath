package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/models"
	"opencw/internal/training"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type sessionHistoryQuery struct {
	Mode, Status, Cursor string
	From, To             *time.Time
	Limit                int
	IncludeSummary       bool
}

type sessionHistoryCursor struct {
	Version   int       `json:"v"`
	UserID    uuid.UUID `json:"user"`
	Filters   string    `json:"filters"`
	Epoch     int       `json:"epoch"`
	HighWater int64     `json:"high_water,string"`
	Occurred  time.Time `json:"occurred"`
	ID        uuid.UUID `json:"id"`
}

type sessionHistorySummary struct {
	CompletedCounts struct {
		Guided   int64 `json:"guided"`
		Practice int64 `json:"practice"`
		Legacy   int64 `json:"legacy"`
	} `json:"completed_counts"`
	CompletedWithMeasuredTiming int64 `json:"completed_with_measured_timing"`
	RecordedElapsedMS           int64 `json:"recorded_elapsed_ms"`
}

// GetSessions reads an immutable, account-scoped view of terminal history.
// The revision ceiling remains fixed across pages, including their summaries.
func (h TrainingHandler) GetSessions(c *gin.Context) {
	query, err := parseSessionHistoryQuery(c.Request.URL.Query())
	if err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, err.Error()))
		return
	}
	user := utils.MustGetUser(c)
	var cursor sessionHistoryCursor
	if query.Cursor != "" {
		cursor, err = decodeSessionHistoryCursor(query.Cursor, configs.App.JWTSecret)
		if err != nil || cursor.UserID != user.ID || cursor.Filters != query.fingerprint() {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid history cursor"))
			return
		}
	}
	var state *models.TrainingSyncState
	var sessions []models.TrainingSession
	var summary *sessionHistorySummary
	var retired, invalid bool
	err = h.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var bootstrapErr error
		state, bootstrapErr = ensureSessionHistory(tx, user.ID)
		if bootstrapErr != nil || !state.BackfillComplete {
			return bootstrapErr // Commit bounded bootstrap work before returning 503.
		}
		highWater := state.LastRevision
		if query.Cursor != "" {
			retired = cursor.Epoch != state.FeedEpoch
			invalid = cursor.HighWater > highWater
			if retired || invalid {
				return nil
			}
			highWater = cursor.HighWater
		} else {
			cursor = sessionHistoryCursor{Version: 1, UserID: user.ID, Filters: query.fingerprint(), Epoch: state.FeedEpoch, HighWater: highWater}
		}
		base := func() *gorm.DB {
			return query.scope(tx.Model(&models.TrainingSession{}).Where("user_id = ? AND sync_revision <= ?", user.ID, highWater))
		}
		page := base()
		if query.Cursor != "" {
			page = page.Where("(occurred_at, id) < (?, ?)", cursor.Occurred, cursor.ID)
		}
		if err := page.Order("occurred_at DESC, id DESC").Limit(query.Limit + 1).Find(&sessions).Error; err != nil {
			return err
		}
		if query.IncludeSummary {
			var totals struct {
				Guided, Practice, Legacy, Measured, Elapsed int64
			}
			measured := "status = 'completed' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at"
			if err := base().Select(
				"COUNT(*) FILTER (WHERE status = 'completed' AND source_kind = 'native' AND mode = 'guided') AS guided, " +
					"COUNT(*) FILTER (WHERE status = 'completed' AND source_kind = 'native' AND mode = 'practice') AS practice, " +
					"COUNT(*) FILTER (WHERE status = 'completed' AND source_kind = 'legacy_v1') AS legacy, " +
					"COUNT(*) FILTER (WHERE " + measured + ") AS measured, " +
					"COALESCE(SUM(FLOOR(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)) FILTER (WHERE " + measured + "), 0)::bigint AS elapsed").Scan(&totals).Error; err != nil {
				return err
			}
			summary = &sessionHistorySummary{CompletedWithMeasuredTiming: totals.Measured, RecordedElapsedMS: totals.Elapsed}
			summary.CompletedCounts.Guided, summary.CompletedCounts.Practice, summary.CompletedCounts.Legacy = totals.Guided, totals.Practice, totals.Legacy
		}
		return nil
	})
	if err != nil {
		slog.Error("Failed to read training history", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Failed to read training history"))
		return
	}
	if retired {
		c.JSON(http.StatusGone, common.NewErrorResponse(common.ErrorCodeTrainingCursorResetRequired, "History cursor has expired; restart pagination"))
		return
	}
	if invalid {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid history cursor"))
		return
	}
	if !state.BackfillComplete {
		c.Header("Retry-After", "1")
		c.JSON(http.StatusServiceUnavailable, common.NewErrorResponse(common.ErrorCodeTrainingSyncInitializing, "Training history is initializing; retry shortly"))
		return
	}
	hasMore := len(sessions) > query.Limit
	var next *string
	if hasMore {
		sessions = sessions[:query.Limit]
		last := sessions[len(sessions)-1]
		cursor.Occurred, cursor.ID = last.OccurredAt, last.ID
		encoded, encodeErr := encodeSessionHistoryCursor(cursor, configs.App.JWTSecret)
		if encodeErr != nil {
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to create history cursor"))
			return
		}
		next = &encoded
	}
	records := make([]map[string]any, 0, len(sessions))
	for _, session := range sessions {
		records = append(records, training.SessionRecord(session))
	}
	response := gin.H{"sessions": records, "limit": query.Limit, "next_cursor": next, "has_more": hasMore, "high_water_revision": strconv.FormatInt(cursor.HighWater, 10)}
	if summary != nil {
		response["summary"] = summary
	}
	c.JSON(http.StatusOK, response)
}

func parseSessionHistoryQuery(values url.Values) (sessionHistoryQuery, error) {
	query := sessionHistoryQuery{Mode: "all", Status: "completed", Limit: 20}
	for _, key := range []string{"mode", "status", "from", "to", "limit", "cursor", "include_summary"} {
		if raw, present := values[key]; present && (len(raw) != 1 || raw[0] == "") {
			return query, fmt.Errorf("Invalid %s", key)
		}
	}
	if value := values.Get("mode"); value != "" {
		query.Mode = value
	}
	if value := values.Get("status"); value != "" {
		query.Status = value
	}
	if query.Mode != "all" && query.Mode != "guided" && query.Mode != "practice" && query.Mode != "legacy" {
		return query, errors.New("Invalid mode")
	}
	if query.Status != "all" && query.Status != "completed" && query.Status != "abandoned" {
		return query, errors.New("Invalid status")
	}
	for key, target := range map[string]**time.Time{"from": &query.From, "to": &query.To} {
		if value := values.Get(key); value != "" {
			parsed, err := time.Parse(time.RFC3339Nano, value)
			if err != nil {
				return query, fmt.Errorf("Invalid %s; expected RFC3339", key)
			}
			parsed = parsed.UTC()
			*target = &parsed
		}
	}
	if query.From != nil && query.To != nil && !query.From.Before(*query.To) {
		return query, errors.New("from must be before to")
	}
	if value := values.Get("limit"); value != "" {
		limit, err := strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 100 {
			return query, errors.New("limit must be between 1 and 100")
		}
		query.Limit = limit
	}
	if value := values.Get("include_summary"); value != "" {
		if value != "true" && value != "false" {
			return query, errors.New("include_summary must be true or false")
		}
		query.IncludeSummary = value == "true"
	}
	query.Cursor = values.Get("cursor")
	return query, nil
}

func (query sessionHistoryQuery) scope(db *gorm.DB) *gorm.DB {
	if query.Mode == "legacy" {
		db = db.Where("source_kind = ?", "legacy_v1")
	} else if query.Mode != "all" {
		db = db.Where("mode = ?", query.Mode)
	}
	if query.Status != "all" {
		db = db.Where("status = ?", query.Status)
	}
	if query.From != nil {
		db = db.Where("occurred_at >= ?", *query.From)
	}
	if query.To != nil {
		db = db.Where("occurred_at < ?", *query.To)
	}
	return db
}

func (query sessionHistoryQuery) fingerprint() string {
	payload, _ := json.Marshal([]any{query.Mode, query.Status, query.From, query.To})
	hash := sha256.Sum256(payload)
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

func encodeSessionHistoryCursor(cursor sessionHistoryCursor, key []byte) (string, error) {
	if len(key) == 0 {
		return "", errors.New("history cursor signing key is unavailable")
	}
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	signature := sessionHistorySignature(payload, key)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func decodeSessionHistoryCursor(encoded string, key []byte) (sessionHistoryCursor, error) {
	var cursor sessionHistoryCursor
	parts := strings.Split(encoded, ".")
	if len(key) == 0 || len(encoded) > 4096 || len(parts) != 2 {
		return cursor, errors.New("invalid history cursor")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return cursor, err
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(signature, sessionHistorySignature(payload, key)) {
		return cursor, errors.New("invalid history cursor signature")
	}
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return cursor, err
	}
	var presence struct {
		Occurred *time.Time `json:"occurred"`
	}
	if err := json.Unmarshal(payload, &presence); err != nil {
		return cursor, err
	}
	if cursor.Version != 1 || cursor.UserID == uuid.Nil || cursor.Filters == "" || cursor.Epoch < 1 || cursor.HighWater < 0 || presence.Occurred == nil || cursor.ID == uuid.Nil {
		return cursor, errors.New("invalid history cursor contents")
	}
	return cursor, nil
}

func sessionHistorySignature(payload, key []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("ditpath:session-history:v1\x00"))
	mac.Write(payload)
	return mac.Sum(nil)
}
