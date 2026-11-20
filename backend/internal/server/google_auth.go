package server

import (
	"context"
	"mime"
	"net/http"
	"net/netip"
	"strings"

	"morsewell/internal/authlimits"
	"morsewell/internal/common"
	"morsewell/internal/configs"
	"morsewell/internal/googleauth"
	handlers "morsewell/internal/handlers/v1"
	"morsewell/internal/middlewares"
	"morsewell/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func isGoogleAuthPath(path string) bool {
	return path == "/v1/auth/google" || path == "/v1/auth/google/register" || isGoogleLinkPath(path)
}

func isGoogleLinkPath(path string) bool {
	return path == "/v1/auth/google/link" || path == "/v1/auth/google/link/challenge"
}

// googleCORS handles only the Google endpoints; other routes retain their
// existing policy. In particular, debug mode cannot enable arbitrary origins.
func googleCORS(c *gin.Context) bool {
	path := c.Request.URL.Path
	deletion := path == "/v1/user/me" && ((c.Request.Method == http.MethodDelete && c.GetHeader("X-OpenCW-Auth") != "") ||
		(c.Request.Method == http.MethodOptions && strings.Contains(strings.ToLower(c.GetHeader("Access-Control-Request-Headers")), "x-opencw-auth")))
	challenge := path == "/v1/user/deletion-challenge"
	if !isGoogleAuthPath(path) && !deletion && !challenge {
		return false
	}
	method := http.MethodPost
	if deletion {
		method = http.MethodDelete
	}
	allowed := configs.App.GoogleClientID != "" && len(c.Request.Header.Values("Origin")) == 1 && configs.App.GoogleOriginAllowed(c.GetHeader("Origin"))
	c.Header("Vary", "Origin")
	if allowed {
		c.Header("Access-Control-Allow-Origin", c.GetHeader("Origin"))
		c.Header("Access-Control-Allow-Methods", method+", OPTIONS")
		headers := "Content-Type, X-OpenCW-Auth"
		if isGoogleLinkPath(path) || deletion || challenge {
			headers += ", Authorization"
		}
		c.Header("Access-Control-Allow-Headers", headers)
		c.Header("Access-Control-Expose-Headers", "Retry-After")
	}
	if c.Request.Method == http.MethodOptions {
		c.Header("Cache-Control", "no-store")
		if !allowed || c.GetHeader("Access-Control-Request-Method") != method {
			c.AbortWithStatusJSON(http.StatusForbidden, common.NewErrorResponse(common.ErrorCodeGoogleRequestRejected, "Google sign-in request rejected."))
		} else {
			c.AbortWithStatus(http.StatusNoContent)
		}
	} else {
		c.Next()
	}
	return true
}

func registerAccountDeletionRoutes(v1 *gin.RouterGroup, db *gorm.DB, work *utils.PasswordWork, limiter *authlimits.Limiter, proxies []netip.Prefix, verify func(context.Context, string, string) (googleauth.Identity, error)) {
	handler := handlers.GoogleAuthHandler{DB: db, Passwords: work, Verify: verify}
	user := v1.Group("/user", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if c.Request.Method == http.MethodPost || len(c.Request.Header.Values("X-OpenCW-Auth")) != 0 {
			googleRequestProtection(c)
			return
		}
		if origin := c.GetHeader("Origin"); origin != "" && (len(c.Request.Header.Values("Origin")) != 1 || !isCORSAllowed(origin)) {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		if c.ContentType() != "application/json" {
			c.AbortWithStatus(http.StatusUnsupportedMediaType)
		}
	}, middlewares.AuthRequired(), middlewares.AuthRequestLimit(authlimits.Login, limiter, proxies), middlewares.LoadUser(db))
	user.POST("/deletion-challenge", handler.DeletionChallenge)
	user.DELETE("/me", handler.DeleteAccount)
}

func googleRequestProtection(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if configs.App.GoogleClientID == "" {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, common.NewErrorResponse(common.ErrorCodeGoogleSignInDisabled, "Google sign-in is not configured."))
		return
	}
	if len(c.Request.Header.Values("Origin")) != 1 || !configs.App.GoogleOriginAllowed(c.GetHeader("Origin")) || len(c.Request.Header.Values("X-OpenCW-Auth")) != 1 || c.GetHeader("X-OpenCW-Auth") != "google" {
		c.AbortWithStatusJSON(http.StatusForbidden, common.NewErrorResponse(common.ErrorCodeGoogleRequestRejected, "Google sign-in request rejected."))
		return
	}
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		c.AbortWithStatusJSON(http.StatusUnsupportedMediaType, common.NewErrorResponse(common.ErrorCodeGoogleJSONRequired, "Google sign-in requires JSON."))
		return
	}
	c.Next()
}

func registerGoogleAuthRoutes(auth *gin.RouterGroup, db *gorm.DB, work *utils.PasswordWork, limiter *authlimits.Limiter, proxies []netip.Prefix, verify func(context.Context, string, string) (googleauth.Identity, error)) {
	handler := handlers.GoogleAuthHandler{DB: db, Passwords: work, Verify: verify}
	auth.POST("/google", googleRequestProtection, middlewares.AuthRequestLimit(authlimits.Login, limiter, proxies), handler.Login)
	auth.POST("/google/register", googleRequestProtection, middlewares.AuthRequestLimit(authlimits.Registration, limiter, proxies), handler.Register)
	link := auth.Group("/google/link", googleRequestProtection, middlewares.AuthRequired(),
		middlewares.AuthRequestLimit(authlimits.Login, limiter, proxies), middlewares.LoadUser(db))
	link.POST("/challenge", handler.LinkChallenge)
	link.POST("", handler.Link)
}
