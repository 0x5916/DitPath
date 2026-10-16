package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type emailFailure struct {
	status     int
	code       string
	message    string
	retryAfter int
	cause      error
}

func (e *emailFailure) Error() string { return e.message }
func (e *emailFailure) Unwrap() error { return e.cause }

func emailRejected(status int, code, message string) error {
	return &emailFailure{status: status, code: code, message: message}
}

func invalidVerification() error {
	return emailRejected(http.StatusBadRequest, common.ErrorCodeVerificationCodeInvalid, "Invalid verification code")
}

func expiredVerification() error {
	return emailRejected(http.StatusBadRequest, common.ErrorCodeVerificationCodeExpired, "Verification code expired")
}

// Retain SQL/error events without expanding sensitive OTP bind parameters.
type emailSQLLogger struct{ logger.Interface }

func (l emailSQLLogger) LogMode(level logger.LogLevel) logger.Interface {
	return emailSQLLogger{l.Interface.LogMode(level)}
}

func (emailSQLLogger) ParamsFilter(_ context.Context, query string, _ ...interface{}) (string, []interface{}) {
	return query, nil
}

// Every email/OTP mutation locks the account first, across API instances.
func withLockedEmailUser(ctx context.Context, db *gorm.DB, id uuid.UUID, mutate func(*gorm.DB, *models.User) error) error {
	err := utils.WithLockedUser(ctx, db.Session(&gorm.Session{Logger: emailSQLLogger{db.Logger}}), id, mutate)
	if errors.Is(err, utils.ErrUserNotFound) {
		return emailRejected(http.StatusUnauthorized, common.ErrorCodeUserNotFound, "User not found")
	}
	return err
}

const VerificationMaxFailedAttempts = 5

func exhaustedVerification(otp models.EmailOTP, now time.Time) error {
	remaining := otp.CreatedAt.Add(time.Minute).Sub(now)
	seconds := max(1, int((remaining+time.Second-1)/time.Second))
	return &emailFailure{status: http.StatusTooManyRequests, code: common.ErrorCodeVerificationAttemptsExceeded,
		message: "Too many verification attempts. Please request a new verification code.", retryAfter: seconds}
}

func checkEmailOwner(tx *gorm.DB, user *models.User, email string) error {
	var owner models.User
	err := tx.Select("id").Where("email = ? AND email_verified = true AND id <> ?", email, user.ID).Take(&owner).Error
	if err == nil {
		return emailRejected(http.StatusConflict, common.ErrorCodeEmailVerifiedByAnother,
			"This email is already verified by another account. Please change your email.")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	return &emailFailure{status: http.StatusInternalServerError, code: common.ErrorCodeDatabaseFailure, message: "Database failure", cause: err}
}

func checkUnverifiedEmail(tx *gorm.DB, user *models.User) error {
	if user.EmailVerified {
		return emailRejected(http.StatusBadRequest, common.ErrorCodeEmailAlreadyVerified, "Email is already verified")
	}
	return checkEmailOwner(tx, user, user.Email)
}

func invalidatePendingVerifications(tx *gorm.DB, id uuid.UUID) error {
	return tx.Where("user_id = ? AND verified = false", id).Delete(&models.EmailOTP{}).Error
}

func (h *AuthHandler) emailNow(tx *gorm.DB) (time.Time, error) {
	if h.Now != nil {
		return h.Now().UTC(), nil
	}
	var now time.Time
	err := tx.Raw("SELECT clock_timestamp()").Scan(&now).Error
	return now, err
}

func (h *AuthHandler) verifyEmailTransaction(ctx context.Context, id uuid.UUID, input common.VerifyEmailInput, bindingErr error) error {
	var rejection error
	err := withLockedEmailUser(ctx, h.DB, id, func(tx *gorm.DB, user *models.User) error {
		if err := checkUnverifiedEmail(tx, user); err != nil {
			return err
		}
		if bindingErr != nil {
			return emailRejected(http.StatusBadRequest, common.ErrorCodeInvalidRequestBody, "Invalid request body")
		}
		var otp models.EmailOTP
		err := tx.Where("user_id = ? AND email = ? AND verified = false", id, user.Email).
			Order("created_at DESC, id DESC").Take(&otp).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return invalidVerification()
		}
		if err != nil {
			return err
		}
		now, err := h.emailNow(tx)
		if err != nil {
			return err
		}
		if otp.FailedAttempts >= VerificationMaxFailedAttempts {
			return exhaustedVerification(otp, now)
		}
		if otp.Code != input.Code {
			if !otp.ExpiredAt.After(now) {
				return invalidVerification()
			}
			attempt := tx.Model(&models.EmailOTP{}).Where("id = ? AND verified = false AND failed_attempts < ?", otp.ID, VerificationMaxFailedAttempts).
				Update("failed_attempts", gorm.Expr("failed_attempts + 1"))
			if attempt.Error != nil {
				return attempt.Error
			}
			if attempt.RowsAffected != 1 {
				return invalidVerification()
			}
			rejection = invalidVerification()
			if otp.FailedAttempts+1 >= VerificationMaxFailedAttempts {
				rejection = exhaustedVerification(otp, now)
			}
			// An expected refusal must commit the counter; returning it here
			// would roll the transaction back and restore the guessing budget.
			return nil
		}
		claim := tx.Model(&models.EmailOTP{}).
			Where("id = ? AND user_id = ? AND email = ? AND code = ? AND verified = false AND failed_attempts < ?", otp.ID, id, user.Email, input.Code, VerificationMaxFailedAttempts)
		if h.Now == nil {
			claim = claim.Where("expired_at > clock_timestamp()")
		} else {
			claim = claim.Where("expired_at > ?", h.Now().UTC())
		}
		claim = claim.Update("verified", true)
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected != 1 {
			now, err := h.emailNow(tx)
			if err != nil {
				return err
			}
			if !otp.ExpiredAt.After(now) {
				return expiredVerification()
			}
			return invalidVerification()
		}
		verify := tx.Model(&models.User{}).Where("id = ? AND email = ? AND email_verified = false", id, otp.Email).
			Update("email_verified", true)
		if verify.Error != nil {
			return verify.Error
		}
		if verify.RowsAffected != 1 {
			return invalidVerification()
		}
		return nil
	})
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return emailRejected(http.StatusConflict, common.ErrorCodeEmailVerifiedByAnother,
			"This email is already verified by another account. Please change your email.")
	}
	if err != nil {
		return err
	}
	return rejection
}

func changeEmailTransaction(ctx context.Context, db *gorm.DB, id uuid.UUID, email string) error {
	err := withLockedEmailUser(ctx, db, id, func(tx *gorm.DB, user *models.User) error {
		if user.Email == email {
			return emailRejected(http.StatusBadRequest, common.ErrorCodeEmailUnchanged, "New email must be different from current email")
		}
		if err := checkEmailOwner(tx, user, email); err != nil {
			return err
		}
		update := tx.Model(&models.User{}).Where("id = ?", id).
			Updates(map[string]any{"email": email, "email_verified": false})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return invalidatePendingVerifications(tx, id)
	})
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return emailRejected(http.StatusConflict, common.ErrorCodeEmailAlreadyInUse, "Email already in use")
	}
	return err
}

func (h *AuthHandler) issueVerification(ctx context.Context, id uuid.UUID) (models.EmailOTP, error) {
	var otp models.EmailOTP
	err := withLockedEmailUser(ctx, h.DB, id, func(tx *gorm.DB, user *models.User) error {
		if err := checkUnverifiedEmail(tx, user); err != nil {
			return err
		}
		now, err := h.emailNow(tx)
		if err != nil {
			return err
		}
		var latest models.EmailOTP
		err = tx.Unscoped().Where("user_id = ?", id).Order("created_at DESC, id DESC").Take(&latest).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil {
			remaining := latest.CreatedAt.Add(time.Minute).Sub(now)
			if remaining > 0 {
				seconds := int((remaining + time.Second - 1) / time.Second)
				return &emailFailure{status: http.StatusTooManyRequests, code: common.ErrorCodeVerificationRateLimited,
					message: "Please wait before requesting another verification email", retryAfter: seconds}
			}
		}
		generate := h.GenerateCode
		if generate == nil {
			generate = utils.GenerateVerificationCode
		}
		code, err := generate()
		if err != nil {
			return &emailFailure{status: http.StatusInternalServerError, code: common.ErrorCodeInternalServerError,
				message: "Failed to generate verification code", cause: err}
		}
		if err := invalidatePendingVerifications(tx, id); err != nil {
			return err
		}
		otp = models.EmailOTP{Base: models.Base{CreatedAt: now}, UserID: &id, Email: user.Email, Code: code, ExpiredAt: now.Add(10 * time.Minute)}
		return tx.Create(&otp).Error
	})
	return otp, err
}

func cleanupIssuedVerification(db *gorm.DB, id, otpID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := withLockedEmailUser(ctx, db, id, func(tx *gorm.DB, _ *models.User) error {
		return tx.Where("id = ? AND user_id = ? AND verified = false", otpID, id).Delete(&models.EmailOTP{}).Error
	})
	var failure *emailFailure
	if errors.As(err, &failure) && failure.code == common.ErrorCodeUserNotFound {
		return nil
	}
	return err
}

func respondEmailFailure(c *gin.Context, err error, fallbackCode, fallbackMessage string) {
	var failure *emailFailure
	if errors.As(err, &failure) {
		if failure.status >= http.StatusInternalServerError {
			slog.Error("Email operation failed", "user_id", utils.MustGetUser(c).ID, "code", failure.code, "err", failure.cause)
		}
		if failure.retryAfter > 0 {
			c.Header("Retry-After", strconv.Itoa(failure.retryAfter))
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(failure.status, common.NewErrorResponse(failure.code, failure.message))
		return
	}
	slog.Error("Email transaction failed", "user_id", utils.MustGetUser(c).ID, "err", err)
	c.JSON(http.StatusInternalServerError, common.NewErrorResponse(fallbackCode, fallbackMessage))
}
