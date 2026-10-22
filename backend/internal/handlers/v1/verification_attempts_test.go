package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func verificationAttempts(t *testing.T, db *gorm.DB, otp models.EmailOTP, want int) {
	t.Helper()
	var actual models.EmailOTP
	if err := db.Unscoped().Take(&actual, "id = ?", otp.ID).Error; err != nil {
		t.Fatal(err)
	}
	if actual.FailedAttempts != want {
		t.Fatalf("persisted failed attempts=%d, want %d", actual.FailedAttempts, want)
	}
}

func TestEmailUpdateZeroRowsRemainsServerFailure(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	if err := db.Callback().Update().Before("gorm:update").Register("test:email-zero-update", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			tx.Statement.AddClause(clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "1 = 0"}}})
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Update().Remove("test:email-zero-update") })
	emailResponse(t, emailRequest((&UserHandler{DB: db}).UpdateEmail, user, `{"email":"new-address@example.invalid"}`), 500, common.ErrorCodeInternalServerError)
	var actual models.User
	if err := db.Take(&actual, "id = ?", user.ID).Error; err != nil || actual.Email != user.Email {
		t.Fatalf("zero-row update changed account: %v", err)
	}
}

func TestVerificationGuessBudgetPersistsAndResets(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	otp := emailTestOTP(t, db, user, "123456")
	for attempt := 1; attempt <= VerificationMaxFailedAttempts; attempt++ {
		// Reconstruct the handler to prove the budget does not live in memory.
		h := &AuthHandler{DB: db}
		response := emailRequest(h.VerifyEmail, user, `{"code":"654321"}`)
		if attempt < VerificationMaxFailedAttempts {
			emailResponse(t, response, 400, common.ErrorCodeVerificationCodeInvalid)
		} else {
			emailResponse(t, response, 429, common.ErrorCodeVerificationAttemptsExceeded)
			seconds, err := strconv.Atoi(response.Header().Get("Retry-After"))
			if err != nil || seconds < 1 || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("exhaustion headers=%v", response.Header())
			}
		}
		verificationAttempts(t, db, otp, attempt)
	}
	h := &AuthHandler{DB: db, GenerateCode: func() (string, error) { return "987654", nil }, SendEmail: func(string, string) error { return nil }}
	emailResponse(t, emailRequest(h.VerifyEmail, user, `{"code":"123456"}`), 429, common.ErrorCodeVerificationAttemptsExceeded)
	emailState(t, db, user, user.Email, false, otp, false, false)
	emailResponse(t, emailRequest(h.SendVerificationEmail, user, ""), 200, "Verification email sent")
	emailState(t, db, user, user.Email, false, otp, false, true)
	var newest models.EmailOTP
	if err := db.Where("user_id = ?", user.ID).Take(&newest).Error; err != nil {
		t.Fatal(err)
	}
	verificationAttempts(t, db, newest, 0)
	emailResponse(t, emailRequest(h.VerifyEmail, user, `{"code":"987654"}`), 200, "Email verified")
	verificationAttempts(t, db, otp, VerificationMaxFailedAttempts)
}

func TestVerificationGuessBudgetConcurrent(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	otp := emailTestOTP(t, db, user, "123456")
	const contenders = 16
	start := make(chan struct{})
	results := make(chan int, contenders)
	var pending sync.WaitGroup
	for range contenders {
		pending.Go(func() {
			<-start
			response := emailRequest((&AuthHandler{DB: db}).VerifyEmail, user, `{"code":"654321"}`)
			results <- response.Code
		})
	}
	close(start)
	pending.Wait()
	close(results)
	invalid, exhausted := 0, 0
	for status := range results {
		switch status {
		case http.StatusBadRequest:
			invalid++
		case http.StatusTooManyRequests:
			exhausted++
		default:
			t.Fatalf("unexpected status %d", status)
		}
	}
	if invalid != VerificationMaxFailedAttempts-1 || exhausted != contenders-invalid {
		t.Fatalf("invalid=%d exhausted=%d", invalid, exhausted)
	}
	verificationAttempts(t, db, otp, VerificationMaxFailedAttempts)
	emailState(t, db, user, user.Email, false, otp, false, false)
}

func TestVerificationGuessBudgetEligibility(t *testing.T) {
	for _, test := range []struct {
		name, body, code string
		attempts, status int
		expired, old     bool
	}{
		{"last-allowed-correct", `{"code":"123456"}`, "Email verified", 4, 200, false, false},
		{"exhausted-correct", `{"code":"123456"}`, common.ErrorCodeVerificationAttemptsExceeded, 5, 429, false, false},
		{"malformed-not-counted", `{"code":"bad"}`, common.ErrorCodeInvalidRequestBody, 0, 400, false, false},
		{"expired-wrong-not-counted", `{"code":"654321"}`, common.ErrorCodeVerificationCodeInvalid, 0, 400, true, false},
		{"expired-correct-not-counted", `{"code":"123456"}`, common.ErrorCodeVerificationCodeExpired, 0, 400, true, false},
		{"older-row-not-revived", `{"code":"654321"}`, common.ErrorCodeVerificationAttemptsExceeded, 5, 429, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			if test.old {
				older := emailTestOTP(t, db, user, "654321")
				if err := db.Model(&older).Update("created_at", time.Now().Add(-3*time.Minute)).Error; err != nil {
					t.Fatal(err)
				}
			}
			otp := emailTestOTP(t, db, user, "123456")
			updates := map[string]any{"failed_attempts": test.attempts}
			if test.expired {
				updates["expired_at"] = time.Now().Add(-time.Second)
			}
			if err := db.Model(&otp).Updates(updates).Error; err != nil {
				t.Fatal(err)
			}
			emailResponse(t, emailRequest((&AuthHandler{DB: db}).VerifyEmail, user, test.body), test.status, test.code)
			verificationAttempts(t, db, otp, test.attempts)
		})
	}
}

func TestVerificationExhaustionRetainsIssuanceCooldown(t *testing.T) {
	for _, test := range []struct {
		name, retry string
		age         time.Duration
	}{
		{name: "fresh", retry: "60"},
		{name: "fractional-remainder", retry: "1", age: 59*time.Second + 600*time.Millisecond},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			otp := emailTestOTP(t, db, user, "123456")
			// Share one clock: the host and PostgreSQL clocks can differ.
			now := time.Date(2026, time.October, 20, 0, 0, 0, 123456000, time.UTC)
			if err := db.Model(&otp).Updates(map[string]any{"created_at": now.Add(-test.age), "failed_attempts": VerificationMaxFailedAttempts}).Error; err != nil {
				t.Fatal(err)
			}
			var deliveries atomic.Int32
			h := &AuthHandler{DB: db, Now: func() time.Time { return now }, SendEmail: func(string, string) error { deliveries.Add(1); return nil }}
			response := emailRequest(h.VerifyEmail, user, `{"code":"123456"}`)
			emailResponse(t, response, 429, common.ErrorCodeVerificationAttemptsExceeded)
			if response.Header().Get("Retry-After") != test.retry {
				t.Fatalf("verification Retry-After=%q, want %q", response.Header().Get("Retry-After"), test.retry)
			}
			response = emailRequest(h.SendVerificationEmail, user, "")
			emailResponse(t, response, 429, common.ErrorCodeVerificationRateLimited)
			if response.Header().Get("Retry-After") != test.retry || deliveries.Load() != 0 {
				t.Fatalf("resend Retry-After=%q deliveries=%d, want %q and no delivery", response.Header().Get("Retry-After"), deliveries.Load(), test.retry)
			}
			verificationAttempts(t, db, otp, VerificationMaxFailedAttempts)
			emailState(t, db, user, user.Email, false, otp, false, false)
		})
	}
}

func TestVerificationGuessStorageFailure(t *testing.T) {
	for _, mode := range []string{"increment", "begin", "commit-before", "commit-after"} {
		t.Run(mode, func(t *testing.T) {
			db := postgresTestDB(t)
			user := postgresTestUser(t, db, "")
			otp := emailTestOTP(t, db, user, "123456")
			handlerDB := db
			if mode == "increment" {
				if err := db.Callback().Update().Before("gorm:update").Register("test:guess-failure", func(tx *gorm.DB) {
					if tx.Statement.Table == "email_otp" {
						tx.AddError(errors.New("injected attempt write failure"))
					}
				}); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = db.Callback().Update().Remove("test:guess-failure") })
			} else {
				pool, err := db.DB()
				if err != nil {
					t.Fatal(err)
				}
				var isolation atomic.Int32
				handlerDB = db.Session(&gorm.Session{NewDB: true, Context: context.Background()})
				handlerDB.Statement.ConnPool = &emailFaultPool{ConnPool: pool, pool: pool, mode: mode, isolation: &isolation}
			}
			emailResponse(t, emailRequest((&AuthHandler{DB: handlerDB}).VerifyEmail, user, `{"code":"654321"}`), 500, common.ErrorCodeDatabaseFailure)
			want := 0
			if mode == "commit-after" {
				want = 1 // Lost acknowledgement cannot undo an already committed write.
			}
			verificationAttempts(t, db, otp, want)
			emailState(t, db, user, user.Email, false, otp, false, false)
		})
	}
}
