package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AuthHandler struct {
	DB *gorm.DB
}

func (h *AuthHandler) Register(c *gin.Context) {
	var input common.RegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	var user models.User
	if err := h.DB.Select("id").Where("username = ?", input.Username).Take(&user).Error; err == nil {
		c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeUsernameAlreadyInUse, "Username already exists"))
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Error("Failed to query user by username", "err", err, "username", input.Username)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	if err := h.DB.Select("id").Where("email = ? AND email_verified = ?", input.Email, true).Take(&user).Error; err == nil {
		c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeEmailVerifiedByAnother, "This email is already verified by another account. Please change your email."))
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Error("Failed to query verified user by email", "err", err, "email", input.Email)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	hash, err := utils.HashPassword(input.Password)
	if err != nil {
		slog.Error("Failed to hash password", "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodePasswordHashFailed, "Failed to hash password"))
		return
	}

	user = models.User{
		Username: input.Username,
		Email:    input.Email,
		Password: hash,
	}
	if err := h.DB.Create(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeConflict, "Registration conflict, please try again"))
			return
		}

		slog.Error("Failed to create user", "err", err, "username", input.Username)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to create user"))
		return
	}

	rawToken, accessToken, err := utils.IssueTokenPair(h.DB, user.ID, time.Now())
	if err != nil {
		slog.Error("Failed to issue token pair", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeTokenIssueFailed, "Failed to issue token, try to login."))
		return
	}

	c.JSON(http.StatusOK, common.AuthTokenPairResponse{
		RefreshToken: rawToken,
		AccessToken:  accessToken,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var input common.LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	var queryString string
	if strings.Contains(input.Identifier, "@") {
		queryString = "email = ?"
	} else {
		queryString = "username = ?"
	}

	var user models.User
	if err := h.DB.Take(&user, queryString, input.Identifier).Error; err != nil {
		slog.Warn("Login failed", "identifier", input.Identifier, "ip", c.ClientIP())
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidCredentials, "Invalid credentials"))
		return
	}

	match, err := utils.ComparePasswordAndHash(input.Password, user.Password)
	if err != nil {
		slog.Error("Failed to compare password hash", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "internal error"))
		return
	}
	if !match {
		slog.Warn("Login failed: invalid password", "user_id", user.ID, "ip", c.ClientIP())
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidCredentials, "Invalid credentials"))
		return
	}

	rawToken, accessToken, err := utils.IssueTokenPair(h.DB, user.ID, time.Now())
	if err != nil {
		slog.Error("Failed to issue token pair on login", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeTokenIssueFailed, "Failed to issue token"))
		return
	}

	c.JSON(http.StatusOK, common.AuthTokenPairResponse{
		RefreshToken: rawToken,
		AccessToken:  accessToken,
	})
}

func (h *AuthHandler) SendVerificationEmail(c *gin.Context) {
	user := utils.MustGetUser(c)
	now := time.Now()

	if user.EmailVerified {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeEmailAlreadyVerified, "Email is already verified"))
		return
	}

	var verifiedOwner models.User
	if err := h.DB.Select("id").
		Where("email = ? AND email_verified = ? AND id <> ?", user.Email, true, user.ID).
		Take(&verifiedOwner).Error; err == nil {
		c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeEmailVerifiedByAnother, "This email is already verified by another account. Please change your email."))
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Error("Failed to query verified owner by email", "user_id", user.ID, "email", user.Email, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	var latestOTP models.EmailOTP
	err := h.DB.Where("user_id = ?", user.ID).Order("created_at DESC").First(&latestOTP).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Error("Failed to query latest verification code", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	if err == nil {
		retryAfter := int(time.Until(latestOTP.CreatedAt.Add(time.Minute)).Seconds())
		if retryAfter > 0 {
			c.Header("Retry-After", strconv.Itoa(retryAfter+1))
			c.JSON(http.StatusTooManyRequests, common.NewErrorResponse(common.ErrorCodeVerificationRateLimited, "Please wait before requesting another verification email"))
			return
		}
	}

	code, err := utils.GenerateVerificationCode()
	if err != nil {
		slog.Error("Failed to generate verification code", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to generate verification code"))
		return
	}

	expiresAt := now.Add(10 * time.Minute)
	verification := models.EmailOTP{
		UserID:    &user.ID,
		Email:     user.Email,
		Code:      code,
		ExpiredAt: expiresAt,
		Verified:  false,
	}

	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND verified = ?", user.ID, false).Delete(&models.EmailOTP{}).Error; err != nil {
			return err
		}

		if err := tx.Create(&verification).Error; err != nil {
			return err
		}

		return nil
	}); err != nil {
		slog.Error("Failed to persist verification code", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	if err := utils.SendVerificationEmail(user.Email, code); err != nil {
		slog.Error("Failed to send verification email", "user_id", user.ID, "err", err)
		_ = h.DB.Delete(&verification).Error
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeVerificationSendFailed, "Failed to send verification email"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Verification email sent"})
}

func (h *AuthHandler) VerifyEmail(c *gin.Context) {
	user := utils.MustGetUser(c)

	if user.EmailVerified {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeEmailAlreadyVerified, "Email is already verified"))
		return
	}

	var verifiedOwner models.User
	if err := h.DB.Select("id").
		Where("email = ? AND email_verified = ? AND id <> ?", user.Email, true, user.ID).
		Take(&verifiedOwner).Error; err == nil {
		c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeEmailVerifiedByAnother, "This email is already verified by another account. Please change your email."))
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Error("Failed to query verified owner by email", "user_id", user.ID, "email", user.Email, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	var input common.VerifyEmailInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	var otp models.EmailOTP
	err := h.DB.Where("user_id = ? AND email = ? AND code = ? AND verified = ?", user.ID, user.Email, input.Code, false).
		Order("created_at DESC").
		First(&otp).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeVerificationCodeInvalid, "Invalid verification code"))
			return
		}

		slog.Error("Failed to query verification code", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	if time.Now().After(otp.ExpiredAt) {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeVerificationCodeExpired, "Verification code expired"))
		return
	}

	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&otp).Update("verified", true).Error; err != nil {
			return err
		}

		if err := tx.Model(&models.User{}).Where("id = ?", user.ID).Update("email_verified", true).Error; err != nil {
			return err
		}

		return nil
	}); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeEmailVerifiedByAnother, "This email is already verified by another account. Please change your email."))
			return
		}

		slog.Error("Failed to verify email", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Email verified"})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	var input common.RefreshInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	hashedToken, err := utils.HashStringRefreshToken(input.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidToken, "Invalid refresh token"))
		return
	}

	if err := h.DB.Model(&models.RefreshToken{}).Where("token = ?", hashedToken).Update("revoked", true).Error; err != nil {
		slog.Error("Failed to revoke refresh token on logout", "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to logout"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Logged out"})
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var input common.RefreshInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}
	now := time.Now()

	var result common.HttpErrorResponse
	var newRefreshToken models.RefreshToken
	var newRawToken string

	hashedInput, err := utils.HashStringRefreshToken(input.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidToken, "Invalid refresh token"))
		return
	}

	err = h.DB.Transaction(func(tx *gorm.DB) error {
		var refreshToken models.RefreshToken

		if err := tx.Take(&refreshToken, "token = ? AND revoked = false", hashedInput).Error; err != nil {
			result = common.HttpErrorResponse{Status: http.StatusUnauthorized, Code: common.ErrorCodeInvalidToken, Err: "Invalid refresh token"}
			return common.ErrInvalidToken
		}

		if now.After(refreshToken.ExpiresAt) {
			result = common.HttpErrorResponse{Status: http.StatusUnauthorized, Code: common.ErrorCodeExpiredToken, Err: "Refresh token expired"}
			return common.ErrExpiredToken
		}

		// Only the transaction that consumes the still-active token may rotate it.
		claim := tx.Model(&refreshToken).Where("revoked = ?", false).Update("revoked", true)
		if claim.Error != nil {
			result = common.HttpErrorResponse{Status: http.StatusInternalServerError, Code: common.ErrorCodeInternalServerError, Err: "Failed to revoke refresh token"}
			return claim.Error
		}
		if claim.RowsAffected != 1 {
			result = common.HttpErrorResponse{Status: http.StatusUnauthorized, Code: common.ErrorCodeInvalidToken, Err: "Invalid refresh token"}
			return common.ErrInvalidToken
		}

		rawToken, hashedToken, err := utils.GenerateRefreshToken()
		if err != nil {
			result = common.HttpErrorResponse{Status: http.StatusInternalServerError, Code: common.ErrorCodeInternalServerError, Err: "Failed to generate refresh token"}
			return err
		}
		newRawToken = rawToken

		newRefreshToken = models.RefreshToken{
			UserID:    refreshToken.UserID,
			Token:     hashedToken,
			ExpiresAt: now.Add(time.Hour * 24 * 30),
		}
		if err := tx.Create(&newRefreshToken).Error; err != nil {
			result = common.HttpErrorResponse{Status: http.StatusInternalServerError, Code: common.ErrorCodeInternalServerError, Err: "Failed to create new refresh token"}
			return err
		}
		return nil
	})

	if err != nil {
		if result.Status == http.StatusInternalServerError {
			slog.Error("Refresh token transaction failed", "err", err)
		} else {
			slog.Warn("Refresh failed", "reason", result.Err, "ip", c.ClientIP())
		}
		c.JSON(result.Status, common.NewErrorResponse(result.Code, result.Err))
		return
	}

	accessToken, err := utils.GenerateAccessToken(newRefreshToken.UserID, now)
	if err != nil {
		slog.Error("Failed to generate token", "user_id", newRefreshToken.UserID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeTokenIssueFailed, "Failed to generate access token"))
		return
	}

	c.JSON(http.StatusOK, common.AuthTokenPairResponse{
		RefreshToken: newRawToken,
		AccessToken:  accessToken,
	})
}
