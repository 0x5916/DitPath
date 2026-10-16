package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"opencw/internal/authlimits"
	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/databases"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// These route tests use an already-migrated disposable PostgreSQL database.
// Each root owns its callbacks and fixtures; no migration or email is sent.
func authHTTPDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("OPENCW_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("set OPENCW_TEST_DATABASE_DSN to a migrated disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{TranslateError: true, Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("cannot connect to disposable PostgreSQL database")
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(12)
	t.Cleanup(func() { _ = pool.Close() })
	previousSecret, previousMode, previousOrigins := configs.App.JWTSecret, configs.App.GinMode, configs.App.CORSOrigins
	configs.App.JWTSecret, configs.App.GinMode, configs.App.CORSOrigins = []byte(strings.Repeat("test-auth-key", 3)), "release", []string{"https://test.example.invalid"}
	mode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		configs.App.JWTSecret, configs.App.GinMode, configs.App.CORSOrigins = previousSecret, previousMode, previousOrigins
		gin.SetMode(mode)
	})
	if err := utils.RegisterCustomValidators(); err != nil {
		t.Fatal(err)
	}
	return db
}

func authHTTPUser(t *testing.T, db *gorm.DB, create bool) models.User {
	t.Helper()
	user := models.User{Username: "auth_" + uuid.NewString()[:8], Email: uuid.NewString() + "@example.invalid", Password: "fake:old-password"}
	if create {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		var found models.User
		if err := db.Unscoped().Take(&found, "username = ?", user.Username).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return
		} else if err != nil {
			t.Error(err)
			return
		}
		if err := db.Unscoped().Where("user_id = ?", found.ID).Delete(&models.RefreshToken{}).Error; err != nil {
			t.Error(err)
		}
		if err := db.Unscoped().Delete(&found).Error; err != nil {
			t.Error(err)
		}
	})
	return user
}

func authHTTPWork(t *testing.T, hash func(string) (string, error), compare func(string, string) (bool, error)) *utils.PasswordWork {
	t.Helper()
	if hash == nil {
		hash = func(password string) (string, error) { return "fake:" + password, nil }
	}
	if compare == nil {
		compare = func(password, encoded string) (bool, error) { return encoded == "fake:"+password, nil }
	}
	work, err := utils.NewPasswordWork(2, hash, compare)
	if err != nil {
		t.Fatal(err)
	}
	return work
}

func authHTTPRouter(t *testing.T, db *gorm.DB, work *utils.PasswordWork, policy authlimits.Policy, now func() time.Time, proxies ...netip.Prefix) *gin.Engine {
	t.Helper()
	limiter, err := authlimits.NewLimiter(policy, now)
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	CORSSetup(engine)
	routerV1Setup(engine, db, work, limiter, proxies)
	return engine
}

func authHTTPPolicy() authlimits.Policy {
	return authlimits.Policy{LoginLimit: 100, RegistrationLimit: 100, TotalLimit: 200, SourceLimit: 100, Window: time.Minute}
}

type authHTTPRequest struct {
	method, path, body, peer, token string
	ctx                             context.Context
	headers                         http.Header
}

func authHTTPSend(engine *gin.Engine, input authHTTPRequest) *httptest.ResponseRecorder {
	if input.method == "" {
		input.method = http.MethodPost
	}
	if input.peer == "" {
		input.peer = "198.51.100.7:1234"
	}
	if input.ctx == nil {
		input.ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(input.ctx, 15*time.Second)
	defer cancel()
	request := httptest.NewRequest(input.method, input.path, strings.NewReader(input.body)).WithContext(ctx)
	request.RemoteAddr = input.peer
	request.Header = input.headers.Clone()
	if request.Header == nil {
		request.Header = make(http.Header)
	}
	request.Header.Set("Content-Type", "application/json")
	if input.token != "" {
		request.Header.Set("Authorization", "Bearer "+input.token)
	}
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	return response
}

func authHTTPAsync(engine *gin.Engine, input authHTTPRequest) <-chan *httptest.ResponseRecorder {
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() { result <- authHTTPSend(engine, input) }()
	return result
}

func authHTTPAwait[T any](t *testing.T, channel <-chan T) T {
	t.Helper()
	select {
	case result := <-channel:
		return result
	case <-time.After(10 * time.Second):
		t.Fatal("auth route did not reach its deterministic barrier")
		var zero T
		return zero
	}
}

func authHTTPError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	var body common.ErrorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != status || body.Code != code {
		t.Fatalf("response = %d %s, want %d %s", response.Code, response.Body.String(), status, code)
	}
	if status == http.StatusTooManyRequests || code == common.ErrorCodeAuthCapacityExceeded {
		message := "Authentication is temporarily busy. Please try again."
		if status == http.StatusTooManyRequests {
			message = "Too many authentication requests. Please wait and try again."
		}
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(response.Body.Bytes(), &fields)
		if len(fields) != 2 || body.Error != message || response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Retry-After") == "" {
			t.Fatalf("admission error contract changed: %s %v", response.Body.String(), response.Header())
		}
		if status == http.StatusServiceUnavailable && response.Header().Get("Retry-After") != "1" {
			t.Fatal("capacity Retry-After must be 1")
		}
	}
}

func authHTTPLogin(user models.User, password string) string {
	return fmt.Sprintf(`{"identifier":%q,"password":%q}`, user.Username, password)
}

func authHTTPRegister(user models.User) string {
	return fmt.Sprintf(`{"username":%q,"email":%q,"password":"old-password"}`, user.Username, user.Email)
}

func authHTTPTokenPair(t *testing.T, response *httptest.ResponseRecorder) common.AuthTokenPairResponse {
	t.Helper()
	var pair common.AuthTokenPairResponse
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &pair); err != nil || response.Code != http.StatusOK || pair.AccessToken == "" || len(pair.RefreshToken) != 64 {
		t.Fatalf("token-pair contract = %d %s", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &fields); err != nil || len(fields) != 2 {
		t.Fatal("successful token pair must retain exactly its two fields")
	}
	return pair
}

func TestAuthHTTPPublicQuotasAndCanonicalSource(t *testing.T) {
	db := authHTTPDB(t)
	now := time.Unix(1000, 0)
	engine := authHTTPRouter(t, db, authHTTPWork(t, nil, nil), authlimits.DefaultPolicy(), func() time.Time { return now })
	for range 10 {
		authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{"}), 400, common.ErrorCodeInvalidRequestBody)
	}
	for _, peer := range []string{"198.51.100.7:9999", "[::ffff:198.51.100.7]:4000"} {
		r := authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{", peer: peer, headers: http.Header{"X-Forwarded-For": {"203.0.113.44"}, "X-Real-Ip": {"203.0.113.45"}, "Cf-Connecting-Ip": {"203.0.113.46"}}})
		authHTTPError(t, r, 429, common.ErrorCodeAuthRateLimited)
		if r.Header().Get("Retry-After") != "60" {
			t.Fatal("initial source quota must retry at 60 seconds")
		}
	}
	for range 3 {
		authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/register", body: "{"}), 400, common.ErrorCodeInvalidRequestBody)
	}
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/register", body: "{"}), 429, common.ErrorCodeAuthRateLimited)
	for _, peer := range []string{"203.0.113.9:123", "[2001:db8::1]:123"} {
		authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{", peer: peer}), 400, common.ErrorCodeInvalidRequestBody)
	}
	now = now.Add(time.Minute)
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{"}), 400, common.ErrorCodeInvalidRequestBody)
}

func TestAuthHTTPConcurrentGlobalQuota(t *testing.T) {
	db := authHTTPDB(t)
	now := time.Unix(1000, 0)
	engine := authHTTPRouter(t, db, authHTTPWork(t, nil, nil), authlimits.DefaultPolicy(), func() time.Time { return now })
	results := make(chan *httptest.ResponseRecorder, 80)
	start := make(chan struct{})
	var pending sync.WaitGroup
	for i := range 80 {
		pending.Go(func() {
			<-start
			path := "/v1/auth/login"
			if i%2 == 0 {
				path = "/v1/auth/register"
			}
			results <- authHTTPSend(engine, authHTTPRequest{path: path, body: "{", peer: fmt.Sprintf("198.51.100.%d:123", i+1)})
		})
	}
	close(start)
	pending.Wait()
	close(results)
	admitted, denied := 0, 0
	for response := range results {
		if response.Code == 400 {
			admitted++
			authHTTPError(t, response, 400, common.ErrorCodeInvalidRequestBody)
		} else {
			denied++
			authHTTPError(t, response, 429, common.ErrorCodeAuthRateLimited)
		}
	}
	if admitted != 60 || denied != 20 {
		t.Fatalf("concurrent mixed public admissions = %d, denials = %d; want 60 and 20", admitted, denied)
	}
}

func TestAuthHTTPCapacityPrecedesAccountLookup(t *testing.T) {
	db := authHTTPDB(t)
	known, fresh := authHTTPUser(t, db, true), authHTTPUser(t, db, false)
	var calls, queries, creates atomic.Int32
	work := authHTTPWork(t, func(password string) (string, error) { calls.Add(1); return "fake:" + password, nil }, func(password, encoded string) (bool, error) { calls.Add(1); return true, nil })
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
	if err := db.Callback().Query().Before("gorm:query").Register("test:auth-count-query", func(*gorm.DB) { queries.Add(1) }); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Create().Before("gorm:create").Register("test:auth-count-create", func(*gorm.DB) { creates.Add(1) }); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Callback().Query().Remove("test:auth-count-query")
		_ = db.Callback().Create().Remove("test:auth-count-create")
	})
	policy := authHTTPPolicy()
	policy.LoginLimit, policy.RegistrationLimit = 2, 2
	engine := authHTTPRouter(t, db, work, policy, time.Now)
	for _, user := range []models.User{known, fresh} {
		for _, input := range []authHTTPRequest{{path: "/v1/auth/login", body: authHTTPLogin(user, "old-password")}, {path: "/v1/auth/register", body: authHTTPRegister(user)}} {
			authHTTPError(t, authHTTPAwait(t, authHTTPAsync(engine, input)), 503, common.ErrorCodeAuthCapacityExceeded)
		}
	}
	if queries.Load() != 0 || creates.Load() != 0 || calls.Load() != 0 {
		t.Fatalf("public capacity refusal ran queries=%d creates=%d password calls=%d", queries.Load(), creates.Load(), calls.Load())
	}
	// Every busy response consumed public quota, so malformed follow-ups are throttled.
	for _, path := range []string{"/v1/auth/login", "/v1/auth/register"} {
		authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: path, body: "{"}), 429, common.ErrorCodeAuthRateLimited)
	}
	first.Close()
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/register", body: "{", peer: "203.0.113.1:123"}), 400, common.ErrorCodeInvalidRequestBody)
	if calls.Load() != 0 {
		t.Fatal("invalid body must not start password work")
	}
}

func TestAuthHTTPMixedReservationsIncludeLookupsAndWork(t *testing.T) {
	db := authHTTPDB(t)
	known, fresh := authHTTPUser(t, db, true), authHTTPUser(t, db, false)
	lookupReady, lookupRelease := make(chan struct{}, 2), make(chan struct{})
	workerReady, workerRelease := make(chan struct{}, 2), make(chan struct{})
	var live, peak, calls, lookups atomic.Int32
	worker := func() {
		calls.Add(1)
		active := live.Add(1)
		for prior := peak.Load(); active > prior; prior = peak.Load() {
			if peak.CompareAndSwap(prior, active) {
				break
			}
		}
		workerReady <- struct{}{}
		<-workerRelease
		live.Add(-1)
	}
	work := authHTTPWork(t, func(password string) (string, error) { worker(); return "fake:" + password, nil }, func(string, string) (bool, error) { worker(); return true, nil })
	if err := db.Callback().Query().Before("gorm:query").Register("test:auth-lookup-gate", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" && lookups.Add(1) <= 2 {
			lookupReady <- struct{}{}
			<-lookupRelease
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove("test:auth-lookup-gate") })
	var releaseLookups, releaseWorkers sync.Once
	defer releaseLookups.Do(func() { close(lookupRelease) })
	defer releaseWorkers.Do(func() { close(workerRelease) })
	engine := authHTTPRouter(t, db, work, authHTTPPolicy(), time.Now)
	login := authHTTPAsync(engine, authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(known, "old-password")})
	registration := authHTTPAsync(engine, authHTTPRequest{path: "/v1/auth/register", body: authHTTPRegister(fresh)})
	for range 2 {
		authHTTPAwait(t, lookupReady)
	}
	authHTTPError(t, authHTTPAwait(t, authHTTPAsync(engine, authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(fresh, "old-password")})), 503, common.ErrorCodeAuthCapacityExceeded)
	if lookups.Load() != 2 || calls.Load() != 0 {
		t.Fatalf("lookup admission = %d and worker calls = %d, want 2 and 0", lookups.Load(), calls.Load())
	}
	releaseLookups.Do(func() { close(lookupRelease) })
	for range 2 {
		authHTTPAwait(t, workerReady)
	}
	access, err := utils.GenerateAccessToken(known.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range []authHTTPRequest{
		{path: "/v1/auth/login", body: authHTTPLogin(known, "old-password")},
		{path: "/v1/auth/register", body: authHTTPRegister(known)},
		{method: http.MethodPut, path: "/v1/user/password", token: access, body: `{"old_password":"old-password","new_password":"new-password"}`},
	} {
		authHTTPError(t, authHTTPAwait(t, authHTTPAsync(engine, request)), 503, common.ErrorCodeAuthCapacityExceeded)
	}
	if calls.Load() != 2 || live.Load() != 2 || peak.Load() != 2 {
		t.Fatalf("mixed contention calls=%d live=%d peak=%d, want 2 each", calls.Load(), live.Load(), peak.Load())
	}
	releaseWorkers.Do(func() { close(workerRelease) })
	authHTTPTokenPair(t, authHTTPAwait(t, login))
	authHTTPTokenPair(t, authHTTPAwait(t, registration))
	if live.Load() != 0 {
		t.Fatal("worker remained active after its request completed")
	}
	t.Logf("measured peak simultaneous injected password workers: %d", peak.Load())
	authHTTPFree(t, work)
}

func authHTTPFree(t *testing.T, work *utils.PasswordWork) {
	t.Helper()
	first, err := work.Acquire(context.Background())
	if err != nil {
		t.Fatalf("first password reservation leaked: %v", err)
	}
	defer first.Close()
	second, err := work.Acquire(context.Background())
	if err != nil {
		t.Fatalf("second password reservation leaked: %v", err)
	}
	second.Close()
}

func TestAuthHTTPPasswordChangeUsesOneReservation(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	compared, continueHash := make(chan struct{}, 1), make(chan struct{})
	var hashes atomic.Int32
	work := authHTTPWork(t, func(password string) (string, error) { hashes.Add(1); return "fake:" + password, nil }, func(string, string) (bool, error) { compared <- struct{}{}; <-continueHash; return true, nil })
	other, err := work.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	engine := authHTTPRouter(t, db, work, authHTTPPolicy(), time.Now)
	access, err := utils.GenerateAccessToken(user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	var release sync.Once
	defer release.Do(func() { close(continueHash) })
	result := authHTTPAsync(engine, authHTTPRequest{method: http.MethodPut, path: "/v1/user/password", token: access, body: `{"old_password":"old-password","new_password":"new-password"}`})
	authHTTPAwait(t, compared)
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(user, "old-password")}), 503, common.ErrorCodeAuthCapacityExceeded)
	release.Do(func() { close(continueHash) })
	response := authHTTPAwait(t, result)
	if response.Code != 200 || response.Body.String() != `{"message":"Password updated"}` || hashes.Load() != 1 {
		t.Fatalf("password change must continue through hash with its original reservation: %d %s hashes=%d", response.Code, response.Body.String(), hashes.Load())
	}
	var actual models.User
	if err := db.Take(&actual, "id = ?", user.ID).Error; err != nil || actual.Password != "fake:new-password" {
		t.Fatalf("replacement password not persisted: %v", err)
	}
	other.Close()
	authHTTPFree(t, work)
}

func TestAuthHTTPExistingOutcomesAndReleaseBeforeWrites(t *testing.T) {
	for _, scenario := range []string{"register", "login", "login-email", "bad-password", "unknown-user", "username-conflict", "verified-email-conflict", "compare-format-error", "hash-error", "register-query-error", "login-query-error", "register-write-error", "register-duplicate", "login-token-error", "register-token-error", "password-bad-password", "password-hash-error", "password-write-error", "password"} {
		t.Run(scenario, func(t *testing.T) {
			db := authHTTPDB(t)
			known, fresh := authHTTPUser(t, db, true), authHTTPUser(t, db, false)
			work := authHTTPWork(t, func(password string) (string, error) {
				if scenario == "hash-error" || scenario == "password-hash-error" {
					return "", errors.New("injected hash failure")
				}
				return "fake:" + password, nil
			}, func(password, hash string) (bool, error) {
				if scenario == "compare-format-error" {
					return false, errors.New("injected invalid stored hash")
				}
				return password != "bad-password", nil
			})
			engine := authHTTPRouter(t, db, work, authHTTPPolicy(), time.Now)
			request := authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(known, "old-password")}
			status, code := 200, ""
			switch scenario {
			case "register", "hash-error", "register-query-error", "register-write-error", "register-duplicate", "register-token-error":
				request.path, request.body = "/v1/auth/register", authHTTPRegister(fresh)
			case "login-email":
				request.body = fmt.Sprintf(`{"identifier":%q,"password":"old-password"}`, known.Email)
			case "bad-password":
				request.body, status, code = authHTTPLogin(known, "bad-password"), 401, common.ErrorCodeInvalidCredentials
			case "unknown-user":
				request.body, status, code = authHTTPLogin(fresh, "old-password"), 401, common.ErrorCodeInvalidCredentials
			case "username-conflict":
				request.path, request.body, status, code = "/v1/auth/register", authHTTPRegister(known), 409, common.ErrorCodeUsernameAlreadyInUse
			case "verified-email-conflict":
				if err := db.Model(&known).Update("email_verified", true).Error; err != nil {
					t.Fatal(err)
				}
				fresh.Email = known.Email
				request.path, request.body, status, code = "/v1/auth/register", authHTTPRegister(fresh), 409, common.ErrorCodeEmailVerifiedByAnother
			}
			if strings.HasPrefix(scenario, "password") {
				request.method, request.path = http.MethodPut, "/v1/user/password"
				var err error
				request.token, err = utils.GenerateAccessToken(known.ID, time.Now())
				if err != nil {
					t.Fatal(err)
				}
				oldPassword := "old-password"
				if scenario == "password-bad-password" {
					oldPassword, status, code = "bad-password", 401, common.ErrorCodeInvalidCredentials
				}
				request.body = fmt.Sprintf(`{"old_password":%q,"new_password":"new-password"}`, oldPassword)
			}
			switch scenario {
			case "compare-format-error", "register-write-error", "password-write-error":
				status, code = 500, common.ErrorCodeInternalServerError
			case "hash-error", "password-hash-error":
				status, code = 500, common.ErrorCodePasswordHashFailed
			case "register-query-error":
				status, code = 500, common.ErrorCodeDatabaseFailure
			case "login-query-error":
				status, code = 401, common.ErrorCodeInvalidCredentials
			case "register-duplicate":
				status, code = 409, common.ErrorCodeConflict
			case "login-token-error", "register-token-error":
				status, code = 500, common.ErrorCodeTokenIssueFailed
			}
			if strings.HasSuffix(scenario, "query-error") {
				if err := db.Callback().Query().Before("gorm:query").Register("test:auth-query-failure", func(tx *gorm.DB) { tx.AddError(errors.New("injected lookup failure")) }); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = db.Callback().Query().Remove("test:auth-query-failure") })
			}
			// Persistence and token callbacks prove the lease is already released.
			if err := db.Callback().Create().Before("gorm:create").Register("test:auth-create-check", func(tx *gorm.DB) {
				authHTTPFree(t, work)
				if (strings.HasSuffix(scenario, "token-error") && tx.Statement.Table == "refresh_tokens") || (scenario == "register-write-error" && tx.Statement.Table == "users") {
					tx.AddError(errors.New("injected persistence failure"))
				}
				if scenario == "register-duplicate" && tx.Statement.Table == "users" {
					tx.AddError(gorm.ErrDuplicatedKey)
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Callback().Create().Remove("test:auth-create-check") })
			if err := db.Callback().Update().Before("gorm:update").Register("test:auth-update-check", func(tx *gorm.DB) {
				authHTTPFree(t, work)
				if scenario == "password-write-error" {
					tx.AddError(errors.New("injected password write failure"))
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Callback().Update().Remove("test:auth-update-check") })
			response := authHTTPSend(engine, request)
			if status != 200 {
				authHTTPError(t, response, status, code)
			} else if scenario == "password" {
				if response.Code != 200 || response.Body.String() != `{"message":"Password updated"}` {
					t.Fatalf("password response changed: %d %s", response.Code, response.Body.String())
				}
			} else {
				authHTTPTokenPair(t, response)
			}
			authHTTPFree(t, work)
		})
	}
}

func TestAuthHTTPCancellationSuppressesLaterSteps(t *testing.T) {
	for _, stage := range []string{"before-admission", "login-lookup", "register-lookup", "login-compare", "register-hash", "password-compare", "password-hash"} {
		t.Run(stage, func(t *testing.T) {
			db := authHTTPDB(t)
			known, fresh := authHTTPUser(t, db, true), authHTTPUser(t, db, false)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var hashes, compares, creates, updates atomic.Int32
			work := authHTTPWork(t, func(password string) (string, error) {
				hashes.Add(1)
				if strings.HasSuffix(stage, "hash") {
					cancel()
				}
				return "fake:" + password, nil
			}, func(string, string) (bool, error) {
				compares.Add(1)
				if strings.HasSuffix(stage, "compare") {
					cancel()
				}
				return true, nil
			})
			if strings.HasSuffix(stage, "lookup") {
				if err := db.Callback().Query().After("gorm:query").Register("test:auth-cancel-lookup", func(tx *gorm.DB) {
					if tx.Statement.Table == "users" {
						cancel()
					}
				}); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = db.Callback().Query().Remove("test:auth-cancel-lookup") })
			}
			if err := db.Callback().Create().Before("gorm:create").Register("test:auth-cancel-create", func(*gorm.DB) { creates.Add(1) }); err != nil {
				t.Fatal(err)
			}
			if err := db.Callback().Update().Before("gorm:update").Register("test:auth-cancel-update", func(*gorm.DB) { updates.Add(1) }); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				_ = db.Callback().Create().Remove("test:auth-cancel-create")
				_ = db.Callback().Update().Remove("test:auth-cancel-update")
			})
			policy := authHTTPPolicy()
			policy.LoginLimit = 1
			engine := authHTTPRouter(t, db, work, policy, time.Now)
			request := authHTTPRequest{ctx: ctx, path: "/v1/auth/login", body: authHTTPLogin(known, "old-password")}
			if strings.HasPrefix(stage, "register") {
				request.path, request.body = "/v1/auth/register", authHTTPRegister(fresh)
			}
			if strings.HasPrefix(stage, "password") {
				request.method, request.path, request.body = http.MethodPut, "/v1/user/password", `{"old_password":"old-password","new_password":"new-password"}`
				var err error
				request.token, err = utils.GenerateAccessToken(known.ID, time.Now())
				if err != nil {
					t.Fatal(err)
				}
			}
			if stage == "before-admission" {
				cancel()
			}
			response := authHTTPSend(engine, request)
			if creates.Load() != 0 || updates.Load() != 0 || (response.Code == 200 && response.Body.Len() > 0) {
				t.Fatalf("cancellation allowed later steps: creates=%d updates=%d response=%d %s", creates.Load(), updates.Load(), response.Code, response.Body.String())
			}
			wantHashes, wantCompares := int32(0), int32(0)
			switch stage {
			case "login-compare", "password-compare":
				wantCompares = 1
			case "register-hash":
				wantHashes = 1
			case "password-hash":
				wantHashes, wantCompares = 1, 1
			}
			if hashes.Load() != wantHashes || compares.Load() != wantCompares {
				t.Fatalf("canceled worker sequence hashes=%d compares=%d, want %d and %d", hashes.Load(), compares.Load(), wantHashes, wantCompares)
			}
			authHTTPFree(t, work)
			if stage == "before-admission" {
				authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{"}), 400, common.ErrorCodeInvalidRequestBody)
			} else if strings.HasPrefix(stage, "login") {
				authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{"}), 429, common.ErrorCodeAuthRateLimited)
			}
		})
	}
}

func TestAuthHTTPCanceledWorkerRetainsReservation(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	ready, release := make(chan struct{}, 1), make(chan struct{})
	var creates atomic.Int32
	work := authHTTPWork(t, nil, func(string, string) (bool, error) { ready <- struct{}{}; <-release; return true, nil })
	other, err := work.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err := db.Callback().Create().Before("gorm:create").Register("test:auth-no-canceled-token", func(*gorm.DB) { creates.Add(1) }); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove("test:auth-no-canceled-token") })
	engine := authHTTPRouter(t, db, work, authHTTPPolicy(), time.Now)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var finish sync.Once
	defer finish.Do(func() { close(release) })
	result := authHTTPAsync(engine, authHTTPRequest{ctx: ctx, path: "/v1/auth/login", body: authHTTPLogin(user, "old-password")})
	authHTTPAwait(t, ready)
	cancel()
	authHTTPError(t, authHTTPAwait(t, authHTTPAsync(engine, authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(user, "old-password")})), 503, common.ErrorCodeAuthCapacityExceeded)
	finish.Do(func() { close(release) })
	response := authHTTPAwait(t, result)
	if creates.Load() != 0 || (response.Code == 200 && response.Body.Len() > 0) {
		t.Fatalf("canceled comparison issued a token or success: creates=%d response=%s", creates.Load(), response.Body.String())
	}
	other.Close()
	authHTTPFree(t, work)
}

func TestAuthHTTPRouteMembershipCORSAndSourceFailure(t *testing.T) {
	db := authHTTPDB(t)
	policy := authHTTPPolicy()
	policy.LoginLimit, policy.RegistrationLimit = 1, 1
	now := time.Unix(1000, 0)
	engine := authHTTPRouter(t, db, authHTTPWork(t, nil, nil), policy, func() time.Time { return now })
	origin := http.Header{"Origin": {"https://test.example.invalid"}}
	for _, route := range []struct{ method, path string }{
		{"GET", "/v1/health"}, {"POST", "/v1/auth/refresh"}, {"POST", "/v1/auth/logout"},
		{"POST", "/v1/auth/send-verification-email"}, {"POST", "/v1/auth/verify-email"},
		{"PUT", "/v1/user/password"}, {"GET", "/v1/auth/login"}, {"PUT", "/v1/auth/register"},
		{"POST", "/v1/auth/unknown"}, {"OPTIONS", "/v1/auth/login"}, {"OPTIONS", "/v1/auth/register"},
	} {
		response := authHTTPSend(engine, authHTTPRequest{method: route.method, path: route.path, body: "{", headers: origin})
		if response.Code == 429 || response.Code == 503 {
			t.Fatalf("unaffected route %s %s consumed a public quota", route.method, route.path)
		}
		if route.method == "OPTIONS" && (response.Code != 204 || response.Header().Get("Access-Control-Max-Age") != "43200") {
			t.Fatalf("preflight contract changed: %d %v", response.Code, response.Header())
		}
	}
	for _, invalidPeer := range []string{"unparseable", "/tmp/socket", ""} {
		request := authHTTPRequest{path: "/v1/auth/login", body: "{", peer: invalidPeer, headers: http.Header{"X-Forwarded-For": {"198.51.100.8"}}}
		if invalidPeer == "" {
			// A non-empty invalid string bypasses the helper's ordinary peer default.
			request.peer = "unix:"
		}
		response := authHTTPSend(engine, request)
		authHTTPError(t, response, 500, common.ErrorCodeInternalServerError)
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("unresolved source error must be non-cacheable")
		}
	}
	for _, path := range []string{"/v1/auth/login", "/v1/auth/register"} {
		authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: path, body: "{", headers: origin}), 400, common.ErrorCodeInvalidRequestBody)
		response := authHTTPSend(engine, authHTTPRequest{path: path, body: "{", headers: origin})
		authHTTPError(t, response, 429, common.ErrorCodeAuthRateLimited)
		for header, want := range map[string]string{"Access-Control-Allow-Origin": "https://test.example.invalid", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Origin, Content-Type, Authorization", "Access-Control-Expose-Headers": "Retry-After", "Vary": "Origin"} {
			if response.Header().Get(header) != want {
				t.Fatalf("CORS %s = %q, want %q", header, response.Header().Get(header), want)
			}
		}
	}
	denied := authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{", headers: http.Header{"Origin": {"https://other.example.invalid"}}})
	if denied.Header().Get("Access-Control-Allow-Origin") != "" || denied.Header().Get("Access-Control-Expose-Headers") != "" {
		t.Fatal("disallowed browser origin received CORS permission")
	}
}

func TestAuthHTTPTrustedProxyAndStorePrecedence(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	var queries, creates, workers atomic.Int32
	if err := db.Callback().Query().Before("gorm:query").Register("test:auth-store-query", func(*gorm.DB) { queries.Add(1) }); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Create().Before("gorm:create").Register("test:auth-store-create", func(*gorm.DB) { creates.Add(1) }); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Callback().Query().Remove("test:auth-store-query")
		_ = db.Callback().Create().Remove("test:auth-store-create")
	})
	work := authHTTPWork(t, nil, func(string, string) (bool, error) { workers.Add(1); return true, nil })
	now := time.Unix(1000, 0)
	policy := authHTTPPolicy()
	policy.LoginLimit, policy.TotalLimit, policy.SourceLimit = 1, 2, 1
	engine := authHTTPRouter(t, db, work, policy, func() time.Time { return now }, netip.MustParsePrefix("10.0.0.0/24"))
	trusted := authHTTPRequest{path: "/v1/auth/login", body: "{", peer: "10.0.0.1:123", headers: http.Header{"X-Forwarded-For": {"203.0.113.9", "10.0.0.2"}}}
	authHTTPError(t, authHTTPSend(engine, trusted), 400, common.ErrorCodeInvalidRequestBody)
	// Both header fields formed one chain; an untrusted direct request shares its key.
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{", peer: "203.0.113.9:999"}), 429, common.ErrorCodeAuthRateLimited)
	newSource := authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(user, "old-password"), peer: "203.0.113.10:123"}
	authHTTPError(t, authHTTPSend(engine, newSource), 503, common.ErrorCodeAuthCapacityExceeded)
	// Store refusal appended nothing; the retained existing source can use registration.
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/register", body: "{", peer: "203.0.113.9:123"}), 400, common.ErrorCodeInvalidRequestBody)
	authHTTPError(t, authHTTPSend(engine, newSource), 429, common.ErrorCodeAuthRateLimited)
	if queries.Load() != 0 || creates.Load() != 0 || workers.Load() != 0 {
		t.Fatalf("store/quota refusal ran queries=%d creates=%d workers=%d", queries.Load(), creates.Load(), workers.Load())
	}
	now = now.Add(time.Minute)
	newSource.body = "{"
	authHTTPError(t, authHTTPSend(engine, newSource), 400, common.ErrorCodeInvalidRequestBody)

	// A malformed element in an earlier repeated field invalidates the entire chain.
	other := authHTTPRouter(t, db, authHTTPWork(t, nil, nil), policy, func() time.Time { return now }, netip.MustParsePrefix("10.0.0.0/24"))
	malformed := authHTTPRequest{path: "/v1/auth/login", body: "{", peer: "10.0.0.1:123", headers: http.Header{"X-Forwarded-For": {"203.0.113.9, malformed", "203.0.113.10"}}}
	authHTTPError(t, authHTTPSend(other, malformed), 400, common.ErrorCodeInvalidRequestBody)
	authHTTPError(t, authHTTPSend(other, authHTTPRequest{path: "/v1/auth/login", body: "{", peer: "10.0.0.1:999"}), 429, common.ErrorCodeAuthRateLimited)
}

func TestAuthHTTPRepeatedProductionRoutersShareLimits(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	previousDB := databases.DB
	databases.DB = db
	t.Cleanup(func() { databases.DB = previousDB })
	first, err := utils.DefaultPasswordWork().Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := utils.DefaultPasswordWork().Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	engines := []*gin.Engine{gin.New(), gin.New()}
	for _, engine := range engines {
		RouterV1Setup(engine)
	}
	peer := "203.0.113.249:123"
	for _, engine := range engines {
		authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(user, "old-password"), peer: peer}), 503, common.ErrorCodeAuthCapacityExceeded)
	}
	// Directly reconstructed handlers with nil Passwords also use the same gate.
	nilWorkers := authHTTPRouter(t, db, nil, authHTTPPolicy(), time.Now)
	access, err := utils.GenerateAccessToken(user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range []authHTTPRequest{
		{path: "/v1/auth/login", body: authHTTPLogin(user, "old-password")},
		{path: "/v1/auth/register", body: authHTTPRegister(user)},
		{method: http.MethodPut, path: "/v1/user/password", token: access, body: `{"old_password":"old-password","new_password":"new-password"}`},
	} {
		authHTTPError(t, authHTTPSend(nilWorkers, request), 503, common.ErrorCodeAuthCapacityExceeded)
	}
	first.Close()
	second.Close()
	for i := range 8 {
		authHTTPError(t, authHTTPSend(engines[i%2], authHTTPRequest{path: "/v1/auth/login", body: "{", peer: peer}), 400, common.ErrorCodeInvalidRequestBody)
	}
	authHTTPError(t, authHTTPSend(engines[1], authHTTPRequest{path: "/v1/auth/login", body: "{", peer: peer}), 429, common.ErrorCodeAuthRateLimited)
	authHTTPFree(t, utils.DefaultPasswordWork())
}

func TestAuthHTTPAdmittedOutcomesConsumeQuotaWithoutRefund(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	work := authHTTPWork(t, nil, nil)
	now := time.Unix(1000, 0)
	policy := authHTTPPolicy()
	policy.LoginLimit = 4
	engine := authHTTPRouter(t, db, work, policy, func() time.Time { return now })
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{"}), 400, common.ErrorCodeInvalidRequestBody)
	authHTTPTokenPair(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: fmt.Sprintf(`{"identifier":%q,"password":"old-password"}`, user.Email)}))
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(user, "bad-password")}), 401, common.ErrorCodeInvalidCredentials)
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
	busy := authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(user, "old-password"), headers: http.Header{"Origin": {"https://test.example.invalid"}}})
	authHTTPError(t, busy, 503, common.ErrorCodeAuthCapacityExceeded)
	if busy.Header().Get("Access-Control-Expose-Headers") != "Retry-After" {
		t.Fatal("browser capacity errors must expose Retry-After")
	}
	first.Close()
	second.Close()
	var queries, creates atomic.Int32
	if err := db.Callback().Query().Before("gorm:query").Register("test:auth-quota-no-query", func(*gorm.DB) { queries.Add(1) }); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Create().Before("gorm:create").Register("test:auth-quota-no-create", func(*gorm.DB) { creates.Add(1) }); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Callback().Query().Remove("test:auth-quota-no-query")
		_ = db.Callback().Create().Remove("test:auth-quota-no-create")
	})
	for range 2 {
		authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(user, "old-password")}), 429, common.ErrorCodeAuthRateLimited)
	}
	if queries.Load() != 0 || creates.Load() != 0 {
		t.Fatalf("throttle refusal ran queries=%d creates=%d", queries.Load(), creates.Load())
	}
	now = now.Add(59*time.Second + 400*time.Millisecond)
	retry := authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{"})
	authHTTPError(t, retry, 429, common.ErrorCodeAuthRateLimited)
	if retry.Header().Get("Retry-After") != "1" {
		t.Fatal("fractional Retry-After must round up")
	}
	now = now.Add(600 * time.Millisecond)
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{"}), 400, common.ErrorCodeInvalidRequestBody)
}

func TestAuthHTTPExpiredDeadlineDoesNotConsumeQuota(t *testing.T) {
	db := authHTTPDB(t)
	policy := authHTTPPolicy()
	policy.LoginLimit = 1
	var calls atomic.Int32
	work := authHTTPWork(t, nil, func(string, string) (bool, error) { calls.Add(1); return true, nil })
	engine := authHTTPRouter(t, db, work, policy, time.Now)
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	response := authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: `{"identifier":"unused","password":"old-password"}`, ctx: ctx})
	if calls.Load() != 0 || (response.Code == 200 && response.Body.Len() > 0) {
		t.Fatal("expired deadline started work or emitted success")
	}
	authHTTPError(t, authHTTPSend(engine, authHTTPRequest{path: "/v1/auth/login", body: "{"}), 400, common.ErrorCodeInvalidRequestBody)
	authHTTPFree(t, work)
}
