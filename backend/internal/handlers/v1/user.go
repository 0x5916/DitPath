package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"opencw/internal/common"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type UserHandler struct {
	DB        *gorm.DB
	Passwords *utils.PasswordWork
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

func (h UserHandler) UpdateCallSign(c *gin.Context) {
	user := utils.MustGetUser(c)

	var input common.UpdateCallSignInput
	if err := bindAuthJSON(c, &input); err != nil {
		respondAuthBindingError(c, err)
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
	if err := bindAuthJSON(c, &input); err != nil {
		respondAuthBindingError(c, err)
		return
	}
	if err := changeEmailTransaction(c.Request.Context(), h.DB, user.ID, input.Email); err != nil {
		respondEmailFailure(c, err, common.ErrorCodeInternalServerError, "Failed to update email")
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Email updated"})
}

func (h UserHandler) UpdatePassword(c *gin.Context) {
	if authCanceled(c, nil) {
		return
	}
	user := utils.MustGetUser(c)

	var input common.UpdatePasswordInput
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
	match, err := reservation.Compare(input.OldPassword, user.Password)
	if authCanceled(c, err) {
		return
	}
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

	hash, err := reservation.Hash(input.NewPassword)
	reservation.Close()
	if authCanceled(c, err) {
		return
	}
	if err != nil {
		slog.Error("Failed to hash password", "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodePasswordHashFailed, "Failed to hash password"))
		return
	}

	err = changePasswordTransaction(c.Request.Context(), h.DB, user.ID, user.Password, hash)
	if authCanceled(c, err) {
		return
	}
	if errors.Is(err, utils.ErrCredentialsChanged) || errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeInvalidCredentials, "Invalid credentials"))
		return
	}
	if err != nil {
		slog.Error("Failed to update password", "user_id", user.ID, "err", err)
		c.JSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Failed to update password"))
		return
	}

	c.JSON(http.StatusOK, common.MessageResponse{Message: "Password updated"})
}
