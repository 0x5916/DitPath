package handlers

import (
	"log/slog"
	"net/http"
	"opencw/internal/common"
	"opencw/internal/models"
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

	if years, ok := c.Request.URL.Query()["year"]; ok {
		year, err := strconv.Atoi(c.Query("year"))
		if err != nil || len(years) != 1 || year < 1 || year > 9999 || c.Request.URL.Query().Has("cursor") || c.Request.URL.Query().Has("limit") {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid query parameters"))
			return
		}
		h.getProgressSummary(c, user.ID, year)
		return
	}
	page, err := common.ParseReadPage(c.Request.URL.Query())
	if err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid query parameters"))
		return
	}
	query := h.DB.WithContext(c.Request.Context()).Where("user_id = ?", user.ID)
	if page.HasCursor {
		query = query.Where("(created_at,id) < (?,?)", page.Time, page.ID)
	}
	var progresses []models.Progress
	if err := query.Order("created_at DESC,id DESC").Limit(page.Limit + 1).Find(&progresses).Error; err != nil {
		progressQueryError(c, user.ID, err)
		return
	}
	var next *string
	if len(progresses) > page.Limit {
		progresses = progresses[:page.Limit]
		cursor := common.EncodeReadCursor(progresses[len(progresses)-1].CreatedAt, progresses[len(progresses)-1].ID)
		next = &cursor
	}
	data := make([]common.ProgressResponse, 0, len(progresses))
	for _, progress := range progresses {
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

	if err := h.DB.Create(&progress).Error; err != nil {
		slog.Error("Failed to create progress", "user_id", user.ID, "lesson", progress.Lesson, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeProgressCreateFailed, "Failed to create progress"))
		return
	}
	c.JSON(http.StatusCreated, common.MessageResponse{Message: "Progress Created"})
}

func progressResponse(progress models.Progress) common.ProgressResponse {
	return common.ProgressResponse{Lesson: strconv.Itoa(progress.Lesson), CharWPM: progress.CharWPM, EffWPM: progress.EffWPM, Accuracy: progress.Accuracy, CreatedAt: progress.CreatedAt, ClientCreatedAt: progress.ClientCreatedAt}
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
