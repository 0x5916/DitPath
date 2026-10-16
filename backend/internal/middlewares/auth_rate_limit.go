package middlewares

import (
	"errors"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"opencw/internal/authlimits"
	"opencw/internal/common"

	"github.com/gin-gonic/gin"
)

func AuthRequestLimit(operation authlimits.Operation, limiter *authlimits.Limiter, proxies []netip.Prefix) gin.HandlerFunc {
	if limiter == nil {
		limiter = authlimits.DefaultLimiter()
	}
	proxies = append([]netip.Prefix(nil), proxies...)
	return func(c *gin.Context) {
		if c.Request.Context().Err() != nil {
			c.Abort()
			return
		}
		source, err := authlimits.ResolveSource(c.Request, proxies)
		if err != nil {
			c.Header("Cache-Control", "no-store")
			c.AbortWithStatusJSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Internal server error"))
			return
		}
		c.Set("auth_source_ip", source.String())
		retry, err := limiter.Admit(c.Request.Context(), source, operation)
		if err == nil {
			c.Next()
			return
		}
		if c.Request.Context().Err() != nil {
			c.Abort()
			return
		}
		c.Header("Cache-Control", "no-store")
		if !errors.Is(err, authlimits.ErrRateLimited) && !errors.Is(err, authlimits.ErrCapacity) {
			c.AbortWithStatusJSON(http.StatusInternalServerError, common.NewErrorResponse(common.ErrorCodeInternalServerError, "Internal server error"))
			return
		}
		status, code, message, seconds := http.StatusServiceUnavailable, common.ErrorCodeAuthCapacityExceeded, "Authentication is temporarily busy. Please try again.", 1
		if errors.Is(err, authlimits.ErrRateLimited) {
			status, code, message = http.StatusTooManyRequests, common.ErrorCodeAuthRateLimited, "Too many authentication requests. Please wait and try again."
			seconds = int(retry / time.Second)
			if retry%time.Second > 0 {
				seconds++
			}
			if seconds < 1 {
				seconds = 1
			}
		}
		c.Header("Retry-After", strconv.Itoa(seconds))
		c.AbortWithStatusJSON(status, common.NewErrorResponse(code, message))
	}
}
