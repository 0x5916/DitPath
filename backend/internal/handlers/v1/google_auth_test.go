package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/googleauth"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var googleTestNonce = base64.RawURLEncoding.EncodeToString(make([]byte, 32))

func googleRequest(h *GoogleAuthHandler, register bool, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/auth/google", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if register {
		h.Register(c)
	} else {
		h.Login(c)
	}
	return recorder
}

func googleBody(username string) string {
	body, _ := json.Marshal(googleAuthInput{Credential: "test-token", Nonce: googleTestNonce, Username: username})
	return string(body)
}

func googleExpectError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	var body common.ErrorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != status || body.Code != code {
		t.Fatalf("response %d %s; want %d %s", response.Code, response.Body.String(), status, code)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("authentication response is cacheable")
	}
}

func TestGoogleHandlerInputAndVerifierFailures(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		verifyErr  error
		status     int
		code       string
	}{
		{"missing", `{}`, nil, 400, common.ErrorCodeInvalidRequestBody},
		{"invalid nonce", `{"credential":"test","nonce":"invalid"}`, nil, 400, common.ErrorCodeInvalidRequestBody},
		{"padded nonce", `{"credential":"test","nonce":"` + googleTestNonce + `="}`, nil, 400, common.ErrorCodeInvalidRequestBody},
		{"oversized credential", `{"credential":"` + strings.Repeat("x", 12289) + `","nonce":"` + googleTestNonce + `"}`, nil, 400, common.ErrorCodeInvalidRequestBody},
		{"credential byte limit", `{"credential":"` + strings.Repeat("é", 6200) + `","nonce":"` + googleTestNonce + `"}`, nil, 400, common.ErrorCodeInvalidRequestBody},
		{"oversized complete body", googleBody("") + strings.Repeat(" ", int(AuthJSONMaxBytes)), nil, 413, common.ErrorCodeRequestBodyTooLarge},
		{"invalid credential", googleBody(""), googleauth.ErrInvalidCredential, 401, common.ErrorCodeGoogleCredentialInvalid},
		{"verification unavailable", googleBody(""), googleauth.ErrUnavailable, 503, common.ErrorCodeGoogleSignInUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			h := &GoogleAuthHandler{Verify: func(context.Context, string, string) (googleauth.Identity, error) {
				calls++
				return googleauth.Identity{}, tc.verifyErr
			}}
			response := googleRequest(h, false, tc.body)
			googleExpectError(t, response, tc.status, tc.code)
			if tc.status < 500 && tc.verifyErr == nil && calls != 0 {
				t.Fatal("invalid input reached verification")
			}
			if tc.status == 503 && response.Header().Get("Retry-After") != "1" {
				t.Fatal("missing verification retry hint")
			}
		})
	}
}

func googleFixture(t *testing.T) (*gorm.DB, *GoogleAuthHandler, googleauth.Identity, string) {
	t.Helper()
	db := postgresTestDB(t)
	if err := utils.RegisterCustomValidators(); err != nil {
		t.Fatal(err)
	}
	previous := configs.App.JWTSecret
	configs.App.JWTSecret = []byte(strings.Repeat("google-test-secret", 2))
	t.Cleanup(func() { configs.App.JWTSecret = previous })
	identity := googleauth.Identity{Subject: uuid.NewString(), Email: uuid.NewString() + "@gmail.com", EmailVerified: true}
	prefix := "g" + uuid.NewString()[:8]
	t.Cleanup(func() {
		if err := db.Unscoped().Where("username LIKE ?", prefix+"%").Delete(&models.User{}).Error; err != nil {
			t.Error(err)
		}
	})
	h := &GoogleAuthHandler{DB: db, Verify: func(context.Context, string, string) (googleauth.Identity, error) { return identity, nil }}
	return db, h, identity, prefix
}

func googleExpectPair(t *testing.T, response *httptest.ResponseRecorder) common.AuthTokenPairResponse {
	t.Helper()
	var pair common.AuthTokenPairResponse
	if err := json.Unmarshal(response.Body.Bytes(), &pair); err != nil || response.Code != 200 || len(pair.RefreshToken) != 64 || pair.AccessToken == "" {
		t.Fatalf("token response %d %s", response.Code, response.Body.String())
	}
	return pair
}

func TestGoogleSignupAndReturningIdentity(t *testing.T) {
	db, h, identity, prefix := googleFixture(t)
	googleExpectError(t, googleRequest(h, false, googleBody("")), 409, common.ErrorCodeGoogleSignupRequired)
	var count int64
	if err := db.Model(&models.UserIdentity{}).Where("subject = ?", identity.Subject).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("signup prompt created an identity: %d %v", count, err)
	}
	googleExpectError(t, googleRequest(h, true, googleBody("!")), 400, common.ErrorCodeInvalidRequestBody)
	googleExpectPair(t, googleRequest(h, true, googleBody(prefix)))
	var stored models.UserIdentity
	if err := db.Preload("User").Take(&stored, "subject = ?", identity.Subject).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Provider != "google" || stored.Issuer != googleauth.Issuer || stored.User.Password != "" || !stored.User.EmailVerified {
		t.Fatalf("unexpected Google account: %+v", stored)
	}
	// Returning identity ignores username and later Google email state.
	h.Verify = func(context.Context, string, string) (googleauth.Identity, error) {
		return googleauth.Identity{Subject: identity.Subject, Email: "changed@example.invalid"}, nil
	}
	googleExpectPair(t, googleRequest(h, true, googleBody("!")))
	googleExpectPair(t, googleRequest(h, false, googleBody("")))
	var actual models.User
	if err := db.Take(&actual, "id = ?", stored.UserID).Error; err != nil || actual.Email != identity.Email || !actual.EmailVerified {
		t.Fatalf("returning login changed local email: %v", err)
	}
	if err := db.Model(&models.RefreshToken{}).Where("user_id = ?", stored.UserID).Count(&count).Error; err != nil || count != 3 {
		t.Fatalf("expected three sessions: %d %v", count, err)
	}
}

func TestGoogleEmailAuthorityAndNoLinking(t *testing.T) {
	for _, tc := range []struct {
		name, domain, hosted string
		verified             bool
	}{{"gmail", "gmail.com", "", true}, {"hosted", "example.invalid", "example.invalid", true}, {"third party", "example.invalid", "", false}} {
		t.Run(tc.name, func(t *testing.T) {
			db, h, identity, prefix := googleFixture(t)
			identity.Email = uuid.NewString() + "@" + tc.domain
			identity.HostedDomain = tc.hosted
			h.Verify = func(context.Context, string, string) (googleauth.Identity, error) { return identity, nil }
			passwordUser := postgresTestUser(t, db, identity.Email)
			googleExpectPair(t, googleRequest(h, true, googleBody(prefix)))
			var stored models.UserIdentity
			if err := db.Preload("User").Take(&stored, "subject = ?", identity.Subject).Error; err != nil {
				t.Fatal(err)
			}
			if stored.UserID == passwordUser.ID || stored.User.EmailVerified != tc.verified {
				t.Fatal("email linked an existing account or trusted an unauthoritative address")
			}
		})
	}
}

func TestGoogleRegistrationConflictsAndInvalidEmail(t *testing.T) {
	for _, tc := range []string{"verified owner", "username", "unverified Google email", "malformed email"} {
		t.Run(tc, func(t *testing.T) {
			db, h, identity, prefix := googleFixture(t)
			status, code := 409, common.ErrorCodeGoogleAccountConflict
			switch tc {
			case "verified owner":
				owner := postgresTestUser(t, db, identity.Email)
				if err := db.Model(&owner).Update("email_verified", true).Error; err != nil {
					t.Fatal(err)
				}
			case "username":
				owner := postgresTestUser(t, db, "")
				if err := db.Model(&owner).Update("username", prefix).Error; err != nil {
					t.Fatal(err)
				}
				code = common.ErrorCodeUsernameAlreadyInUse
			case "unverified Google email":
				identity.EmailVerified = false
				status, code = 401, common.ErrorCodeGoogleCredentialInvalid
			case "malformed email":
				identity.Email = "invalid"
				status, code = 401, common.ErrorCodeGoogleCredentialInvalid
			}
			h.Verify = func(context.Context, string, string) (googleauth.Identity, error) { return identity, nil }
			googleExpectError(t, googleRequest(h, true, googleBody(prefix)), status, code)
			var count int64
			if err := db.Model(&models.UserIdentity{}).Where("subject = ?", identity.Subject).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("conflict created identity: %d %v", count, err)
			}
		})
	}
}

func TestGoogleDeletedIdentityAndOwnerRemainReserved(t *testing.T) {
	for _, deleteIdentity := range []bool{false, true} {
		t.Run(map[bool]string{false: "owner", true: "identity"}[deleteIdentity], func(t *testing.T) {
			db, h, identity, prefix := googleFixture(t)
			googleExpectPair(t, googleRequest(h, true, googleBody(prefix)))
			var stored models.UserIdentity
			if err := db.Take(&stored, "subject = ?", identity.Subject).Error; err != nil {
				t.Fatal(err)
			}
			if deleteIdentity {
				if err := db.Delete(&stored).Error; err != nil {
					t.Fatal(err)
				}
			} else if err := db.Delete(&models.User{}, "id = ?", stored.UserID).Error; err != nil {
				t.Fatal(err)
			}
			for _, register := range []bool{false, true} {
				googleExpectError(t, googleRequest(h, register, googleBody(prefix+"x")), 409, common.ErrorCodeGoogleAccountConflict)
			}
		})
	}
}

func TestGoogleRegistrationRollsBackTokenFailure(t *testing.T) {
	db, h, identity, prefix := googleFixture(t)
	if err := db.Callback().Create().Before("gorm:create").Register("test:google-token-failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "refresh_tokens" {
			tx.AddError(errors.New("injected token insert failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove("test:google-token-failure") })
	googleExpectError(t, googleRequest(h, true, googleBody(prefix)), 500, common.ErrorCodeTokenIssueFailed)
	for _, model := range []any{&models.User{}, &models.UserIdentity{}} {
		var count int64
		query := db.Unscoped().Model(model)
		if _, ok := model.(*models.User); ok {
			query = query.Where("username = ?", prefix)
		} else {
			query = query.Where("subject = ?", identity.Subject)
		}
		if err := query.Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("failed token insert left %T: %d %v", model, count, err)
		}
	}
}

func TestGoogleLoginRereadsIdentityUnderAccountLock(t *testing.T) {
	db, h, identity, prefix := googleFixture(t)
	googleExpectPair(t, googleRequest(h, true, googleBody(prefix)))
	var deleted atomic.Bool
	if err := db.Callback().Query().After("gorm:query").Register("test:google-identity-disappears", func(tx *gorm.DB) {
		if tx.Statement.Table != "user_identities" || !deleted.CompareAndSwap(false, true) {
			return
		}
		stored, ok := tx.Statement.Dest.(*models.UserIdentity)
		if !ok {
			t.Error("identity lookup lost its destination")
			return
		}
		copy := *stored
		if err := db.Delete(&copy).Error; err != nil {
			t.Error(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove("test:google-identity-disappears") })
	googleExpectError(t, googleRequest(h, false, googleBody("")), 409, common.ErrorCodeGoogleAccountConflict)
	var sessions int64
	if err := db.Model(&models.RefreshToken{}).Joins("JOIN user_identities ON user_identities.user_id = refresh_tokens.user_id").Where("user_identities.subject = ?", identity.Subject).Count(&sessions).Error; err != nil || sessions != 1 {
		t.Fatalf("deleted identity created a new session: %d %v", sessions, err)
	}
}

func TestGoogleOnlyAccountPasswordGuardsAndCapability(t *testing.T) {
	db, h, _, prefix := googleFixture(t)
	googleExpectPair(t, googleRequest(h, true, googleBody(prefix)))
	var user models.User
	if err := db.Take(&user, "username = ?", prefix).Error; err != nil {
		t.Fatal(err)
	}
	work, err := utils.NewPasswordWork(1, func(string) (string, error) {
		t.Error("Google-only account entered password hashing")
		return "", nil
	}, func(string, string) (bool, error) {
		t.Error("Google-only account entered password comparison")
		return false, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []bool{false, true} {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		body := `{"identifier":"` + prefix + `","password":"unused-password"}`
		status, code := http.StatusUnauthorized, common.ErrorCodeInvalidCredentials
		if change {
			body = `{"old_password":"unused-password","new_password":"unused-password"}`
			status, code = http.StatusConflict, common.ErrorCodePasswordNotAvailable
		}
		c.Request = httptest.NewRequest(http.MethodPost, "/test", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set("user", &user)
		if change {
			(&UserHandler{DB: db, Passwords: work}).UpdatePassword(c)
		} else {
			(&AuthHandler{DB: db, Passwords: work}).Login(c)
		}
		var result common.ErrorResponse
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != status || result.Code != code {
			t.Fatalf("password guard returned %d %s", response.Code, response.Body.String())
		}
	}
	for _, enabled := range []bool{false, true} {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		user.Password = ""
		if enabled {
			user.Password = "password-hash"
		}
		c.Set("user", &user)
		(&UserHandler{}).GetUserInfo(c)
		var result common.UserInfoResponse
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || result.PasswordEnabled != enabled {
			t.Fatalf("password capability returned %d %s", response.Code, response.Body.String())
		}
	}
}

func TestGoogleConcurrentRegistrationKeepsOneAccount(t *testing.T) {
	db, h, identity, prefix := googleFixture(t)
	const workers = 4
	var ready atomic.Int32
	release := make(chan struct{})
	if err := db.Callback().Query().After("gorm:query").Register("test:google-register-barrier", func(tx *gorm.DB) {
		if tx.Statement.Table == "user_identities" && errors.Is(tx.Error, gorm.ErrRecordNotFound) {
			n := ready.Add(1)
			if n > workers {
				return
			}
			if n == workers {
				close(release)
			}
			select {
			case <-release:
			case <-time.After(10 * time.Second):
				tx.AddError(errors.New("registration barrier timed out"))
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove("test:google-register-barrier") })
	results := make(chan *httptest.ResponseRecorder, workers)
	var pending sync.WaitGroup
	for n := range workers {
		pending.Go(func() { results <- googleRequest(h, true, googleBody(prefix+string(rune('a'+n)))) })
	}
	pending.Wait()
	close(results)
	for response := range results {
		googleExpectPair(t, response)
	}
	var identities, users, sessions int64
	if err := db.Model(&models.UserIdentity{}).Where("subject = ?", identity.Subject).Count(&identities).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.User{}).Where("username LIKE ?", prefix+"%").Count(&users).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.RefreshToken{}).Joins("JOIN user_identities ON user_identities.user_id = refresh_tokens.user_id").Where("user_identities.subject = ?", identity.Subject).Count(&sessions).Error; err != nil {
		t.Fatal(err)
	}
	if identities != 1 || users != 1 || sessions != workers {
		t.Fatalf("registration race identities=%d users=%d sessions=%d", identities, users, sessions)
	}
}
