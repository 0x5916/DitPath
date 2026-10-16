package middlewares

import (
	"log/slog"
	"net/http"

	"opencw/internal/common"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func LoadUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Context().Err() != nil {
			c.Abort()
			return
		}
		userID := c.MustGet("userID").(uuid.UUID)

		var user models.User
		if err := db.WithContext(c.Request.Context()).Take(&user, userID).Error; err != nil {
			if c.Request.Context().Err() != nil {
				c.Abort()
				return
			}
			slog.Warn("LoadUser failed: user not found", "user_id", userID, "err", err)
			c.JSON(http.StatusUnauthorized, common.NewErrorResponse(common.ErrorCodeUserNotFound, "User not found"))
			c.Abort()
			return
		}

		c.Set("user", &user)
		c.Next()
	}
}
