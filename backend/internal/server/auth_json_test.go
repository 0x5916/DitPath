package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"opencw/internal/common"
	handlers "opencw/internal/handlers/v1"
	"opencw/internal/models"
	"opencw/internal/utils"
)

func TestAuthBodyCapRegisteredRoutes(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	token, err := utils.GenerateAccessToken(user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	var workers atomic.Int32
	work := authHTTPWork(t, func(string) (string, error) { workers.Add(1); return "unused", nil },
		func(string, string) (bool, error) { workers.Add(1); return true, nil })
	engine := authHTTPRouter(t, db, work, authHTTPPolicy(), time.Now)
	for _, route := range []struct{ method, path string }{
		{"POST", "/v1/auth/register"}, {"POST", "/v1/auth/login"}, {"POST", "/v1/auth/refresh"}, {"POST", "/v1/auth/logout"},
		{"POST", "/v1/auth/verify-email"}, {"PUT", "/v1/user/password"}, {"PUT", "/v1/user/email"}, {"PUT", "/v1/user/callsign"},
	} {
		t.Run(route.path, func(t *testing.T) {
			for _, unknown := range []bool{false, true} {
				body := `{"ignored":"` + strings.Repeat("x", int(handlers.AuthJSONMaxBytes)) + `"}`
				request := httptest.NewRequest(route.method, route.path, strings.NewReader(body))
				request.RemoteAddr = "198.51.100.77:1234"
				request.Header.Set("Authorization", "Bearer "+token)
				request.Header.Set("Content-Type", "application/json")
				if unknown {
					request.ContentLength = -1
					request.TransferEncoding = []string{"chunked"}
				}
				response := httptest.NewRecorder()
				engine.ServeHTTP(response, request)
				authHTTPError(t, response, 413, common.ErrorCodeRequestBodyTooLarge)
				if response.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("oversize response missing no-store")
				}
			}
		})
	}
	var actual models.User
	if err := db.Take(&actual, "id = ?", user.ID).Error; err != nil || actual.Password != user.Password || actual.Email != user.Email || actual.EmailVerified {
		t.Fatalf("oversize mutation: %v", err)
	}
	var sessions, otps int64
	if err := db.Model(&models.RefreshToken{}).Where("user_id = ?", user.ID).Count(&sessions).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.EmailOTP{}).Where("user_id = ?", user.ID).Count(&otps).Error; err != nil || sessions != 0 || otps != 0 || workers.Load() != 0 {
		t.Fatalf("oversize side effects sessions=%d OTP=%d work=%d err=%v", sessions, otps, workers.Load(), err)
	}
}

func TestAuthBodyCapExactAndQuotaPrecedence(t *testing.T) {
	work := authHTTPWork(t, nil, nil)
	first, err := work.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := work.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	policy := authHTTPPolicy()
	policy.LoginLimit, policy.RegistrationLimit = 1, 1
	engine := authHTTPRouter(t, nil, work, policy, time.Now)
	valid := `{"identifier":"ordinary","password":"ordinary-password"}`
	exact := valid + strings.Repeat(" ", int(handlers.AuthJSONMaxBytes)-len(valid))
	// Exact-limit bodies reach password admission. A nil database would panic
	// if capacity refusal or quota precedence allowed an account lookup.
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: exact}), 503, common.ErrorCodeAuthCapacityExceeded)
	oversize := exact + " "
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: oversize}), http.StatusTooManyRequests, common.ErrorCodeAuthRateLimited)
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/register", body: oversize}), 413, common.ErrorCodeRequestBodyTooLarge)
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/register", body: oversize}), http.StatusTooManyRequests, common.ErrorCodeAuthRateLimited)
}
