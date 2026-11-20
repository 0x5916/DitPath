// Package ownermail dispatches confirmed, privately addressed learner email.
package ownermail

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"time"

	"morsewell/internal/configs"
	"morsewell/internal/models"
	"morsewell/internal/utils"

	"github.com/google/uuid"
	"github.com/resend/resend-go/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Sender interface {
	SendWithOptions(context.Context, *resend.SendEmailRequest, *resend.SendEmailOptions) (*resend.SendEmailResponse, error)
}

type Worker struct {
	DB       *gorm.DB
	Settings configs.Config
	Sender   Sender
}

const sendTimeout = 10 * time.Second
const lease = time.Minute

func (w Worker) Run(ctx context.Context) {
	interval := time.Minute
	if w.Settings.OwnerMail.Enabled {
		interval = time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var nextSweep time.Time
	for {
		now := time.Now()
		if !now.Before(nextSweep) {
			// A paused sender or a long provider backoff may leave an expired
			// attempt well behind queued work. Record uncertainty even while paused.
			if err := w.expire(ctx, now); err != nil && ctx.Err() == nil {
				slog.Error("Could not expire owner mail attempts")
			}
			nextSweep = now.Add(time.Minute)
		}
		if w.Settings.OwnerMail.Enabled {
			if _, err := w.ProcessOne(ctx); err != nil && ctx.Err() == nil {
				slog.Error("Owner mail queue operation failed")
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w Worker) expire(ctx context.Context, now time.Time) error {
	return utils.PrivateSQL(w.DB.WithContext(ctx)).Model(&models.OwnerRecipient{}).
		Where("status='sending' AND first_attempt <= ?", now.Add(-24*time.Hour)).
		Updates(map[string]any{"status": "unknown", "reason": "retry_expired"}).Error
}

// Claim the attempt durably BEFORE touching the provider. If the process dies
// or a response cannot be committed, another worker recovers the same payload
// and key after the lease. A stale worker cannot overwrite its successor.
func (w Worker) ProcessOne(ctx context.Context) (bool, error) {
	if !w.Settings.OwnerMail.Enabled {
		return false, nil
	}
	db := utils.PrivateSQL(w.DB.WithContext(ctx))
	var r models.OwnerRecipient
	var ambiguous bool
	err := db.Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		selection := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status IN ? AND next_attempt <= ?", []string{"queued", "sending"}, now).
			Order("next_attempt,message_id,user_id").Limit(1).Find(&r)
		if selection.Error != nil {
			return selection.Error
		}
		if selection.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		ambiguous = r.Status == "sending"
		if r.FirstAttempt == nil {
			r.FirstAttempt = &now
		}
		r.Attempts++
		return tx.Model(&r).Updates(map[string]any{"status": "sending", "first_attempt": r.FirstAttempt, "attempts": r.Attempts, "next_attempt": now.Add(lease)}).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		var msg models.OwnerMessage
		err := tx.Take(&msg, "id=?", r.MessageID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		// Account erasure locks the user before deleting queued recipients.
		// Take account and consent locks in that same order before dispatch.
		consent, reason, err := w.eligible(tx, msg, r)
		if err != nil {
			return err
		}
		var current models.OwnerRecipient
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("message_id=? AND user_id=? AND attempts=? AND status='sending'", r.MessageID, r.UserID, r.Attempts).Take(&current).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		finish := func(status, reason string) error {
			return tx.Model(&r).Updates(map[string]any{"status": status, "reason": reason}).Error
		}
		if reason != "" {
			if ambiguous {
				return finish("unknown", reason)
			}
			return finish("skipped", reason)
		}
		if !time.Now().Add(sendTimeout).Before(r.FirstAttempt.Add(24 * time.Hour)) {
			if ambiguous {
				return finish("unknown", "retry_expired")
			}
			return finish("failed", "retry_expired")
		}
		link := msg.UnsubscribeURL + "?token=" + consent.Token.String()
		email := resend.SendEmailRequest{
			From: msg.Sender, To: []string{r.Email}, ReplyTo: msg.ReplyTo, Subject: msg.Subject,
			Text:    msg.Body + "\n\n" + msg.Footer + "\nUnsubscribe: " + link,
			Headers: map[string]string{"List-Unsubscribe": "<" + link + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}}
		key := "owner-email/" + msg.ID.String() + "/" + r.UserID.String()
		call, cancel := context.WithTimeout(ctx, sendTimeout)
		defer cancel()
		response, sendErr := w.Sender.SendWithOptions(call, &email, &resend.SendEmailOptions{IdempotencyKey: key})
		if sendErr == nil && response != nil && response.Id != "" {
			return tx.Model(&r).Updates(map[string]any{"status": "accepted", "reason": "", "provider_id": response.Id}).Error
		}
		var rejected *resend.ResendError
		if errors.As(sendErr, &rejected) && rejected.StatusCode >= 400 && rejected.StatusCode < 500 && rejected.StatusCode != 408 && rejected.StatusCode != 409 {
			if ambiguous {
				return finish("unknown", "provider_rejected")
			}
			return finish("failed", "provider_rejected")
		}
		delay := time.Second * time.Duration(1<<min(r.Attempts, 10))
		status := "sending" // network, 5xx, conflicting request in progress, or missing acknowledgement
		var limited *resend.RateLimitError
		if errors.As(sendErr, &limited) {
			if !ambiguous {
				status = "queued"
			}
			if seconds, err := strconv.Atoi(limited.RetryAfter); err == nil && seconds > 0 {
				delay = max(delay, time.Duration(min(seconds, 86400))*time.Second)
			}
		}
		return tx.Model(&r).Updates(map[string]any{"status": status, "next_attempt": time.Now().Add(delay)}).Error
	})
	return true, err
}

// Hold shared account and consent locks for the bounded dispatch so address
// changes and unsubscribe commits cannot slip between validation and handoff.
func (w Worker) eligible(tx *gorm.DB, msg models.OwnerMessage, r models.OwnerRecipient) (models.EmailConsent, string, error) {
	var consent models.EmailConsent
	if !w.Settings.CanLookupUsers(msg.OwnerID) {
		return consent, "owner_changed", nil
	}
	var users []models.User
	err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Select("id,email,email_verified").Where("id IN ?", []uuid.UUID{msg.OwnerID, r.UserID}).Order("id").Find(&users).Error
	if err != nil {
		return consent, "", err
	}
	ownerFound := false
	var recipient *models.User
	for i := range users {
		if users[i].ID == msg.OwnerID {
			ownerFound = true
		}
		if users[i].ID == r.UserID {
			recipient = &users[i]
		}
	}
	if !ownerFound {
		return consent, "owner_changed", nil
	}
	if recipient == nil {
		return consent, "unavailable", nil
	}
	if recipient.Email != r.Email {
		return consent, "changed", nil
	}
	if !recipient.EmailVerified {
		return consent, "unverified", nil
	}
	err = tx.Clauses(clause.Locking{Strength: "SHARE"}).Take(&consent, "id=? AND user_id=? AND email=? AND topic=?", r.ConsentID, r.UserID, r.Email, msg.Topic).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return consent, "opted_out", nil
	}
	return consent, "", err
}
