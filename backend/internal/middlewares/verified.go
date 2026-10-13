package middlewares

import (
	"net/http"

	"opencw/internal/common"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
)

// VerifiedRequired ensures the authenticated user has a verified email address.
// It must be registered after AuthRequired and LoadUser.
func VerifiedRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		user := utils.MustGetUser(c)
		if !user.EmailVerified {
			c.JSON(http.StatusForbidden, common.NewErrorResponse(common.ErrorCodeEmailNotVerified, "Email verification required"))
			c.Abort()
			return
		}

		c.Next()
	}
}
