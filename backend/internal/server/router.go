package server

import (
	"context"
	"net/http"
	"net/http/pprof"
	"net/netip"
	"strings"
	"time"

	"morsewell/internal/authlimits"
	"morsewell/internal/common"
	"morsewell/internal/configs"
	"morsewell/internal/databases"
	"morsewell/internal/googleauth"
	handlers "morsewell/internal/handlers/v1"
	v2handlers "morsewell/internal/handlers/v2"
	"morsewell/internal/middlewares"
	"morsewell/internal/models"
	"morsewell/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RouterV1Setup(engine *gin.Engine) {
	routerV1Setup(engine, databases.DB, utils.DefaultPasswordWork(), authlimits.DefaultLimiter(), configs.App.AuthTrustedProxyCIDRs)
}

func routerV1Setup(engine *gin.Engine, db *gorm.DB, work *utils.PasswordWork, limiter *authlimits.Limiter, proxies []netip.Prefix) {
	v1 := engine.Group("/v1")

	// Health check endpoint
	v1.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"timestamp": time.Now().Unix(),
		})
	})

	authHandler := handlers.AuthHandler{DB: db, Passwords: work}
	auth := v1.Group("/auth")
	auth.POST("/register", middlewares.AuthRequestLimit(authlimits.Registration, limiter, proxies), authHandler.Register)
	auth.POST("/login", middlewares.AuthRequestLimit(authlimits.Login, limiter, proxies), authHandler.Login)
	auth.POST("/logout", authHandler.Logout)
	auth.POST("/refresh", authHandler.Refresh)
	verifyGoogle := func(ctx context.Context, credential, nonce string) (googleauth.Identity, error) {
		return googleauth.DefaultVerifier().Verify(ctx, configs.App.GoogleClientID, credential, nonce)
	}
	registerGoogleAuthRoutes(auth, db, work, limiter, proxies, verifyGoogle)
	registerAccountDeletionRoutes(v1, db, work, limiter, proxies, verifyGoogle)

	protected := v1.Group("/")
	protected.Use(middlewares.AuthRequired())
	protected.Use(middlewares.LoadUser(db))

	admin := v1.Group("/admin", func(c *gin.Context) { c.Header("Cache-Control", "no-store") },
		middlewares.AuthRequired(), middlewares.LoadUser(db), func(c *gin.Context) {
			if !configs.App.CanLookupUsers(utils.MustGetUser(c).ID) {
				c.AbortWithStatusJSON(http.StatusForbidden, common.NewErrorResponse(common.ErrorCodeAdminRequired, "Owner access required"))
			}
		})
	adminHandler := handlers.AdminHandler{DB: db}
	admin.POST("/users/search", adminHandler.SearchUsers)
	admin.GET("/reports/overview", adminHandler.Overview)
	admin.GET("/users/:id/report", adminHandler.LearnerReport)

	mailPrefs := handlers.EmailPreferencesHandler{DB: db}
	v1.GET("/email/unsubscribe", mailPrefs.Unsubscribe)
	v1.POST("/email/unsubscribe", mailPrefs.Unsubscribe)
	protected.GET("/settings/email-preferences", mailPrefs.Get)
	protected.PUT("/settings/email-preferences", mailPrefs.Update)
	admin.POST("/emails/preview", adminHandler.PreviewEmail)
	admin.POST("/emails", adminHandler.QueueEmail)
	admin.GET("/emails", adminHandler.ListEmail)
	admin.GET("/emails/:id", adminHandler.EmailDetail)

	authProtected := protected.Group("/auth")
	authProtected.POST("/send-verification-email", authHandler.SendVerificationEmail)
	authProtected.POST("/verify-email", authHandler.VerifyEmail)

	settingsHandler := handlers.SettingsHandler{DB: db}
	settings := protected.Group("/settings")
	settings.GET("/all", settingsHandler.GetAllSettings)
	settings.GET("/cw", settingsHandler.GetCWSettings)
	settings.GET("/page", settingsHandler.GetPageSettings)
	settings.POST("/cw", settingsHandler.UpdateCWSettings)
	settings.POST("/page", settingsHandler.UpdatePageSettings)

	userHandler := handlers.UserHandler{DB: db, Passwords: work}
	user := protected.Group("/user")
	user.GET("/me", userHandler.GetUserInfo)
	user.PUT("/callsign", userHandler.UpdateCallSign)
	user.PUT("/email", userHandler.UpdateEmail)
	user.PUT("/password", userHandler.UpdatePassword)

	progressHandler := handlers.ProgressHandler{DB: db}
	user.DELETE("/progress", progressHandler.Reset)
	cwProgress := protected.Group("/cw")
	cwProgress.GET("/progress", progressHandler.GetAllProgress)
	cwProgress.PUT("/progress", progressHandler.AddProgress)

	registerTrainingRoutes(protected, db)
	historyHandler := v2handlers.TrainingHandler{DB: db}
	protected.POST("/training/sessions/batch", historyHandler.PostSessionsBatch)
	protected.GET("/training/sessions", historyHandler.GetSessions)
	protected.GET("/training/changes", historyHandler.GetChanges)
	protected.POST("/training/learning-evidence/batch", historyHandler.PostLearningEvidence)
	protected.GET("/training/learning-evidence/changes", historyHandler.GetLearningEvidenceChanges)

	forumHandler := handlers.ForumHandler{DB: db}
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

// RouterV2Setup retains temporary aliases for clients migrating to /v1/training.
// Both namespaces use the same handlers, authentication, and persisted data.
func RouterV2Setup(engine *gin.Engine) {
	routerV2Setup(engine, databases.DB)
}

func routerV2Setup(engine *gin.Engine, db *gorm.DB) {
	v2 := engine.Group("/v2")

	protected := v2.Group("/")
	protected.Use(middlewares.AuthRequired())
	protected.Use(middlewares.LoadUser(db))
	registerTrainingRoutes(protected, db)
}

func registerTrainingRoutes(protected *gin.RouterGroup, db *gorm.DB) {
	trainingHandler := v2handlers.TrainingHandler{DB: db}
	training := protected.Group("/training")
	training.POST("/events/batch", trainingHandler.PostEventsBatch)
	training.GET("/snapshot", trainingHandler.GetSnapshot)
	training.PUT("/settings", trainingHandler.PutSettings)
}

func CORSSetup(engine *gin.Engine) {
	engine.Use(func(c *gin.Context) {
		if googleCORS(c) {
			return
		}
		origin := c.Request.Header.Get("Origin")
		if origin == "" || !isCORSAllowed(origin) {
			c.Next()
			return
		}

		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		allow, expose := "Origin, Content-Type, Authorization", "Retry-After"
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/v1/training/") || strings.HasPrefix(path, "/v2/training/") || path == "/v1/cw/progress" || path == "/v1/user/progress" || path == "/v1/settings/page" {
			allow += ", " + common.TrainingEpochHeader
			expose += ", " + common.TrainingEpochHeader
		}
		c.Header("Access-Control-Allow-Headers", allow)
		c.Header("Access-Control-Expose-Headers", expose)
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
//  3. Production -> only the canonical public origin
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
	return origin == configs.DefaultProductionOrigin
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
