package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TestRefreshErrorResponseSnapshots(t *testing.T) {
	const invalidBody = `{"code":"INVALID_REQUEST_BODY","error":"Invalid request body"}`
	const invalidToken = `{"code":"INVALID_TOKEN","error":"Invalid refresh token"}`
	const expiredToken = `{"code":"EXPIRED_TOKEN","error":"Refresh token expired"}`
	const internalFailure = `{"code":"INTERNAL_SERVER_ERROR","error":"Failed to refresh token"}`
	rawToken := strings.Repeat("ab", 32)
	hashedToken, err := utils.HashStringRefreshToken(rawToken)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, body, state, want string
		status                  int
		queryError              error
	}{
		{name: "malformed-json", body: `{`, status: 400, want: invalidBody},
		{name: "null-json", body: `null`, status: 400, want: invalidBody},
		{name: "missing-field", body: `{}`, status: 400, want: invalidBody},
		{name: "malformed-hex", body: `{"refresh_token":"not-hex"}`, status: 401, want: invalidToken},
		{name: "unknown-token", status: 401, want: invalidToken},
		{name: "revoked", state: "revoked", status: 401, want: invalidToken},
		{name: "expired", state: "expired", status: 401, want: expiredToken},
		{name: "revoked-before-expired", state: "revoked-expired", status: 401, want: invalidToken},
		{name: "deleted-user", state: "deleted-user", status: 401, want: invalidToken},
		{name: "query-failure", status: 500, want: internalFailure, queryError: errors.New("injected refresh lookup failure")},
		{name: "wrapped-invalid", status: 401, want: invalidToken, queryError: errors.Join(errors.New("lookup failure"), common.ErrInvalidToken)},
		{name: "wrapped-expired", status: 401, want: expiredToken, queryError: errors.Join(errors.New("lookup failure"), common.ErrExpiredToken)},
		{name: "invalid-before-expired", status: 401, want: invalidToken, queryError: errors.Join(common.ErrExpiredToken, common.ErrInvalidToken)},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := postgresTestDB(t)
			if test.state != "" {
				user := postgresTestUser(t, db, "")
				expiresAt := time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
				if strings.Contains(test.state, "expired") {
					expiresAt = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
				}
				token := models.RefreshToken{UserID: user.ID, Token: hashedToken,
					ExpiresAt: expiresAt, Revoked: strings.Contains(test.state, "revoked")}
				if err := db.Create(&token).Error; err != nil {
					t.Fatal(err)
				}
				if test.state == "deleted-user" {
					if err := db.Delete(&user).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			if test.queryError != nil {
				if err := db.Callback().Query().Before("gorm:query").Register("test:refresh-query-error", func(tx *gorm.DB) {
					if tx.Statement.Table == "refresh_tokens" {
						tx.AddError(test.queryError)
					}
				}); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = db.Callback().Query().Remove("test:refresh-query-error") })
			}
			body := test.body
			if body == "" {
				body = `{"refresh_token":"` + rawToken + `"}`
			}
			response := emailRequest((&AuthHandler{DB: db}).Refresh, models.User{}, body)
			if response.Code != test.status || response.Body.String() != test.want {
				t.Fatalf("response = %d %s, want %d %s", response.Code, response.Body.String(), test.status, test.want)
			}
			if contentType := response.Header().Get("Content-Type"); contentType != "application/json; charset=utf-8" {
				t.Fatalf("Content-Type = %q", contentType)
			}
		})
	}
}

func TestRefreshCanceledRequestResponses(t *testing.T) {
	for _, test := range []struct {
		name, token, want, contentType string
		status                         int
	}{
		{"malformed-hex", "not-hex", `{"code":"INVALID_TOKEN","error":"Invalid refresh token"}`, "application/json; charset=utf-8", 401},
		{"valid-hex", strings.Repeat("ab", 32), "", "", 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := postgresTestDB(t)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/auth/refresh",
				strings.NewReader(`{"refresh_token":"`+test.token+`"}`)).WithContext(ctx)
			c.Request.Header.Set("Content-Type", "application/json")
			(&AuthHandler{DB: db}).Refresh(c)
			if response.Code != test.status || response.Body.String() != test.want || response.Header().Get("Content-Type") != test.contentType {
				t.Fatalf("response = %d %q %q, want %d %q %q", response.Code, response.Body.String(),
					response.Header().Get("Content-Type"), test.status, test.want, test.contentType)
			}
		})
	}
}
