package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Singapore has used UTC+8 throughout the lifetime of Morsewell.
var singapore = time.FixedZone("SGT", 8*60*60)

type reportPeriod struct {
	Days       int    `json:"days"`
	From       string `json:"from"`
	Through    string `json:"through"`
	Until      string `json:"until"`
	start, end time.Time
}

func newReportPeriod(days int, until string, now time.Time) (reportPeriod, bool) {
	if days == 0 {
		days = 30
	}
	if days != 7 && days != 30 && days != 90 {
		return reportPeriod{}, false
	}
	year, month, day := now.In(singapore).Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, singapore)
	end := today
	if until != "" {
		var err error
		end, err = time.ParseInLocation(time.DateOnly, until, singapore)
		if err != nil || end.After(today) || end.Year() < 1970 {
			return reportPeriod{}, false
		}
	}
	start := end.AddDate(0, 0, -days)
	return reportPeriod{days, start.Format(time.DateOnly), end.AddDate(0, 0, -1).Format(time.DateOnly), end.Format(time.DateOnly), start, end}, true
}

func requestPeriod(c *gin.Context) (reportPeriod, bool) {
	values := c.Request.URL.Query()
	days, err := strconv.Atoi(c.DefaultQuery("days", "30"))
	period, ok := newReportPeriod(days, c.Query("until"), time.Now())
	if err != nil || days == 0 || !ok || len(values["days"]) > 1 || len(values["until"]) > 1 {
		adminInvalid(c)
		return reportPeriod{}, false
	}
	return period, true
}

// Read native and mirrored terminal records and any live legacy progress not yet
// mirrored. The ordinary account history reader bootstraps on read, which an
// administrative report must never do.
const reportSessions = `
 SELECT s.id, s.user_id, s.occurred_at,
   CASE WHEN s.source_kind='legacy_v1' THEN 'legacy' ELSE s.mode END AS kind,
   s.status,s.lesson,s.char_wpm,s.eff_wpm,s.accuracy,
   CASE WHEN s.status='completed' AND s.ended_at >= s.started_at
     THEN floor(extract(epoch FROM (s.ended_at - s.started_at))*1000)::bigint END AS duration_ms
 FROM training_sessions s
 UNION ALL
 SELECT p.id,p.user_id,coalesce(p.client_created_at,p.created_at),'legacy',
   'completed',p.lesson,p.char_wpm,p.eff_wpm,p.accuracy,NULL::bigint
 FROM lesson_progress p
 WHERE p.deleted_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM training_sessions s WHERE s.user_id=p.user_id
    AND s.source_kind='legacy_v1' AND s.source_record_id=p.id)`

// One activity stream defines both the overview and the accounts contributing
// to it. Signup observations carry no duration or training mode.
const reportActivity = `
 SELECT u.id AS user_id,u.created_at AS occurred_at,'signup' AS kind,NULL::bigint AS duration_ms
 FROM users u WHERE u.deleted_at IS NULL
 UNION ALL
 SELECT s.user_id,s.occurred_at,s.kind,s.duration_ms
 FROM (` + reportSessions + `) s JOIN users u ON u.id=s.user_id
 WHERE u.deleted_at IS NULL AND s.status='completed'`

type ReportTotals struct {
	Joined     int64 `json:"joined"`
	Learners   int64 `json:"learners"`
	Sessions   int64 `json:"sessions"`
	Guided     int64 `json:"guided"`
	Practice   int64 `json:"practice"`
	Legacy     int64 `json:"legacy"`
	Measured   int64 `json:"measured"`
	DurationMS int64 `json:"duration_ms"`
}

const reportTotalsSQL = `
 count(*) FILTER (WHERE kind='signup') AS joined,
 count(DISTINCT user_id) FILTER (WHERE kind<>'signup') AS learners,
 count(*) FILTER (WHERE kind<>'signup') AS sessions,
 count(*) FILTER (WHERE kind='guided') AS guided,
 count(*) FILTER (WHERE kind='practice') AS practice,
 count(*) FILTER (WHERE kind='legacy') AS legacy,
 count(duration_ms) AS measured,coalesce(sum(duration_ms),0)::bigint AS duration_ms`

func activityIn(db *gorm.DB, start, end time.Time) *gorm.DB {
	return db.Table("(?) AS a", db.Raw(reportActivity)).Where("occurred_at >= ? AND occurred_at < ?", start, end)
}

func (h AdminHandler) Overview(c *gin.Context) {
	period, ok := requestPeriod(c)
	if !ok {
		return
	}
	db := h.DB.WithContext(c.Request.Context())
	activity := activityIn(db, period.start.AddDate(0, 0, -period.Days), period.end).
		Select("*, occurred_at >= ? AS current_period, (occurred_at AT TIME ZONE 'Asia/Singapore')::date AS local_day", period.start)
	var rows []struct {
		CurrentPeriod bool
		Day           *string
		ReportTotals  `gorm:"embedded"`
	}
	err := db.Table("(?) AS a", activity).Select("current_period,to_char(local_day,'YYYY-MM-DD') AS day," + reportTotalsSQL).
		Group("GROUPING SETS ((current_period), (current_period,local_day))").Scan(&rows).Error
	if err != nil {
		adminDBFailure(c)
		return
	}
	var current, previous ReportTotals
	byDay := make(map[string]ReportTotals)
	for _, row := range rows {
		if row.Day != nil {
			if row.CurrentPeriod {
				byDay[*row.Day] = row.ReportTotals
			}
		} else if row.CurrentPeriod {
			current = row.ReportTotals
		} else {
			previous = row.ReportTotals
		}
	}
	type dayReport struct {
		Day string `json:"day"`
		ReportTotals
	}
	daily := make([]dayReport, 0, period.Days)
	for date := period.start; date.Before(period.end); date = date.AddDate(0, 0, 1) {
		day := date.Format(time.DateOnly)
		daily = append(daily, dayReport{day, byDay[day]})
	}
	c.JSON(http.StatusOK, gin.H{"period": period, "current": current, "previous": previous, "daily": daily})
}
