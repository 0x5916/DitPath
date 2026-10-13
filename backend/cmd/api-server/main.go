package main

import (
	"log/slog"
	"net/http"
	"os"

	"opencw/internal/configs"
	"opencw/internal/databases"
	"opencw/internal/server"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	if configs.GetGinMode() != "release" {
		if err := godotenv.Load(".env"); err != nil {
			slog.Error("Failed to load environment variables", "err", err)
			os.Exit(1)
		}
	}
	configs.Load()
	databases.Connect()

	r := gin.Default()

	if err := utils.RegisterCustomValidators(); err != nil {
		slog.Error("Failed to register custom validators", "err", err)
		os.Exit(1)
	}

	if !configs.App.IsRelease() {
		slog.Warn("App is not in production mode. Set GIN_MODE=release for production")
	}

	server.CORSSetup(r)
	server.RouterV1Setup(r)
	server.RouterV2Setup(r)

	// Profiling endpoints in development only. In production (GIN_MODE=release, which the
	// image sets) they would be an unauthenticated CPU-burn and heap-dump surface reachable
	// through the reverse proxy, and nothing in the deployment needs them.
	if !configs.App.IsRelease() {
		server.PprofSetup(r)
	}

	srv := &http.Server{
		Addr:                ":" + configs.App.Port,
		Handler:             r,
		ReadTimeout:         configs.App.ReadTimeout,
		ReadHeaderTimeout:   configs.App.ReadHeaderTimeout,
		WriteTimeout:        configs.App.WriteTimeout,
		IdleTimeout:         configs.App.IdleTimeout,
		MaxHeaderValueCount: http.DefaultMaxHeaderValueCount,
	}

	server.GracefulShutdown(srv)
}
