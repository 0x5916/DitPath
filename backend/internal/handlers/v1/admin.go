package handlers

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"
)

type AdminHandler struct{ DB *gorm.DB }

const directorySize = 25

type AdminAccount struct {
	ID            uuid.UUID `json:"id"`
	Username      string    `json:"username"`
	Email         string    `json:"email"`
	EmailVerified bool      `json:"email_verified"`
	CallSign      *string   `json:"call_sign"`
	CreatedAt     time.Time `json:"created_at"`
}

type directoryAccount struct {
	AdminAccount `gorm:"embedded"`
	Sessions     int64 `json:"sessions"`
	Measured     int64 `json:"measured"`
	DurationMS   int64 `json:"duration_ms"`
}

func adminCursor(c *gin.Context, raw string) (common.ReadPage, bool) {
	values := url.Values{}
	if raw != "" {
		values.Set("cursor", raw)
	}
	page, err := common.ParseReadPage(values)
	if err != nil {
		adminInvalid(c)
		return page, false
	}
	return page, true
}

func adminInvalid(c *gin.Context) {
	c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidQueryParameter, "Invalid report parameters"))
}

func adminDBFailure(c *gin.Context) {
	c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Could not read report"))
}

func (h AdminHandler) SearchUsers(c *gin.Context) {
	var input struct {
		Days   int    `json:"days"`
		Until  string `json:"until"`
		Metric string `json:"metric"`
		Search string `json:"search" binding:"max=254"`
		Cursor string `json:"cursor"`
	}
	if err := bindAuthJSON(c, &input); err != nil {
		respondAuthBindingError(c, err)
		return
	}
	page, ok := adminCursor(c, input.Cursor)
	if !ok {
		return
	}
	// Keep private search text out of SQL logs, including slow or failed queries.
	db := utils.PrivateSQL(h.DB.WithContext(c.Request.Context()))
	period, valid := newReportPeriod(input.Days, input.Until, time.Now())
	if !valid {
		adminInvalid(c)
		return
	}
	const columns = "users.id,username,email,email_verified,call_sign,users.created_at"
	query := db.Model(&models.User{}).Select(columns)
	switch input.Metric {
	case "", "all":
	case "joined":
		query = query.Where("users.created_at >= ? AND users.created_at < ?", period.start, period.end)
	case "learners", "sessions", "duration_ms":
		totals := activityIn(db, period.start, period.end).Select("user_id," + reportTotalsSQL).Group("user_id")
		query = query.Joins("JOIN (?) AS totals ON totals.user_id=users.id", totals).
			Select(columns + ",totals.sessions,totals.measured,totals.duration_ms").Where("totals.sessions > 0")
		if input.Metric == "duration_ms" {
			query = query.Where("totals.measured > 0")
		}
	default:
		adminInvalid(c)
		return
	}
	if search := strings.TrimSpace(input.Search); search != "" {
		query = query.Where("strpos(lower(username), lower(?)) > 0 OR strpos(lower(email), lower(?)) > 0", search, search)
	}
	if page.HasCursor {
		query = query.Where("(created_at,id) < (?,?)", page.Time, page.ID)
	}
	accounts := []directoryAccount{}
	if err := query.Order("created_at DESC,id DESC").Limit(directorySize + 1).Find(&accounts).Error; err != nil {
		adminDBFailure(c)
		return
	}
	var next *string
	if len(accounts) > directorySize {
		accounts = accounts[:directorySize]
		last := accounts[directorySize-1]
		cursor := common.EncodeReadCursor(last.CreatedAt, last.ID)
		next = &cursor
	}
	c.JSON(http.StatusOK, gin.H{"data": accounts, "next_cursor": next, "period": period})
}
