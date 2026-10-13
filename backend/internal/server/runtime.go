package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"opencw/internal/configs"
	"opencw/internal/databases"
	"opencw/internal/models"
)

const refreshTokenCleanupInterval = 3 * time.Hour

func GracefulShutdown(srv *http.Server) {
	// Context that cancels on SIGINT/SIGTERM
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	startRefreshTokenCleanup(ctx)
	runServer(srv)

	// Block until signal received
	<-ctx.Done()
	slog.Info("Shutdown signal received")

	// Give in-flight requests a short window to complete.
	shutdownServer(context.Background(), srv)
	closeDatabase()

	slog.Info("Server exited gracefully")
}

func startRefreshTokenCleanup(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(refreshTokenCleanupInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				err := databases.DB.Unscoped().Where(
					"expires_at < ? OR revoked = true",
					time.Now(),
				).Delete(&models.RefreshToken{}).Error
				if err != nil {
					slog.Error("Failed to cleanup refresh tokens", "err", err)
				}
			case <-ctx.Done():
				slog.Info("Stopping refresh token cleanup goroutine")
				return
			}
		}
	}()
}

func runServer(srv *http.Server) {
	go func() {
		slog.Info("Server starting", "port", configs.App.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("Server error", "err", err)
			os.Exit(1)
		}
	}()
}

func shutdownServer(ctx context.Context, srv *http.Server) {
	shutdownCtx, cancel := context.WithTimeout(ctx, configs.App.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("Server forced to shutdown", "err", err)
		os.Exit(1)
	}
}

func closeDatabase() {
	sqlDB, err := databases.DB.DB()
	if err != nil {
		slog.Error("Failed to get SQL DB instance", "err", err)
		return
	}

	if err := sqlDB.Close(); err != nil {
		slog.Error("Failed to close database connection", "err", err)
	}
}
