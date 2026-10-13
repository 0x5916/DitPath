package server

import (
	"net/http"
	"net/http/pprof"
	"time"

	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/databases"
	handlers "opencw/internal/handlers/v1"
	v2handlers "opencw/internal/handlers/v2"
	"opencw/internal/middlewares"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
)

const defaultProductionOrigin = "https://opencw.net"

func RouterV1Setup(engine *gin.Engine) {
	v1 := engine.Group("/v1")

	// Health check endpoint
	v1.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"timestamp": time.Now().Unix(),
		})
	})

	authHandler := handlers.AuthHandler{DB: databases.DB}
	auth := v1.Group("/auth")
	auth.POST("/register", authHandler.Register)
	auth.POST("/login", authHandler.Login)
	auth.POST("/logout", authHandler.Logout)
	auth.POST("/refresh", authHandler.Refresh)

	protected := v1.Group("/")
	protected.Use(middlewares.AuthRequired())
	protected.Use(middlewares.LoadUser(databases.DB))

	authProtected := protected.Group("/auth")
	authProtected.POST("/send-verification-email", authHandler.SendVerificationEmail)
	authProtected.POST("/verify-email", authHandler.VerifyEmail)

	settingsHandler := handlers.SettingsHandler{DB: databases.DB}
	settings := protected.Group("/settings")
	settings.GET("/all", settingsHandler.GetAllSettings)
	settings.GET("/cw", settingsHandler.GetCWSettings)
	settings.GET("/page", settingsHandler.GetPageSettings)
	settings.POST("/cw", settingsHandler.UpdateCWSettings)
	settings.POST("/page", settingsHandler.UpdatePageSettings)

	userHandler := handlers.UserHandler{DB: databases.DB}
	user := protected.Group("/user")
	user.GET("/me", userHandler.GetUserInfo)
	user.PUT("/callsign", userHandler.UpdateCallSign)
	user.PUT("/email", userHandler.UpdateEmail)
	user.PUT("/password", userHandler.UpdatePassword)

	progressHandler := handlers.ProgressHandler{DB: databases.DB}
	cwProgress := protected.Group("/cw")
	cwProgress.GET("/progress", progressHandler.GetAllProgress)
	cwProgress.PUT("/progress", progressHandler.AddProgress)

	forumHandler := handlers.ForumHandler{DB: databases.DB}
	forumCreateRateLimit := middlewares.ForumCreateRateLimit()

	// Forum reads are public.
	forum := v1.Group("/forum")
	forum.GET("/threads", forumHandler.ListThreads)
	forum.GET("/threads/:id", forumHandler.GetThread)
	forum.GET("/threads/:id/replies", forumHandler.GetThreadReplies)

	// Creating forum content requires a verified email; deleting requires
	// ownership (checked in the handlers).
	forumProtected := protected.Group("/forum")
	forumProtected.POST("/threads", middlewares.VerifiedRequired(), forumCreateRateLimit, forumHandler.CreateThread)
	forumProtected.POST("/threads/:id/replies", middlewares.VerifiedRequired(), forumCreateRateLimit, forumHandler.CreateReply)
	forumProtected.DELETE("/threads/:id", forumHandler.DeleteThread)
	forumProtected.DELETE("/replies/:id", forumHandler.DeleteReply)

	protected.GET("/hello", func(c *gin.Context) {
		user := c.MustGet("user").(*models.User)
		c.JSON(http.StatusOK, common.MessageResponse{Message: "Hello, authenticated user {" + user.Username + "}!"})
	})
}

// RouterV2Setup registers the V2 training synchronization API
// (see backend/docs/training-events-v2.md). All endpoints require a bearer
// token and reuse the V1 auth and user-loading middleware. The legacy
// /v1/cw/progress endpoint remains active and unaffected.
func RouterV2Setup(engine *gin.Engine) {
	v2 := engine.Group("/v2")

	protected := v2.Group("/")
	protected.Use(middlewares.AuthRequired())
	protected.Use(middlewares.LoadUser(databases.DB))

	trainingHandler := v2handlers.TrainingHandler{DB: databases.DB}
	training := protected.Group("/training")
	training.POST("/events/batch", trainingHandler.PostEventsBatch)
	training.GET("/snapshot", trainingHandler.GetSnapshot)
	training.PUT("/settings", trainingHandler.PutSettings)
}

func CORSSetup(engine *gin.Engine) {
	engine.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin == "" || !isCORSAllowed(origin) {
			c.Next()
			return
		}

		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		c.Header("Vary", "Origin")

		if c.Request.Method == http.MethodOptions {
			c.Header("Access-Control-Max-Age", "43200")
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	})
}

// isCORSAllowed reports whether origin should receive CORS headers.
// Priority order:
//  1. Non-release mode -> allow everything
//  2. CORS_ORIGINS env var (explicit allowlist, comma-separated)
//  3. Production -> only https://opencw.net
func isCORSAllowed(origin string) bool {
	if !configs.App.IsRelease() {
		return true
	}
	if len(configs.App.CORSOrigins) > 0 {
		for _, o := range configs.App.CORSOrigins {
			if o == origin {
				return true
			}
		}
		return false
	}
	return origin == defaultProductionOrigin
}

// PprofSetup registers the net/http/pprof endpoints on the Gin engine,
// including the goroutine-leak profile introduced in Go 1.27.
func PprofSetup(engine *gin.Engine) {
	group := engine.Group("/debug/pprof")

	group.GET("/", gin.WrapF(pprof.Index))
	group.GET("/cmdline", gin.WrapF(pprof.Cmdline))
	group.GET("/profile", gin.WrapF(pprof.Profile))
	group.GET("/symbol", gin.WrapF(pprof.Symbol))
	group.POST("/symbol", gin.WrapF(pprof.Symbol))
	group.GET("/trace", gin.WrapF(pprof.Trace))
	group.GET("/allocs", gin.WrapH(pprof.Handler("allocs")))
	group.GET("/block", gin.WrapH(pprof.Handler("block")))
	group.GET("/goroutine", gin.WrapH(pprof.Handler("goroutine")))
	group.GET("/heap", gin.WrapH(pprof.Handler("heap")))
	group.GET("/mutex", gin.WrapH(pprof.Handler("mutex")))
	group.GET("/threadcreate", gin.WrapH(pprof.Handler("threadcreate")))
	group.GET("/goroutineleak", gin.WrapH(pprof.Handler("goroutineleak")))
}
