package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"opencw/internal/common"
	"opencw/internal/models"
)

type learnerSession struct {
	ID         uuid.UUID `json:"id"`
	OccurredAt time.Time `json:"occurred_at"`
	Kind       string    `json:"kind"`
	Status     string    `json:"status"`
	Lesson     int       `json:"lesson"`
	CharWPM    *int      `json:"char_wpm"`
	EffWPM     *int      `json:"eff_wpm"`
	Accuracy   *float64  `json:"accuracy"`
	DurationMS *int64    `json:"duration_ms"`
}

func (h AdminHandler) LearnerReport(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil || len(c.Request.URL.Query()["cursor"]) > 1 {
		adminInvalid(c)
		return
	}
	period, ok := requestPeriod(c)
	if !ok {
		return
	}
	page, ok := adminCursor(c, c.Query("cursor"))
	if !ok {
		return
	}
	var account AdminAccount
	var totals ReportTotals
	var last struct{ CompletedAt *time.Time }
	sessions := []learnerSession{}
	err = h.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.User{}).Select("id,username,email,email_verified,call_sign,created_at").Where("id=?", id).Take(&account).Error; err != nil {
			return err
		}
		history := func() *gorm.DB { return tx.Table("(?) AS s", tx.Raw(reportSessions)).Where("user_id=?", id) }
		if err := history().Where("status='completed'").Select("max(occurred_at) AS completed_at").Scan(&last).Error; err != nil {
			return err
		}
		if err := activityIn(tx, period.start, period.end).Where("user_id=?", id).Select(reportTotalsSQL).Scan(&totals).Error; err != nil {
			return err
		}
		query := history().Where("occurred_at >= ? AND occurred_at < ?", period.start, period.end)
		if page.HasCursor {
			query = query.Where("(occurred_at,id) < (?,?)", page.Time, page.ID)
		}
		return query.Order("occurred_at DESC,id DESC").Limit(directorySize + 1).Scan(&sessions).Error
	}, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, common.NewErrorResponse(common.ErrorCodeUserNotFound, "Account not found"))
		return
	}
	if err != nil {
		adminDBFailure(c)
		return
	}
	var next *string
	if len(sessions) > directorySize {
		sessions = sessions[:directorySize]
		last := sessions[directorySize-1]
		cursor := common.EncodeReadCursor(last.OccurredAt, last.ID)
		next = &cursor
	}
	c.JSON(http.StatusOK, gin.H{"period": period, "account": account, "totals": totals, "last_completed_at": last.CompletedAt, "sessions": sessions, "next_cursor": next})
}
