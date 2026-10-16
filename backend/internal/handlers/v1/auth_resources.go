package handlers

import (
	"context"
	"errors"
	"net/http"

	"opencw/internal/common"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
)

func authCanceled(c *gin.Context, err error) bool {
	if c.Request.Context().Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		c.Abort()
		return true
	}
	return false
}

func reservePasswordWork(c *gin.Context, work *utils.PasswordWork) (*utils.PasswordReservation, bool) {
	if work == nil {
		work = utils.DefaultPasswordWork()
	}
	reservation, err := work.Acquire(c.Request.Context())
	if err == nil {
		return reservation, true
	}
	if authCanceled(c, err) {
		return nil, false
	}
	c.Header("Retry-After", "1")
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusServiceUnavailable, common.NewErrorResponse(common.ErrorCodeAuthCapacityExceeded,
		"Authentication is temporarily busy. Please try again."))
	return nil, false
}
