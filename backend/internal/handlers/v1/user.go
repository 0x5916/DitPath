package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type UserHandler struct {
	DB *gorm.DB
}

func (h UserHandler) GetUserInfo(c *gin.Context) {
	user := utils.MustGetUser(c)

	c.JSON(http.StatusOK, common.UserInfoResponse{
		CallSign:      user.CallSign,
		Username:      user.Username,
		Email:         user.Email,
		EmailVerified: user.EmailVerified,
		CreatedAt:     user.CreatedAt,
	})
}

func (h UserHandler) GetOtherUserInfo(c *gin.Context) {
	username := c.Param("username")

	var user models.User
	if err := h.DB.Take(&user, "username = ?", username).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, common.NewErrorResponse(common.ErrorCodeUserNotFound, "User not found"))
		} else {
			slog.Error("GetOtherUserInfo DB error", "username", username, "err", err)
			c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Internal server error"))
		}
		return
	}

	c.JSON(http.StatusOK, common.UserInfoResponse{
		CallSign:      user.CallSign,
		Username:      user.Username,
		EmailVerified: user.EmailVerified,
		CreatedAt:     user.CreatedAt,
	})
}

func (h UserHandler) UpdateCallSign(c *gin.Context) {
	user := utils.MustGetUser(c)

	var input common.UpdateCallSignInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	if err := h.DB.Model(user).Update("call_sign", input.CallSign).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeCallSignAlreadyInUse, "Call sign already in use"))
			return
		}
		slog.Error("Failed to update email", "user_id", user.ID, "call_sign", input.CallSign, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to update call sign"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Call sign updated"})
}

func (h UserHandler) UpdateEmail(c *gin.Context) {
	user := utils.MustGetUser(c)

	var input common.UpdateEmailInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}
	if user.Email == input.Email {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeEmailUnchanged, "New email must be different from current email"))
		return
	}

	var existingUser models.User
	if err := h.DB.Select("id").
		Where("email = ? AND email_verified = ? AND id <> ?", input.Email, true, user.ID).
		Take(&existingUser).Error; err == nil {
		c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeEmailVerifiedByAnother, "This email is already verified by another account. Please change your email."))
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Error("Failed to query verified user by email", "user_id", user.ID, "new_email", input.Email, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeDatabaseFailure, "Database failure"))
		return
	}

	if err := h.DB.Model(user).Updates(map[string]any{
		"email":          input.Email,
		"email_verified": false,
	}).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeEmailAlreadyInUse, "Email already in use"))
			return
		}
		slog.Error("Failed to update email", "user_id", user.ID, "new_email", input.Email, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to update email"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Email updated"})
}

func (h UserHandler) UpdatePassword(c *gin.Context) {
	user := utils.MustGetUser(c)

	var input common.UpdatePasswordInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
		return
	}

	match, err := utils.ComparePasswordAndHash(input.OldPassword, user.Password)
	if err != nil {
		slog.Error("Failed to compare password hash", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "internal error"))
		return
	}
	if !match {
		slog.Warn("Update failed: invalid password", "user_id", user.ID, "ip", c.ClientIP())
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidCredentials, "Invalid credentials"))
		return
	}

	hash, err := utils.HashPassword(input.NewPassword)
	if err != nil {
		slog.Error("Failed to hash password", "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodePasswordHashFailed, "Failed to hash password"))
		return
	}

	if err := h.DB.Model(user).Update("password", hash).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			c.JSON(http.StatusConflict, common.NewErrorResponse(common.ErrorCodeEmailAlreadyInUse, "Email already in use"))
			return
		}
		slog.Error("Failed to update password", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to update password"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Password updated"})
}
