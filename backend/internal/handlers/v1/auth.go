package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AuthHandler struct {
	DB           *gorm.DB
	Passwords    *utils.PasswordWork
	GenerateCode func() (string, error)
	SendEmail    func(string, string) error
	Now          func() time.Time // nil uses PostgreSQL's wall clock
}

func (h *AuthHandler) Register(c *gin.Context) {
	if authCanceled(c, nil) {
		return
	}
	var input common.RegisterInput
	if err := bindAuthJSON(c, &input); err != nil {
		if authCanceled(c, err) {
			return
		}
		respondAuthBindingError(c, err)
		return
	}

	reservation, admitted := reservePasswordWork(c, h.Passwords)
	if !admitted {
		return
	}
	defer reservation.Close()
	db := h.DB.WithContext(c.Request.Context())
	var user models.User
	err := db.Select("id").Where("username = ?", input.Username).Take(&user).Error
	if authCanceled(c, err) {
		return
	}
	if err == nil {
		c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeUsernameAlreadyInUse, "Username already exists"))
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Error("Failed to query user by username", "err", err, "username", input.Username)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	err = db.Select("id").Where("email = ? AND email_verified = ?", input.Email, true).Take(&user).Error
	if authCanceled(c, err) {
		return
	}
	if err == nil {
		c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeEmailVerifiedByAnother, "This email is already verified by another account. Please change your email."))
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Error("Failed to query verified user by email", "err", err, "email", input.Email)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	hash, err := reservation.Hash(input.Password)
	reservation.Close()
	if authCanceled(c, err) {
		return
	}
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
	err = db.Create(&user).Error
	if authCanceled(c, err) {
		return
	}
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeConflict, "Registration conflict, please try again"))
			return
		}

		slog.Error("Failed to create user", "err", err, "username", input.Username)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to create user"))
		return
	}

	rawToken, accessToken, err := utils.IssueTokenPair(db, user.ID, user.Password, time.Now())
	if authCanceled(c, err) {
		return
	}
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
	if authCanceled(c, nil) {
		return
	}
	var input common.LoginInput
	if err := bindAuthJSON(c, &input); err != nil {
		if authCanceled(c, err) {
			return
		}
		respondAuthBindingError(c, err)
		return
	}

	reservation, admitted := reservePasswordWork(c, h.Passwords)
	if !admitted {
		return
	}
	defer reservation.Close()
	db := h.DB.WithContext(c.Request.Context())
	var queryString string
	if strings.Contains(input.Identifier, "@") {
		queryString = "email = ?"
	} else {
		queryString = "username = ?"
	}

	var user models.User
	err := db.Take(&user, queryString, input.Identifier).Error
	if authCanceled(c, err) {
		return
	}
	if err != nil {
		slog.Warn("Login failed", "identifier", input.Identifier, "ip", c.GetString("auth_source_ip"))
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidCredentials, "Invalid credentials"))
		return
	}

	match, err := reservation.Compare(input.Password, user.Password)
	reservation.Close()
	if authCanceled(c, err) {
		return
	}
	if err != nil {
		slog.Error("Failed to compare password hash", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "internal error"))
		return
	}
	if !match {
		slog.Warn("Login failed: invalid password", "user_id", user.ID, "ip", c.GetString("auth_source_ip"))
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidCredentials, "Invalid credentials"))
		return
	}

	rawToken, accessToken, err := utils.IssueTokenPair(db, user.ID, user.Password, time.Now())
	if authCanceled(c, err) {
		return
	}
	if errors.Is(err, utils.ErrCredentialsChanged) || errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidCredentials, "Invalid credentials"))
		return
	}
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
	userID := utils.MustGetUser(c).ID
	otp, err := h.issueVerification(c.Request.Context(), userID)
	if err != nil {
		respondEmailFailure(c, err, common.ErrorCodeDatabaseFailure, "Database failure")
		return
	}
	send := h.SendEmail
	if send == nil {
		send = utils.SendVerificationEmail
	}
	if err := send(otp.Email, otp.Code); err != nil {
		slog.Error("Verification email delivery failed", "user_id", userID)
		if err := cleanupIssuedVerification(h.DB, userID, otp.ID); err != nil {
			slog.Error("Failed to invalidate undelivered verification", "user_id", userID, "err", err)
		}
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeVerificationSendFailed, "Failed to send verification email"))
		return
	}
	c.JSON(http.StatusOK, common.MessageResponse{Message: "Verification email sent"})
}

func (h *AuthHandler) VerifyEmail(c *gin.Context) {
	var input common.VerifyEmailInput
	bindingErr := bindAuthJSON(c, &input)
	if errors.Is(bindingErr, errAuthBodyTooLarge) {
		respondAuthBindingError(c, bindingErr)
		return
	}
	if err := h.verifyEmailTransaction(c.Request.Context(), utils.MustGetUser(c).ID, input, bindingErr); err != nil {
		respondEmailFailure(c, err, common.ErrorCodeDatabaseFailure, "Database failure")
		return
	}
	c.JSON(http.StatusOK, common.MessageResponse{Message: "Email verified"})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	var input common.RefreshInput
	if err := bindAuthJSON(c, &input); err != nil {
		respondAuthBindingError(c, err)
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
	if err := bindAuthJSON(c, &input); err != nil {
		respondAuthBindingError(c, err)
		return
	}
	hashedInput, err := utils.HashStringRefreshToken(input.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidToken, "Invalid refresh token"))
		return
	}
	rawToken, accessToken, err := refreshTokenPair(c.Request.Context(), h.DB, hashedInput)
	if authCanceled(c, err) {
		return
	}
	if err != nil {
		// This fallback also covers transaction begin/commit failures, where no
		// callback-specific response could have been assigned.
		result := common.HttpErrorResponse{Status: http.StatusInternalServerError,
			Code: common.ErrorCodeInternalServerError, Err: "Failed to refresh token"}
		if errors.Is(err, common.ErrInvalidToken) {
			result = common.HttpErrorResponse{Status: http.StatusUnauthorized, Code: common.ErrorCodeInvalidToken, Err: "Invalid refresh token"}
		} else if errors.Is(err, common.ErrExpiredToken) {
			result = common.HttpErrorResponse{Status: http.StatusUnauthorized, Code: common.ErrorCodeExpiredToken, Err: "Refresh token expired"}
		} else {
			slog.Error("Refresh token transaction failed", "err", err)
		}
		c.JSON(result.Status, common.NewErrorResponse(result.Code, result.Err))
		return
	}
	c.JSON(http.StatusOK, common.AuthTokenPairResponse{RefreshToken: rawToken, AccessToken: accessToken})
}
