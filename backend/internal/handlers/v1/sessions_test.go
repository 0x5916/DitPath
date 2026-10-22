package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

const passwordBody = `{"old_password":"old-password","new_password":"new-password"}`

func sessionTestSetup(t *testing.T) (*gorm.DB, models.User, *utils.PasswordWork) {
	t.Helper()
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	previousSecret := configs.App.JWTSecret
	configs.App.JWTSecret = []byte(strings.Repeat("session-test-secret", 3))
	t.Cleanup(func() { configs.App.JWTSecret = previousSecret })
	work, err := utils.NewPasswordWork(2, func(password string) (string, error) { return password + "-hash", nil },
		func(_, encoded string) (bool, error) { return encoded == "unused", nil })
	if err != nil {
		t.Fatal(err)
	}
	return db, user, work
}

func sessionTestToken(t *testing.T, db *gorm.DB, user models.User) common.AuthTokenPairResponse {
	t.Helper()
	raw, access, err := utils.IssueTokenPair(db, user.ID, user.Password, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return common.AuthTokenPairResponse{RefreshToken: raw, AccessToken: access}
}

func sessionState(t *testing.T, db *gorm.DB, user models.User, password string, active int64) {
	t.Helper()
	var actual models.User
	if err := db.First(&actual, "id = ?", user.ID).Error; err != nil || actual.Password != password {
		t.Fatalf("password state=%q, want %q: %v", actual.Password, password, err)
	}
	var count int64
	if err := db.Model(&models.RefreshToken{}).Where("user_id = ? AND revoked = false", user.ID).Count(&count).Error; err != nil || count != active {
		t.Fatalf("active sessions=%d, want %d: %v", count, active, err)
	}
}

func TestPasswordChangeRevokesAllRefreshSessions(t *testing.T) {
	db, user, work := sessionTestSetup(t)
	first, second := sessionTestToken(t, db, user), sessionTestToken(t, db, user)
	other := postgresTestUser(t, db, "")
	sessionTestToken(t, db, other)
	emailResponse(t, emailRequest((&UserHandler{DB: db, Passwords: work}).UpdatePassword, user, passwordBody), 200, "Password updated")
	sessionState(t, db, user, "new-password-hash", 0)
	sessionState(t, db, other, other.Password, 1)
	auth := &AuthHandler{DB: db}
	for _, pair := range []common.AuthTokenPairResponse{first, second} {
		emailResponse(t, emailRequest(auth.Refresh, user, fmt.Sprintf(`{"refresh_token":%q}`, pair.RefreshToken)), 401, common.ErrorCodeInvalidToken)
		claims := &jwt.RegisteredClaims{}
		parsed, err := jwt.ParseWithClaims(pair.AccessToken, claims, func(*jwt.Token) (any, error) { return configs.App.JWTSecret, nil }, jwt.WithValidMethods([]string{"HS256"}))
		if err != nil || !parsed.Valid || claims.ExpiresAt.Sub(claims.IssuedAt.Time) != 15*time.Minute {
			t.Fatalf("existing 15-minute access JWT policy changed: %v", err)
		}
	}
}

func TestPasswordRefreshAccountLockOrders(t *testing.T) {
	for _, order := range []string{"refresh-first", "password-first"} {
		t.Run(order, func(t *testing.T) {
			db, user, work := sessionTestSetup(t)
			pair := sessionTestToken(t, db, user)
			refresh := (&AuthHandler{DB: db}).Refresh
			update := (&UserHandler{DB: db, Passwords: work}).UpdatePassword
			locked, release := emailLockGate(t, db)
			firstHandler, firstBody := refresh, fmt.Sprintf(`{"refresh_token":%q}`, pair.RefreshToken)
			secondHandler, secondBody := update, passwordBody
			if order == "password-first" {
				firstHandler, secondHandler, firstBody, secondBody = secondHandler, firstHandler, secondBody, firstBody
			}
			first := emailAsync(firstHandler, user, firstBody)
			emailAwait(t, locked)
			second := emailAsync(secondHandler, user, secondBody)
			emailWaitForLock(t, db)
			release()
			firstResponse, secondResponse := emailResult(t, first), emailResult(t, second)
			if order == "password-first" {
				emailResponse(t, firstResponse, 200, "Password updated")
				emailResponse(t, secondResponse, 401, common.ErrorCodeInvalidToken)
			} else {
				var successor common.AuthTokenPairResponse
				if firstResponse.Code != 200 || json.Unmarshal(firstResponse.Body.Bytes(), &successor) != nil || successor.RefreshToken == "" {
					t.Fatalf("refresh winner=%d %s", firstResponse.Code, firstResponse.Body.String())
				}
				emailResponse(t, secondResponse, 200, "Password updated")
				emailResponse(t, emailRequest(refresh, user, fmt.Sprintf(`{"refresh_token":%q}`, successor.RefreshToken)), 401, common.ErrorCodeInvalidToken)
			}
			sessionState(t, db, user, "new-password-hash", 0)
		})
	}
}

func TestPasswordChangeRejectsStaleSnapshot(t *testing.T) {
	db, user, work := sessionTestSetup(t)
	sessionTestToken(t, db, user)
	update := (&UserHandler{DB: db, Passwords: work}).UpdatePassword
	locked, release := emailLockGate(t, db)
	first := emailAsync(update, user, passwordBody)
	emailAwait(t, locked)
	second := emailAsync(update, user, `{"old_password":"old-password","new_password":"loser-password"}`)
	emailWaitForLock(t, db)
	// Both requests have completed their password work before waiting for the
	// account lock; neither is allowed to hold scarce Argon2 capacity here.
	for range 2 {
		reservation, err := work.Acquire(context.Background())
		if err != nil {
			t.Fatalf("password reservation retained during account transaction: %v", err)
		}
		defer reservation.Close()
	}
	release()
	emailResponse(t, emailResult(t, first), 200, "Password updated")
	emailResponse(t, emailResult(t, second), 401, common.ErrorCodeInvalidCredentials)
	sessionState(t, db, user, "new-password-hash", 0)
}

func TestLoginCannotRecreateSessionFromOldPasswordSnapshot(t *testing.T) {
	db, user, _ := sessionTestSetup(t)
	comparing, release := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	work, err := utils.NewPasswordWork(2, func(password string) (string, error) { return password + "-hash", nil }, func(password, encoded string) (bool, error) {
		if password == "login-password" {
			close(comparing)
			select {
			case <-release:
			case <-time.After(10 * time.Second):
				return false, errors.New("login gate timed out")
			}
		}
		return encoded == "unused", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	login := emailAsync((&AuthHandler{DB: db, Passwords: work}).Login, user,
		fmt.Sprintf(`{"identifier":%q,"password":"login-password"}`, user.Username))
	emailAwait(t, comparing)
	emailResponse(t, emailRequest((&UserHandler{DB: db, Passwords: work}).UpdatePassword, user, passwordBody), 200, "Password updated")
	close(release)
	emailResponse(t, emailResult(t, login), 401, common.ErrorCodeInvalidCredentials)
	sessionState(t, db, user, "new-password-hash", 0)
	for _, expected := range []string{"unused", "new-password-hash"} {
		if expected != "unused" {
			if err := db.Delete(&user).Error; err != nil {
				t.Fatal(err)
			}
		}
		raw, access, err := utils.IssueTokenPair(db, user.ID, expected, time.Now())
		if err == nil || raw != "" || access != "" {
			t.Fatalf("stale/missing account issued tokens: %v", err)
		}
	}
}

func TestSessionTransactionsFailClosed(t *testing.T) {
	for _, operation := range []string{"refresh", "password", "login"} {
		for _, fault := range []string{"begin", "commit-before", "commit-after", "write"} {
			t.Run(operation+"/"+fault, func(t *testing.T) {
				db, user, work := sessionTestSetup(t)
				pair := sessionTestToken(t, db, user)
				handlerDB := db
				var isolation atomic.Int32
				if fault == "write" {
					if err := db.Callback().Update().Before("gorm:update").Register("test:session-failure", func(tx *gorm.DB) {
						if tx.Statement.Table == "refresh_tokens" {
							tx.AddError(errors.New("injected token write failure"))
						}
					}); err != nil {
						t.Fatal(err)
					}
					if operation == "login" {
						if err := db.Callback().Create().Before("gorm:create").Register("test:session-failure", func(tx *gorm.DB) {
							if tx.Statement.Table == "refresh_tokens" {
								tx.AddError(errors.New("injected token insert failure"))
							}
						}); err != nil {
							t.Fatal(err)
						}
					}
					t.Cleanup(func() {
						_ = db.Callback().Update().Remove("test:session-failure")
						_ = db.Callback().Create().Remove("test:session-failure")
					})
				} else {
					pool, err := db.DB()
					if err != nil {
						t.Fatal(err)
					}
					handlerDB = db.Session(&gorm.Session{NewDB: true, Context: context.Background()})
					handlerDB.Statement.ConnPool = &emailFaultPool{ConnPool: pool, pool: pool, mode: fault, isolation: &isolation}
				}
				handler := (&AuthHandler{DB: handlerDB}).Refresh
				body := fmt.Sprintf(`{"refresh_token":%q}`, pair.RefreshToken)
				code := common.ErrorCodeInternalServerError
				if operation == "password" {
					handler, body = (&UserHandler{DB: handlerDB, Passwords: work}).UpdatePassword, passwordBody
				} else if operation == "login" {
					handler = (&AuthHandler{DB: handlerDB, Passwords: work}).Login
					body = fmt.Sprintf(`{"identifier":%q,"password":"old-password"}`, user.Username)
					code = common.ErrorCodeTokenIssueFailed
				}
				response := emailRequest(handler, user, body)
				emailResponse(t, response, http.StatusInternalServerError, code)
				if operation == "refresh" && (response.Body.String() != `{"code":"INTERNAL_SERVER_ERROR","error":"Failed to refresh token"}` ||
					response.Header().Get("Content-Type") != "application/json; charset=utf-8") {
					t.Fatalf("refresh failure response changed: %s %q", response.Body.String(), response.Header().Get("Content-Type"))
				}
				if strings.Contains(response.Body.String(), "refresh_token") || strings.Contains(response.Body.String(), "access_token") {
					t.Fatal("transaction failure exposed token pair")
				}
				if fault != "write" && isolation.Load() != 1 {
					t.Fatalf("READ COMMITTED begins=%d", isolation.Load())
				}
				password, active := user.Password, int64(1)
				if fault == "commit-after" {
					if operation == "password" {
						password, active = "new-password-hash", 0
					} else if operation == "login" {
						active = 2
					}
				}
				sessionState(t, db, user, password, active)
			})
		}
	}
}
