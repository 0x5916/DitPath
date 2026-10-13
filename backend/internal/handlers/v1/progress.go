package handlers

import (
	"log/slog"
	"net/http"
	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ProgressHandler struct {
	DB *gorm.DB
}

func (h ProgressHandler) GetAllProgress(c *gin.Context) {
	user := utils.MustGetUser(c)

	var progresses []common.ProgressResponse
	if err := h.DB.Model(&models.Progress{}).Find(&progresses, "user_id = ?", user.ID).Error; err != nil {
		slog.Error("Failed to query progress", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeProgressQueryFailed, "failed to query progress"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": progresses})
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

func (h ProgressHandler) AddProgresses(c *gin.Context) {
	user := utils.MustGetUser(c)

	var inputs []common.ProgressInput
	if err := c.ShouldBindJSON(&inputs); err != nil || len(inputs) == 0 {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	progresses := make([]models.Progress, 0, len(inputs))
	for _, input := range inputs {
		progresses = append(progresses, models.Progress{
			UserID:          user.ID,
			Lesson:          input.Lesson,
			CharWPM:         input.CharWPM,
			EffWPM:          input.EffWPM,
			Accuracy:        *input.Accuracy,
			ClientCreatedAt: input.ClientCreatedAt,
		})
	}

	if err := h.DB.Create(&progresses).Error; err != nil {
		slog.Error("Failed to create progress", "user_id", user.ID, "count", len(progresses), "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeProgressCreateFailed, "Failed to create progress"))
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "Progress Created", "count": len(progresses)})
}
