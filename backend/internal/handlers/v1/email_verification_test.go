package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func emailTestOTP(t *testing.T, db *gorm.DB, user models.User, code string) models.EmailOTP {
	t.Helper()
	otp := models.EmailOTP{UserID: &user.ID, Email: user.Email, Code: code, ExpiredAt: time.Now().Add(10 * time.Minute)}
	otp.CreatedAt = time.Now().Add(-2 * time.Minute)
	if err := db.Create(&otp).Error; err != nil {
		t.Fatal(err)
	}
	return otp
}

func emailRequest(handler gin.HandlerFunc, snapshot models.User, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	requestContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ctx.Request = httptest.NewRequest(http.MethodPost, "/email-test", strings.NewReader(body)).WithContext(requestContext)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("user", &snapshot)
	handler(ctx)
	return recorder
}

func emailResponse(t *testing.T, response *httptest.ResponseRecorder, status int, value string) {
	t.Helper()
	var body struct {
		Code    string `json:"code"`
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("non-JSON response: %s", response.Body.String())
	}
	if response.Code != status || (status == http.StatusOK && body.Message != value) || (status != http.StatusOK && body.Code != value) {
		t.Fatalf("response = %d %s, want %d %s", response.Code, response.Body.String(), status, value)
	}
	if value == common.ErrorCodeVerificationCodeInvalid && body.Error != "Invalid verification code" {
		t.Fatalf("invalid-code message changed: %q", body.Error)
	}
	if value == common.ErrorCodeVerificationCodeExpired && body.Error != "Verification code expired" {
		t.Fatalf("expired-code message changed: %q", body.Error)
	}
}

func emailState(t *testing.T, db *gorm.DB, user models.User, address string, verified bool, otp models.EmailOTP, consumed, deleted bool) {
	t.Helper()
	var actual models.User
	if err := db.Unscoped().First(&actual, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	var row models.EmailOTP
	if err := db.Unscoped().First(&row, "id = ?", otp.ID).Error; err != nil {
		t.Fatal(err)
	}
	if actual.Email != address || actual.EmailVerified != verified || row.Verified != consumed || row.DeletedAt.Valid != deleted {
		t.Fatalf("state: email=%q verified=%v OTP consumed=%v deleted=%v; want %q %v %v %v", actual.Email, actual.EmailVerified, row.Verified, row.DeletedAt.Valid, address, verified, consumed, deleted)
	}
}

func emailAwait(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for deterministic email-operation gate")
	}
}

func emailResult(t *testing.T, result <-chan *httptest.ResponseRecorder) *httptest.ResponseRecorder {
	t.Helper()
	select {
	case response := <-result:
		return response
	case <-time.After(10 * time.Second):
		t.Fatal("email operation did not finish")
		return nil
	}
}

func emailAsync(handler gin.HandlerFunc, user models.User, body string) <-chan *httptest.ResponseRecorder {
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() { result <- emailRequest(handler, user, body) }()
	return result
}

// Polling only observes database evidence; elapsed time alone never proves a
// contender reached its row lock. Tests run sequentially in this disposable DB.
func emailWaitForLock(t *testing.T, db *gorm.DB) {
	t.Helper()
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		var waiting bool
		if err := db.Raw(`SELECT EXISTS (SELECT FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
			WHERE NOT l.granted AND a.datname = current_database() AND a.query LIKE '%users%'
			AND a.query LIKE '%FOR UPDATE%')`).Scan(&waiting).Error; err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-tick.C:
		case <-deadline.C:
			t.Fatal("contender never waited on PostgreSQL account lock")
		}
	}
}

func emailLockGate(t *testing.T, db *gorm.DB) (<-chan struct{}, func()) {
	t.Helper()
	locked, release := make(chan struct{}), make(chan struct{})
	var first, closeOnce sync.Once
	if err := db.Callback().Query().After("gorm:query").Register("test:email-holder", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			if _, ok := tx.Statement.Clauses["FOR"]; ok && tx.Error == nil {
				first.Do(func() { close(locked); <-release })
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	unblock := func() { closeOnce.Do(func() { close(release) }) }
	t.Cleanup(func() { unblock(); _ = db.Callback().Query().Remove("test:email-holder") })
	return locked, unblock
}

func TestEmailVerificationResponses(t *testing.T) {
	for _, test := range []struct {
		name, body, code                  string
		status                            int
		expired, verified, owner, missing bool
	}{
		{name: "normal", body: `{"code":"123456"}`, status: 200, code: "Email verified"},
		{name: "wrong", body: `{"code":"654321"}`, status: 400, code: common.ErrorCodeVerificationCodeInvalid},
		{name: "expired", body: `{"code":"123456"}`, expired: true, status: 400, code: common.ErrorCodeVerificationCodeExpired},
		{name: "malformed", body: `{`, status: 400, code: common.ErrorCodeInvalidRequestBody},
		{name: "short", body: `{"code":"12345"}`, status: 400, code: common.ErrorCodeInvalidRequestBody},
		{name: "numeric-sign-compatible", body: `{"code":"+12345"}`, status: 400, code: common.ErrorCodeVerificationCodeInvalid},
		{name: "numeric-decimal-compatible", body: `{"code":"123.45"}`, status: 400, code: common.ErrorCodeVerificationCodeInvalid},
		{name: "verified-before-body", body: `{`, verified: true, status: 400, code: common.ErrorCodeEmailAlreadyVerified},
		{name: "owner-before-body", body: `{`, owner: true, status: 409, code: common.ErrorCodeEmailVerifiedByAnother},
		{name: "deleted-before-body", body: `{`, missing: true, status: 401, code: common.ErrorCodeUserNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			otp := emailTestOTP(t, db, user, "123456")
			if test.expired {
				if err := db.Model(&otp).Update("expired_at", time.Now().Add(-time.Second)).Error; err != nil {
					t.Fatal(err)
				}
			}
			if test.verified {
				if err := db.Model(&user).Update("email_verified", true).Error; err != nil {
					t.Fatal(err)
				}
			}
			if test.owner {
				owner := postgresTestUser(t, db, user.Email)
				if err := db.Model(&owner).Update("email_verified", true).Error; err != nil {
					t.Fatal(err)
				}
			}
			if test.missing {
				if err := db.Delete(&user).Error; err != nil {
					t.Fatal(err)
				}
			}
			// Deliberately contradict the authoritative verification state.
			snapshot := user
			snapshot.EmailVerified = !test.verified
			h := &AuthHandler{DB: db}
			emailResponse(t, emailRequest(h.VerifyEmail, snapshot, test.body), test.status, test.code)
			emailState(t, db, user, user.Email, test.verified || test.status == 200, otp, test.status == 200, false)
			if test.status == 200 {
				emailResponse(t, emailRequest(h.VerifyEmail, user, test.body), 400, common.ErrorCodeEmailAlreadyVerified)
			}
		})
	}
}

func TestEmailVerificationAccountOrdering(t *testing.T) {
	for _, order := range []string{"update-before-verify", "verify-before-update", "update-before-send"} {
		t.Run(order, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			otp := emailTestOTP(t, db, user, "123456")
			address := uuid.NewString() + "@example.invalid"
			auth := &AuthHandler{DB: db, GenerateCode: func() (string, error) { return "654321", nil }, SendEmail: func(to, code string) error {
				if to != address || code != "654321" {
					return errors.New("delivery used stale middleware email")
				}
				return nil
			}}
			update := (&UserHandler{DB: db}).UpdateEmail
			locked, release := emailLockGate(t, db)
			firstHandler, firstBody := update, fmt.Sprintf(`{"email":%q}`, address)
			secondHandler, secondBody := auth.VerifyEmail, `{"code":"123456"}`
			if order == "verify-before-update" {
				firstHandler, secondHandler, firstBody, secondBody = secondHandler, firstHandler, secondBody, firstBody
			} else if order == "update-before-send" {
				secondHandler, secondBody = auth.SendVerificationEmail, ""
			}
			first := emailAsync(firstHandler, user, firstBody)
			emailAwait(t, locked)
			second := emailAsync(secondHandler, user, secondBody)
			emailWaitForLock(t, db)
			release()
			if order == "verify-before-update" {
				emailResponse(t, emailResult(t, first), 200, "Email verified")
				emailResponse(t, emailResult(t, second), 200, "Email updated")
			} else {
				emailResponse(t, emailResult(t, first), 200, "Email updated")
				if order == "update-before-send" {
					emailResponse(t, emailResult(t, second), 200, "Verification email sent")
					var issued models.EmailOTP
					if err := db.Where("user_id = ?", user.ID).First(&issued).Error; err != nil || issued.Email != address {
						t.Fatalf("issued email: %q, %v", issued.Email, err)
					}
				} else {
					emailResponse(t, emailResult(t, second), 400, common.ErrorCodeVerificationCodeInvalid)
				}
			}
			emailState(t, db, user, address, false, otp, order == "verify-before-update", order != "verify-before-update")
		})
	}
}

func TestEmailEightContenders(t *testing.T) {
	for _, operation := range []string{"verify", "send"} {
		t.Run(operation, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			var otp models.EmailOTP
			if operation == "verify" {
				otp = emailTestOTP(t, db, user, "123456")
			}
			var deliveries atomic.Int32
			h := &AuthHandler{DB: db, GenerateCode: func() (string, error) { return "123456", nil }, SendEmail: func(string, string) error { deliveries.Add(1); return nil }}
			ready, release := make(chan struct{}, 8), make(chan struct{})
			var closeOnce sync.Once
			unblock := func() { closeOnce.Do(func() { close(release) }) }
			if err := db.Callback().Query().Before("gorm:query").Register("test:email-contenders", func(tx *gorm.DB) {
				if tx.Statement.Table == "users" {
					if _, ok := tx.Statement.Clauses["FOR"]; ok {
						ready <- struct{}{}
						<-release
					}
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { unblock(); _ = db.Callback().Query().Remove("test:email-contenders") })
			handler, body := h.VerifyEmail, `{"code":"123456"}`
			if operation == "send" {
				handler, body = h.SendVerificationEmail, ""
			}
			results := make([]<-chan *httptest.ResponseRecorder, 8)
			for i := range results {
				results[i] = emailAsync(handler, user, body)
			}
			for range results {
				emailAwait(t, ready)
			}
			unblock()
			winners := 0
			for _, result := range results {
				response := emailResult(t, result)
				if response.Code == 200 {
					winners++
					message := "Email verified"
					if operation == "send" {
						message = "Verification email sent"
					}
					emailResponse(t, response, 200, message)
				} else if operation == "verify" {
					emailResponse(t, response, 400, common.ErrorCodeEmailAlreadyVerified)
				} else {
					emailResponse(t, response, 429, common.ErrorCodeVerificationRateLimited)
					retry, err := strconv.Atoi(response.Header().Get("Retry-After"))
					if err != nil || retry < 1 || retry > 60 {
						t.Fatalf("Retry-After=%q", response.Header().Get("Retry-After"))
					}
				}
			}
			if winners != 1 {
				t.Fatalf("winners=%d, want one", winners)
			}
			if operation == "verify" {
				emailState(t, db, user, user.Email, true, otp, true, false)
			} else {
				var count int64
				if err := db.Unscoped().Model(&models.EmailOTP{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil || count != 1 || deliveries.Load() != 1 {
					t.Fatalf("issuances=%d deliveries=%d err=%v", count, deliveries.Load(), err)
				}
			}
		})
	}
}

func TestEmailVerificationHistory(t *testing.T) {
	t.Run("address-round-trip-and-reused-digits", func(t *testing.T) {
		db := postgresTestDB(t)
		user := postgresTestUser(t, db, "")
		old := emailTestOTP(t, db, user, "123456")
		update := (&UserHandler{DB: db}).UpdateEmail
		address := uuid.NewString() + "@example.invalid"
		emailResponse(t, emailRequest(update, user, fmt.Sprintf(`{"email":%q}`, address)), 200, "Email updated")
		// The second request still carries the original middleware snapshot.
		emailResponse(t, emailRequest(update, user, fmt.Sprintf(`{"email":%q}`, user.Email)), 200, "Email updated")
		h := &AuthHandler{DB: db, GenerateCode: func() (string, error) { return old.Code, nil }, SendEmail: func(string, string) error { return nil }}
		emailResponse(t, emailRequest(h.VerifyEmail, user, `{"code":"123456"}`), 400, common.ErrorCodeVerificationCodeInvalid)
		emailState(t, db, user, user.Email, false, old, false, true)
		emailResponse(t, emailRequest(h.SendVerificationEmail, user, ""), 200, "Verification email sent")
		var latest models.EmailOTP
		if err := db.Where("user_id = ?", user.ID).First(&latest).Error; err != nil || latest.ID == old.ID {
			t.Fatalf("new issuance missing: %v", err)
		}
		emailResponse(t, emailRequest(h.VerifyEmail, user, `{"code":"123456"}`), 200, "Email verified")
		emailState(t, db, user, user.Email, true, old, false, true)
		emailState(t, db, user, user.Email, true, latest, true, false)
	})
	t.Run("legacy-equal-timestamp-pending-and-resend", func(t *testing.T) {
		db := postgresTestDB(t)
		user := postgresTestUser(t, db, "")
		older := emailTestOTP(t, db, user, "111111")
		newer := emailTestOTP(t, db, user, "222222")
		// Explicitly choose UUID order while keeping the historical timestamps equal.
		if older.ID.String() > newer.ID.String() {
			older, newer = newer, older
		}
		if err := db.Model(&models.EmailOTP{}).Where("user_id = ?", user.ID).Update("created_at", older.CreatedAt).Error; err != nil {
			t.Fatal(err)
		}
		h := &AuthHandler{DB: db, GenerateCode: func() (string, error) { return "333333", nil }, SendEmail: func(string, string) error { return nil }}
		emailResponse(t, emailRequest(h.VerifyEmail, user, fmt.Sprintf(`{"code":%q}`, older.Code)), 400, common.ErrorCodeVerificationCodeInvalid)
		emailState(t, db, user, user.Email, false, older, false, false)
		emailResponse(t, emailRequest(h.SendVerificationEmail, user, ""), 200, "Verification email sent")
		emailResponse(t, emailRequest(h.VerifyEmail, user, fmt.Sprintf(`{"code":%q}`, newer.Code)), 400, common.ErrorCodeVerificationCodeInvalid)
		emailResponse(t, emailRequest(h.VerifyEmail, user, `{"code":"333333"}`), 200, "Email verified")
		emailState(t, db, user, user.Email, true, older, false, true)
		emailState(t, db, user, user.Email, true, newer, false, true)
	})
	t.Run("newest-equal-timestamp-wins", func(t *testing.T) {
		db := postgresTestDB(t)
		user := postgresTestUser(t, db, "")
		first, second := emailTestOTP(t, db, user, "111111"), emailTestOTP(t, db, user, "222222")
		if first.ID.String() > second.ID.String() {
			first, second = second, first
		}
		if err := db.Model(&models.EmailOTP{}).Where("user_id = ?", user.ID).Update("created_at", first.CreatedAt).Error; err != nil {
			t.Fatal(err)
		}
		h := &AuthHandler{DB: db}
		emailResponse(t, emailRequest(h.VerifyEmail, user, fmt.Sprintf(`{"code":%q}`, second.Code)), 200, "Email verified")
		emailState(t, db, user, user.Email, true, first, false, false)
		emailState(t, db, user, user.Email, true, second, true, false)
	})
}

func TestEmailLockedGuards(t *testing.T) {
	for _, test := range []struct {
		name, operation, body, code string
		status                      int
		deleted, verified, owner    bool
	}{
		{name: "update-compares-locked-address", operation: "update", code: common.ErrorCodeEmailUnchanged, status: 400},
		{name: "update-body-before-deleted", operation: "update", body: `{`, deleted: true, code: common.ErrorCodeInvalidRequestBody, status: 400},
		{name: "update-deleted", operation: "update", deleted: true, code: common.ErrorCodeUserNotFound, status: 401},
		{name: "update-verified-owner", operation: "update", owner: true, code: common.ErrorCodeEmailVerifiedByAnother, status: 409},
		{name: "send-deleted", operation: "send", deleted: true, code: common.ErrorCodeUserNotFound, status: 401},
		{name: "send-locked-verified", operation: "send", verified: true, code: common.ErrorCodeEmailAlreadyVerified, status: 400},
		{name: "send-locked-owner", operation: "send", owner: true, code: common.ErrorCodeEmailVerifiedByAnother, status: 409},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			otp := emailTestOTP(t, db, user, "123456")
			snapshot := user
			snapshot.Email = uuid.NewString() + "@example.invalid"
			snapshot.EmailVerified = !test.verified
			requested := user.Email
			if test.deleted {
				if err := db.Delete(&user).Error; err != nil {
					t.Fatal(err)
				}
			}
			if test.verified {
				if err := db.Model(&user).Update("email_verified", true).Error; err != nil {
					t.Fatal(err)
				}
			}
			if test.owner {
				owner := postgresTestUser(t, db, user.Email)
				if test.operation == "update" {
					owner = postgresTestUser(t, db, "")
					requested = owner.Email
				}
				if err := db.Model(&owner).Update("email_verified", true).Error; err != nil {
					t.Fatal(err)
				}
			}
			body := test.body
			if body == "" {
				body = fmt.Sprintf(`{"email":%q}`, requested)
			}
			var deliveries atomic.Int32
			h := &AuthHandler{DB: db, SendEmail: func(string, string) error { deliveries.Add(1); return nil }}
			handler := h.SendVerificationEmail
			if test.operation == "update" {
				handler = (&UserHandler{DB: db}).UpdateEmail
			}
			emailResponse(t, emailRequest(handler, snapshot, body), test.status, test.code)
			emailState(t, db, user, user.Email, test.verified, otp, false, false)
			if deliveries.Load() != 0 {
				t.Fatal("guarded request called provider")
			}
		})
	}
}

func TestEmailCooldownHistory(t *testing.T) {
	for _, test := range []string{"deleted-history-ceiling", "provider-failure-and-address-change"} {
		t.Run(test, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			var deliveries atomic.Int32
			now := time.Now().UTC().Truncate(time.Microsecond)
			h := &AuthHandler{DB: db, Now: func() time.Time { return now }, GenerateCode: func() (string, error) { return "123456", nil }, SendEmail: func(string, string) error { deliveries.Add(1); return errors.New("provider failed") }}
			if test == "deleted-history-ceiling" {
				otp := emailTestOTP(t, db, user, "123456")
				if err := db.Model(&otp).Update("created_at", now.Add(-59*time.Second-600*time.Millisecond)).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Delete(&otp).Error; err != nil {
					t.Fatal(err)
				}
			} else {
				emailResponse(t, emailRequest(h.SendVerificationEmail, user, ""), 500, common.ErrorCodeVerificationSendFailed)
				var issued models.EmailOTP
				if err := db.Unscoped().Where("user_id = ?", user.ID).First(&issued).Error; err != nil || !issued.DeletedAt.Valid {
					t.Fatalf("failed issuance not cleaned up: %v", err)
				}
			}
			address := uuid.NewString() + "@example.invalid"
			emailResponse(t, emailRequest((&UserHandler{DB: db}).UpdateEmail, user, fmt.Sprintf(`{"email":%q}`, address)), 200, "Email updated")
			response := emailRequest(h.SendVerificationEmail, user, "")
			emailResponse(t, response, 429, common.ErrorCodeVerificationRateLimited)
			wantRetry, wantDeliveries := "1", int32(0)
			if test != "deleted-history-ceiling" {
				wantRetry, wantDeliveries = "60", 1
			}
			if response.Header().Get("Retry-After") != wantRetry || deliveries.Load() != wantDeliveries {
				t.Fatalf("retry=%q deliveries=%d, want %q %d", response.Header().Get("Retry-After"), deliveries.Load(), wantRetry, wantDeliveries)
			}
		})
	}
}

func TestEmailProviderOutsideTransaction(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	provider, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	t.Cleanup(unblock)
	h := &AuthHandler{DB: db, GenerateCode: func() (string, error) { return "123456", nil }, SendEmail: func(to, code string) error {
		if to != user.Email || code != "123456" {
			return errors.New("provider arguments changed")
		}
		close(provider)
		<-release
		return nil
	}}
	sending := emailAsync(h.SendVerificationEmail, user, "")
	emailAwait(t, provider)
	var issued models.EmailOTP
	if err := db.Where("user_id = ?", user.ID).First(&issued).Error; err != nil {
		t.Fatal(err)
	}
	address := uuid.NewString() + "@example.invalid"
	// Completion while the provider is paused proves issuance released its lock.
	updating := emailAsync((&UserHandler{DB: db}).UpdateEmail, user, fmt.Sprintf(`{"email":%q}`, address))
	emailResponse(t, emailResult(t, updating), 200, "Email updated")
	unblock()
	emailResponse(t, emailResult(t, sending), 200, "Verification email sent")
	emailResponse(t, emailRequest(h.VerifyEmail, user, `{"code":"123456"}`), 400, common.ErrorCodeVerificationCodeInvalid)
	emailState(t, db, user, address, false, issued, false, true)
}

func TestEmailFailedDeliveryCleanup(t *testing.T) {
	for _, scenario := range []string{"newer-issuance", "consumed-issuance", "cleanup-failure", "deleted-account"} {
		t.Run(scenario, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			provider, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			t.Cleanup(unblock)
			var generated atomic.Int32
			h := &AuthHandler{DB: db, GenerateCode: func() (string, error) {
				if generated.Add(1) == 1 {
					return "123456", nil
				}
				return "654321", nil
			}, SendEmail: func(_ string, code string) error {
				if code == "123456" {
					close(provider)
					<-release
					return errors.New("provider failed")
				}
				return nil
			}}
			sending := emailAsync(h.SendVerificationEmail, user, "")
			emailAwait(t, provider)
			var issued, newer models.EmailOTP
			if err := db.Where("user_id = ?", user.ID).First(&issued).Error; err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "newer-issuance":
				if err := db.Model(&issued).Update("created_at", time.Now().Add(-2*time.Minute)).Error; err != nil {
					t.Fatal(err)
				}
				locked, releaseAccount := emailLockGate(t, db)
				resending := emailAsync(h.SendVerificationEmail, user, "")
				emailAwait(t, locked)
				unblock()
				emailWaitForLock(t, db)
				releaseAccount()
				emailResponse(t, emailResult(t, resending), 200, "Verification email sent")
				if err := db.Where("user_id = ?", user.ID).First(&newer).Error; err != nil || newer.ID == issued.ID {
					t.Fatalf("new issuance missing: %v", err)
				}
			case "consumed-issuance":
				locked, releaseAccount := emailLockGate(t, db)
				verifying := emailAsync(h.VerifyEmail, user, `{"code":"123456"}`)
				emailAwait(t, locked)
				unblock()
				emailWaitForLock(t, db)
				releaseAccount()
				emailResponse(t, emailResult(t, verifying), 200, "Email verified")
			case "cleanup-failure":
				if err := db.Callback().Delete().Before("gorm:delete").Register("test:email-cleanup-error", func(tx *gorm.DB) { tx.AddError(errors.New("cleanup write failed")) }); err != nil {
					t.Fatal(err)
				}
			case "deleted-account":
				if err := db.Delete(&user).Error; err != nil {
					t.Fatal(err)
				}
			}
			unblock()
			emailResponse(t, emailResult(t, sending), 500, common.ErrorCodeVerificationSendFailed)
			if scenario == "cleanup-failure" {
				if err := db.Callback().Delete().Remove("test:email-cleanup-error"); err != nil {
					t.Fatal(err)
				}
			}
			emailState(t, db, user, user.Email, scenario == "consumed-issuance", issued, scenario == "consumed-issuance", scenario == "newer-issuance")
			if scenario == "newer-issuance" {
				emailState(t, db, user, user.Email, false, newer, false, false)
			}
		})
	}
}

func TestEmailVerificationExpiry(t *testing.T) {
	t.Run("expires-while-waiting-for-lock", func(t *testing.T) {
		db := postgresTestDB(t)
		user := postgresTestUser(t, db, "")
		otp := emailTestOTP(t, db, user, "123456")
		if err := db.Model(&otp).Update("expired_at", gorm.Expr("clock_timestamp() + interval '1 second'")).Error; err != nil {
			t.Fatal(err)
		}
		holder := db.Begin(&sql.TxOptions{Isolation: sql.LevelReadCommitted})
		if holder.Error != nil {
			t.Fatal(holder.Error)
		}
		t.Cleanup(func() { _ = holder.Rollback().Error })
		if err := holder.Exec("SELECT id FROM users WHERE id = ? FOR UPDATE", user.ID).Error; err != nil {
			t.Fatal(err)
		}
		verifying := emailAsync((&AuthHandler{DB: db}).VerifyEmail, user, `{"code":"123456"}`)
		emailWaitForLock(t, db)
		deadline := time.NewTimer(10 * time.Second)
		defer deadline.Stop()
		tick := time.NewTicker(5 * time.Millisecond)
		defer tick.Stop()
		for {
			var expired bool
			if err := db.Raw("SELECT expired_at <= clock_timestamp() FROM email_otp WHERE id = ?", otp.ID).Scan(&expired).Error; err != nil {
				t.Fatal(err)
			}
			if expired {
				break
			}
			select {
			case <-tick.C:
			case <-deadline.C:
				t.Fatal("OTP did not expire while request waited")
			}
		}
		if err := holder.Commit().Error; err != nil {
			t.Fatal(err)
		}
		emailResponse(t, emailResult(t, verifying), 400, common.ErrorCodeVerificationCodeExpired)
		emailState(t, db, user, user.Email, false, otp, false, false)
	})
	for _, boundary := range []string{"exact-equality", "one-microsecond-before"} {
		t.Run(boundary, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			otp := emailTestOTP(t, db, user, "123456")
			expires := time.Now().Add(time.Minute).UTC().Truncate(time.Microsecond)
			if err := db.Model(&otp).Update("expired_at", expires).Error; err != nil {
				t.Fatal(err)
			}
			now := expires
			if boundary != "exact-equality" {
				now = now.Add(-time.Microsecond)
			}
			h := &AuthHandler{DB: db, Now: func() time.Time { return now }}
			status, code := 400, common.ErrorCodeVerificationCodeExpired
			if boundary != "exact-equality" {
				status, code = 200, "Email verified"
			}
			emailResponse(t, emailRequest(h.VerifyEmail, user, `{"code":"123456"}`), status, code)
			emailState(t, db, user, user.Email, status == 200, otp, status == 200, false)
		})
	}
}

func TestEmailVerificationUniqueOwnerRace(t *testing.T) {
	db := postgresTestDB(t)
	first := postgresTestUser(t, db, "")
	second := postgresTestUser(t, db, first.Email)
	otps := []models.EmailOTP{emailTestOTP(t, db, first, "123456"), emailTestOTP(t, db, second, "123456")}
	ready, release := make(chan struct{}, 2), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	// Each participant holds a different account row. Both have passed the
	// nonlocking owner check before either attempts the unique-index write.
	if err := db.Callback().Update().Before("gorm:update").Register("test:email-unique-race", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			ready <- struct{}{}
			<-release
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { unblock(); _ = db.Callback().Update().Remove("test:email-unique-race") })
	h := &AuthHandler{DB: db}
	results := []<-chan *httptest.ResponseRecorder{emailAsync(h.VerifyEmail, first, `{"code":"123456"}`), emailAsync(h.VerifyEmail, second, `{"code":"123456"}`)}
	for range results {
		emailAwait(t, ready)
	}
	unblock()
	winners := 0
	for i, result := range results {
		response := emailResult(t, result)
		won := response.Code == 200
		if won {
			winners++
			emailResponse(t, response, 200, "Email verified")
		} else {
			emailResponse(t, response, 409, common.ErrorCodeEmailVerifiedByAnother)
		}
		user := first
		if i == 1 {
			user = second
		}
		emailState(t, db, user, user.Email, won, otps[i], won, false)
	}
	var owners int64
	if err := db.Model(&models.User{}).Where("email = ? AND email_verified = true", first.Email).Count(&owners).Error; err != nil || owners != 1 || winners != 1 {
		t.Fatalf("owners=%d winners=%d err=%v", owners, winners, err)
	}
}

func TestEmailUpdateInvalidatesAllPending(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	current := emailTestOTP(t, db, user, "111111")
	historicalUser := user
	historicalUser.Email = uuid.NewString() + "@example.invalid"
	historical := emailTestOTP(t, db, historicalUser, "222222")
	consumed := emailTestOTP(t, db, user, "333333")
	if err := db.Model(&historical).Update("expired_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&consumed).Update("verified", true).Error; err != nil {
		t.Fatal(err)
	}
	address := uuid.NewString() + "@example.invalid"
	emailResponse(t, emailRequest((&UserHandler{DB: db}).UpdateEmail, user, fmt.Sprintf(`{"email":%q}`, address)), 200, "Email updated")
	emailState(t, db, user, address, false, current, false, true)
	emailState(t, db, user, address, false, historical, false, true)
	emailState(t, db, user, address, false, consumed, true, false)
}

func TestEmailRequestContextCancellation(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	otp := emailTestOTP(t, db, user, "123456")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	requestContext, cancel := context.WithCancel(context.Background())
	cancel()
	ctx.Request = httptest.NewRequest(http.MethodPost, "/email-test", strings.NewReader(`{"code":"123456"}`)).WithContext(requestContext)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("user", &user)
	(&AuthHandler{DB: db}).VerifyEmail(ctx)
	emailResponse(t, recorder, 500, common.ErrorCodeDatabaseFailure)
	emailState(t, db, user, user.Email, false, otp, false, false)
}

type emailFaultPool struct {
	gorm.ConnPool
	pool      *sql.DB
	mode      string
	isolation *atomic.Int32
}

func (p *emailFaultPool) BeginTx(ctx context.Context, options *sql.TxOptions) (gorm.ConnPool, error) {
	if options != nil && options.Isolation == sql.LevelReadCommitted {
		p.isolation.Add(1)
	}
	if p.mode == "begin" {
		return nil, errors.New("injected begin failure")
	}
	tx, err := p.pool.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return &emailFaultTx{Tx: tx, mode: p.mode}, nil
}

type emailFaultTx struct {
	*sql.Tx
	mode string
}

func (tx *emailFaultTx) Commit() error {
	if tx.mode == "commit-before" {
		return errors.New("injected definite commit failure")
	}
	if err := tx.Tx.Commit(); err != nil {
		return err
	}
	return errors.New("injected lost commit acknowledgement")
}

func TestEmailDatabaseFailures(t *testing.T) {
	for _, operation := range []string{"verify", "send", "update"} {
		faults := []string{"lock-read", "owner-read", "user-write", "begin", "commit-before", "commit-after"}
		if operation == "verify" {
			faults = append(faults, "otp-read", "consume", "consume-zero", "user-zero")
		}
		if operation == "send" {
			faults = []string{"lock-read", "owner-read", "otp-read", "invalidate", "insert", "generate", "begin", "commit-before", "commit-after"}
		}
		if operation == "update" {
			faults = append(faults, "invalidate")
		}
		for _, fault := range faults {
			t.Run(operation+"/"+fault, func(t *testing.T) {
				db := postgresTestDB(t)
				user := postgresTestUser(t, db, "")
				otp := emailTestOTP(t, db, user, "123456")
				address := uuid.NewString() + "@example.invalid"
				injected := errors.New("injected email transaction failure")
				var deliveries atomic.Int32
				var remove func() error
				callback := func(tx *gorm.DB) {
					if (fault == "consume-zero" && tx.Statement.Table == "email_otp") || (fault == "user-zero" && tx.Statement.Table == "users") {
						tx.Statement.AddClause(clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "1 = 0"}}})
						return
					}
					_, locking := tx.Statement.Clauses["FOR"]
					match := (fault == "lock-read" && tx.Statement.Table == "users" && locking) ||
						(fault == "owner-read" && tx.Statement.Table == "users" && !locking) ||
						(fault == "otp-read" && tx.Statement.Table == "email_otp") ||
						(fault == "user-write" && tx.Statement.Table == "users") ||
						((fault == "consume" || fault == "invalidate" || fault == "insert") && tx.Statement.Table == "email_otp")
					if match {
						tx.AddError(injected)
					}
				}
				const callbackName = "test:email-injected-error"
				switch fault {
				case "lock-read", "owner-read", "otp-read":
					if err := db.Callback().Query().Before("gorm:query").Register(callbackName, callback); err != nil {
						t.Fatal(err)
					}
					remove = func() error { return db.Callback().Query().Remove(callbackName) }
				case "user-write", "consume", "consume-zero", "user-zero":
					if err := db.Callback().Update().Before("gorm:update").Register(callbackName, callback); err != nil {
						t.Fatal(err)
					}
					remove = func() error { return db.Callback().Update().Remove(callbackName) }
				case "invalidate":
					if err := db.Callback().Delete().Before("gorm:delete").Register(callbackName, callback); err != nil {
						t.Fatal(err)
					}
					remove = func() error { return db.Callback().Delete().Remove(callbackName) }
				case "insert":
					if err := db.Callback().Create().Before("gorm:create").Register(callbackName, callback); err != nil {
						t.Fatal(err)
					}
					remove = func() error { return db.Callback().Create().Remove(callbackName) }
				}
				if remove != nil {
					t.Cleanup(func() { _ = remove() })
				}
				handlerDB := db
				var isolation atomic.Int32
				if fault == "begin" || strings.HasPrefix(fault, "commit-") {
					pool, err := db.DB()
					if err != nil {
						t.Fatal(err)
					}
					handlerDB = db.Session(&gorm.Session{NewDB: true, Context: context.Background()})
					handlerDB.Statement.ConnPool = &emailFaultPool{ConnPool: pool, pool: pool, mode: fault, isolation: &isolation}
				}
				h := &AuthHandler{DB: handlerDB, GenerateCode: func() (string, error) {
					if fault == "generate" {
						return "", injected
					}
					return "654321", nil
				}, SendEmail: func(string, string) error { deliveries.Add(1); return nil }}
				handler, body := h.VerifyEmail, `{"code":"123456"}`
				if operation == "send" {
					handler, body = h.SendVerificationEmail, ""
				}
				if operation == "update" {
					handler, body = (&UserHandler{DB: handlerDB}).UpdateEmail, fmt.Sprintf(`{"email":%q}`, address)
				}
				code := common.ErrorCodeDatabaseFailure
				if (operation == "update" && fault != "owner-read") || fault == "generate" {
					code = common.ErrorCodeInternalServerError
				}
				status := 500
				if strings.HasSuffix(fault, "-zero") {
					status, code = 400, common.ErrorCodeVerificationCodeInvalid
				}
				emailResponse(t, emailRequest(handler, user, body), status, code)
				if remove != nil {
					if err := remove(); err != nil {
						t.Fatal(err)
					}
				}
				if deliveries.Load() != 0 {
					t.Fatal("provider called before successful issuance commit")
				}
				if fault == "begin" || strings.HasPrefix(fault, "commit-") {
					if isolation.Load() != 1 {
						t.Fatalf("READ COMMITTED begin calls=%d", isolation.Load())
					}
				}
				committed := fault == "commit-after"
				wantAddress := user.Email
				if committed && operation == "update" {
					wantAddress = address
				}
				emailState(t, db, user, wantAddress, committed && operation == "verify", otp, committed && operation == "verify", committed && operation != "verify")
				var count int64
				if err := db.Unscoped().Model(&models.EmailOTP{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil {
					t.Fatal(err)
				}
				wantCount := int64(1)
				if committed && operation == "send" {
					wantCount++
				}
				if count != wantCount {
					t.Fatalf("OTP count=%d, want %d", count, wantCount)
				}
			})
		}
	}
}
