package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The signed review binds the account, consent generation, envelope, text and
// audience shown on screen. Previewing writes nothing. The review ID is also
// the stable queue key when a confirmation is retried.
type reviewedRecipient struct {
	ID        uuid.UUID `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Reason    string    `json:"reason"`
	ConsentID uuid.UUID `json:"consent_id"`
}

type emailReview struct {
	Message        models.OwnerMessage
	Owner          uuid.UUID
	UnsubscribeURL string
	Recipients     []reviewedRecipient
	Expires        time.Time
}

func reviewSignature(payload []byte) []byte {
	mac := hmac.New(sha256.New, configs.App.JWTSecret)
	mac.Write([]byte("Morsewell owner email review v1\x00"))
	mac.Write(payload)
	return mac.Sum(nil)
}

func sealReview(review emailReview) (string, error) {
	data, err := json.Marshal(review)
	if err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding
	return enc.EncodeToString(data) + "." + enc.EncodeToString(reviewSignature(data)), nil
}

func readReview(raw string, owner uuid.UUID) (emailReview, bool) {
	var r emailReview
	body, tag, ok := strings.Cut(raw, ".")
	enc := base64.RawURLEncoding
	data, e1 := enc.DecodeString(body)
	sig, e2 := enc.DecodeString(tag)
	if !ok || e1 != nil || e2 != nil || !hmac.Equal(sig, reviewSignature(data)) {
		return r, false
	}
	if json.Unmarshal(data, &r) != nil || r.Owner != owner {
		return r, false
	}
	return r, true
}

func mailError(c *gin.Context, status int, code string) {
	c.JSON(status, common.NewErrorResponse(code, http.StatusText(status)))
}

func mailInput(c *gin.Context, limit int64, target any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, limit))
	if err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			mailError(c, 413, common.ErrorCodeRequestBodyTooLarge)
		} else {
			mailError(c, 400, "MAIL_INVALID")
		}
		return false
	}
	if !utf8.Valid(raw) || json.Unmarshal(raw, target) != nil {
		mailError(c, 400, "MAIL_INVALID")
		return false
	}
	return true
}

func (h AdminHandler) PreviewEmail(c *gin.Context) {
	cfg := configs.App
	if !cfg.OwnerMail.Enabled {
		mailError(c, 503, "MAIL_DISABLED")
		return
	}
	var req struct {
		Recipients           []uuid.UUID `json:"recipients"`
		Topic, Subject, Body string
	}
	if !mailInput(c, 64<<10, &req) {
		return
	}
	validTopic := req.Topic == "support" || req.Topic == "product"
	validSubject := strings.TrimSpace(req.Subject) != "" && strings.IndexFunc(req.Subject, unicode.IsControl) < 0 && utf8.RuneCountInString(req.Subject) <= 180
	validBody := strings.TrimSpace(req.Body) != "" && !strings.ContainsRune(req.Body, 0) && utf8.RuneCountInString(req.Body) <= 8000
	if !validTopic || !validSubject || !validBody || len(req.Recipients) < 1 || len(req.Recipients) > 25 {
		mailError(c, 400, "MAIL_INVALID")
		return
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range req.Recipients {
		if id == uuid.Nil || seen[id] {
			mailError(c, 400, "MAIL_INVALID")
			return
		}
		seen[id] = true
	}
	var rows []struct {
		ID              uuid.UUID
		Username, Email string
		EmailVerified   bool
		ConsentID       *uuid.UUID
	}
	err := privateMailDB(c, h.DB).Model(&models.User{}).
		Select("users.id,users.username,users.email,users.email_verified,consent.id AS consent_id").
		Joins("LEFT JOIN email_consents consent ON consent.user_id=users.id AND consent.email=users.email AND consent.topic=?", req.Topic).
		Where("users.id IN ?", req.Recipients).Scan(&rows).Error
	if err != nil {
		adminDBFailure(c)
		return
	}
	byID := map[uuid.UUID]reviewedRecipient{}
	for _, row := range rows {
		r := reviewedRecipient{ID: row.ID, Username: row.Username, Email: row.Email}
		switch {
		case !row.EmailVerified:
			r.Reason = "unverified"
		case row.ConsentID == nil:
			r.Reason = "opted_out"
		default:
			r.ConsentID = *row.ConsentID
		}
		byID[row.ID] = r
	}
	recipients := make([]reviewedRecipient, 0, len(req.Recipients))
	eligible := 0
	for _, id := range req.Recipients {
		r, ok := byID[id]
		if !ok {
			r = reviewedRecipient{ID: id, Reason: "unavailable"}
		}
		if r.Reason == "" {
			eligible++
		}
		recipients = append(recipients, r)
	}
	why := "You opted in to Morsewell support follow-ups."
	if req.Topic == "product" {
		why = "You opted in to Morsewell product updates."
	}
	msg := models.OwnerMessage{
		ID: uuid.New(), Topic: req.Topic, Subject: req.Subject, Body: req.Body,
		Sender: cfg.ResendFromEmail, ReplyTo: cfg.OwnerMail.ReplyTo,
		Footer: why + "\n" + cfg.OwnerMail.Footer,
	}
	review := ""
	if eligible > 0 {
		review, err = sealReview(emailReview{
			Message: msg, Owner: utils.MustGetUser(c).ID, UnsubscribeURL: cfg.OwnerMail.UnsubscribeURL,
			Recipients: recipients, Expires: time.Now().Add(15 * time.Minute),
		})
		if err != nil {
			adminDBFailure(c)
			return
		}
	}
	c.JSON(200, gin.H{"review": review, "from": msg.Sender, "reply_to": msg.ReplyTo, "footer": msg.Footer, "recipients": recipients})
}

func (h AdminHandler) QueueEmail(c *gin.Context) {
	var input struct{ Review string }
	if !mailInput(c, 256<<10, &input) {
		return
	}
	review, ok := readReview(input.Review, utils.MustGetUser(c).ID)
	if !ok {
		mailError(c, 400, "MAIL_INVALID")
		return
	}
	msg := review.Message
	msg.OwnerID = review.Owner
	msg.UnsubscribeURL = review.UnsubscribeURL
	db := privateMailDB(c, h.DB)
	var exists int64
	if err := db.Model(&models.OwnerMessage{}).Where("id=? AND owner_id=?", msg.ID, msg.OwnerID).Count(&exists).Error; err != nil {
		adminDBFailure(c)
		return
	}
	if exists > 0 {
		c.JSON(200, gin.H{"id": msg.ID})
		return
	}
	if !configs.App.OwnerMail.Enabled {
		mailError(c, 503, "MAIL_DISABLED")
		return
	}
	if !time.Now().Before(review.Expires) {
		mailError(c, 409, "MAIL_REVIEW_EXPIRED")
		return
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		insert := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&msg)
		if insert.Error != nil || insert.RowsAffected == 0 {
			return insert.Error
		}
		rows := make([]models.OwnerRecipient, 0, len(review.Recipients))
		for _, r := range review.Recipients {
			status := "queued"
			if r.Reason != "" {
				status = "skipped"
			}
			rows = append(rows, models.OwnerRecipient{
				MessageID: msg.ID, UserID: r.ID, ConsentID: r.ConsentID, Username: r.Username, Email: r.Email,
				NextAttempt: msg.CreatedAt, Status: status, Reason: r.Reason,
			})
		}
		return tx.Create(&rows).Error
	})
	if err != nil {
		adminDBFailure(c)
		return
	}
	c.JSON(202, gin.H{"id": msg.ID})
}

func (h AdminHandler) ListEmail(c *gin.Context) {
	if len(c.Request.URL.Query()["cursor"]) > 1 {
		adminInvalid(c)
		return
	}
	page, ok := adminCursor(c, c.Query("cursor"))
	if !ok {
		return
	}
	query := privateMailDB(c, h.DB).Model(&models.OwnerMessage{}).Where("owner_id=?", utils.MustGetUser(c).ID)
	if page.HasCursor {
		query = query.Where("(created_at,id)<(?,?)", page.Time, page.ID)
	}
	type summary struct {
		ID        uuid.UUID `json:"id"`
		Subject   string    `json:"subject"`
		Topic     string    `json:"topic"`
		CreatedAt time.Time `json:"created_at"`
	}
	rows := []summary{}
	if err := query.Select("id,subject,topic,created_at").Order("created_at DESC,id DESC").Limit(directorySize + 1).Scan(&rows).Error; err != nil {
		adminDBFailure(c)
		return
	}
	var next *string
	if len(rows) > directorySize {
		rows = rows[:directorySize]
		last := rows[directorySize-1]
		cursor := common.EncodeReadCursor(last.CreatedAt, last.ID)
		next = &cursor
	}
	c.JSON(200, gin.H{"data": rows, "next_cursor": next})
}

func (h AdminHandler) EmailDetail(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		adminInvalid(c)
		return
	}
	db := privateMailDB(c, h.DB)
	var msg models.OwnerMessage
	err = db.Take(&msg, "id=? AND owner_id=?", id, utils.MustGetUser(c).ID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		mailError(c, 404, "MAIL_NOT_FOUND")
		return
	}
	if err != nil {
		adminDBFailure(c)
		return
	}
	rows := []models.OwnerRecipient{}
	if err := db.Where("message_id=?", id).Order("username,user_id").Find(&rows).Error; err != nil {
		adminDBFailure(c)
		return
	}
	c.JSON(200, struct {
		models.OwnerMessage
		Recipients []models.OwnerRecipient `json:"recipients"`
	}{msg, rows})
}
