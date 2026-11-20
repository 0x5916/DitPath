package handlers

import (
	"log/slog"
	"net/http"
	"strconv"

	"morsewell/internal/common"
	"morsewell/internal/learning"
	"morsewell/internal/models"
	"morsewell/internal/training"
	"morsewell/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (h ProgressHandler) Reset(c *gin.Context) {
	id := utils.MustGetUser(c).ID
	var next int
	err := h.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		history, err := training.LockHistoryAccount(tx, id)
		if err != nil {
			return err
		}
		if err := common.CheckTrainingEpoch(c, history.FeedEpoch); err != nil {
			return err
		}
		evidence, err := learning.LockAccount(tx, id)
		if err != nil {
			return err
		}
		for _, model := range []any{&models.Progress{}, &models.TrainingProfile{}, &models.TrainingSession{},
			&models.TrainingEvent{}, &models.TrainingChange{}, &models.LearningEvidenceChange{}, &models.LearningEvidenceRecord{}} {
			if err := tx.Unscoped().Where("user_id = ?", id).Delete(model).Error; err != nil {
				return err
			}
		}
		page := models.GetDefaultPageSettings()
		page.UserID, page.CurLesson = id, 1
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoUpdates: clause.AssignmentColumns([]string{"cur_lesson", "updated_at"})}).Create(&page).Error; err != nil {
			return err
		}
		next = max(history.FeedEpoch, evidence.FeedEpoch) + 1
		if err := tx.Model(history).Updates(map[string]any{"feed_epoch": next, "last_revision": 0, "backfill_complete": true}).Error; err != nil {
			return err
		}
		return tx.Model(evidence).Updates(map[string]any{"feed_epoch": next, "last_revision": 0}).Error
	})
	if common.RespondStaleTrainingEpoch(c, err) {
		return
	}
	if err != nil {
		slog.Error("Failed to reset learning progress", "user_id", id, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Could not reset learning progress"))
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header(common.TrainingEpochHeader, strconv.Itoa(next))
	c.Status(http.StatusNoContent)
}
