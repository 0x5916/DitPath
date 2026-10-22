package handlers

import (
	"log/slog"
	"net/http"
	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/training"
	"opencw/internal/utils"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ProgressHandler struct {
	DB *gorm.DB
}

func (h ProgressHandler) GetAllProgress(c *gin.Context) {
	user := utils.MustGetUser(c)

	params := c.Request.URL.Query()
	if years, hasYear := params["year"]; hasYear {
		year, err := strconv.Atoi(c.Query("year"))
		hasPagination := params.Has("cursor") || params.Has("limit")
		if err != nil || len(years) != 1 || year < 1 || year > 9999 || hasPagination {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid query parameters"))
			return
		}
		h.getProgressSummary(c, user.ID, year)
		return
	}
	page, err := common.ParseReadPage(params)
	if err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid query parameters"))
		return
	}
	query := h.DB.WithContext(c.Request.Context()).Where("user_id = ?", user.ID)
	if page.HasCursor {
		query = query.Where("(created_at,id) < (?,?)", page.Time, page.ID)
	}
	var records []models.Progress
	if err := query.Order("created_at DESC,id DESC").Limit(page.Limit + 1).Find(&records).Error; err != nil {
		progressQueryError(c, user.ID, err)
		return
	}
	var next *string
	if len(records) > page.Limit {
		records = records[:page.Limit]
		cursor := common.EncodeReadCursor(records[len(records)-1].CreatedAt, records[len(records)-1].ID)
		next = &cursor
	}
	data := make([]common.ProgressResponse, 0, len(records))
	for _, progress := range records {
		data = append(data, progressResponse(progress))
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "limit": page.Limit, "next_cursor": next})
}

func (h ProgressHandler) AddProgress(c *gin.Context) {
	user := utils.MustGetUser(c)

	var input common.ProgressInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	progress := models.Progress{
		UserID:          user.ID,
		Lesson:          input.Lesson,
		CharWPM:         input.CharWPM,
		EffWPM:          input.EffWPM,
		Accuracy:        *input.Accuracy,
		ClientCreatedAt: input.ClientCreatedAt,
	}

	if err := h.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		state, err := training.LockHistoryAccount(tx, user.ID)
		if err != nil {
			return err
		}
		if err := tx.Create(&progress).Error; err != nil {
			return err
		}
		// Mirror database-normalized timestamps into immutable history payloads.
		if err := tx.Take(&progress, "id = ?", progress.ID).Error; err != nil {
			return err
		}
		return training.MirrorLegacyProgress(tx, state, progress)
	}); err != nil {
		slog.Error("Failed to create progress", "user_id", user.ID, "lesson", progress.Lesson, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeProgressCreateFailed, "Failed to create progress"))
		return
	}
	c.JSON(http.StatusCreated, common.MessageResponse{Message: "Progress Created"})
}

func progressResponse(progress models.Progress) common.ProgressResponse {
	return common.ProgressResponse{
		Lesson:          strconv.Itoa(progress.Lesson),
		CharWPM:         progress.CharWPM,
		EffWPM:          progress.EffWPM,
		Accuracy:        progress.Accuracy,
		CreatedAt:       progress.CreatedAt,
		ClientCreatedAt: progress.ClientCreatedAt,
	}
}

func progressQueryError(c *gin.Context, userID uuid.UUID, err error) {
	slog.Error("Failed to query progress", "user_id", userID, "err", err)
	c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeProgressQueryFailed, "failed to query progress"))
}

func (h ProgressHandler) getProgressSummary(c *gin.Context, userID uuid.UUID, year int) {
	db := h.DB.WithContext(c.Request.Context())
	start := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	days := make([]common.ProgressDayResponse, 0)
	if err := db.Model(&models.Progress{}).Select("to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, COUNT(*) AS count").
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, start, start.AddDate(1, 0, 0)).Group("date").Order("date").Scan(&days).Error; err != nil {
		progressQueryError(c, userID, err)
		return
	}
	var records []models.Progress
	if err := db.Where("user_id = ?", userID).Order("created_at DESC,id DESC").Limit(20).Find(&records).Error; err != nil {
		progressQueryError(c, userID, err)
		return
	}
	recent := make([]common.ProgressResponse, 0, len(records))
	for _, record := range records {
		recent = append(recent, progressResponse(record))
	}
	c.JSON(http.StatusOK, gin.H{"days": days, "recent": recent})
}
