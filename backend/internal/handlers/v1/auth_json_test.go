package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"opencw/internal/common"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
)

func TestAuthJSONCompleteBodyLimit(t *testing.T) {
	const valid = `{"identifier":"ordinary","password":"ordinary-password"}`
	for _, test := range []struct {
		name, body string
		length     int64
		oversize   bool
	}{
		{"ordinary", valid, int64(len(valid)), false},
		{"exact-limit", valid + strings.Repeat(" ", int(AuthJSONMaxBytes)-len(valid)), AuthJSONMaxBytes, false},
		{"declared-over", valid, AuthJSONMaxBytes + 1, true},
		{"unknown-length", valid + strings.Repeat(" ", int(AuthJSONMaxBytes)), -1, true},
		{"false-short-length", valid + strings.Repeat(" ", int(AuthJSONMaxBytes)), 1, true},
		{"ignored-field", `{"identifier":"ordinary","password":"ordinary-password","ignored":"` + strings.Repeat("x", int(AuthJSONMaxBytes)) + `"}`, -1, true},
		{"second-value", valid + `{"ignored":"` + strings.Repeat("x", int(AuthJSONMaxBytes)) + `"}`, -1, true},
		{"escaped-content", `{"identifier":"ordinary","password":"` + strings.Repeat(`\u0061`, int(AuthJSONMaxBytes)/6) + `"}`, -1, true},
		// Retain Gin's existing single-value decoding for small complete bodies.
		{"small-second-value-compatible", valid + `{}`, -1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(response)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(test.body))
			ctx.Request.ContentLength = test.length
			ctx.Request.Header.Set("Content-Type", "text/plain")
			var input common.LoginInput
			err := bindAuthJSON(ctx, &input)
			if errors.Is(err, errAuthBodyTooLarge) != test.oversize {
				t.Fatalf("oversize=%v err=%v", test.oversize, err)
			}
			if !test.oversize && (err != nil || input.Identifier != "ordinary" || input.Password != "ordinary-password") {
				t.Fatalf("ordinary binding changed: %v %+v", err, input)
			}
		})
	}
}

func TestAuthJSONOversizeAllConsumers(t *testing.T) {
	auth, user := &AuthHandler{}, &UserHandler{}
	for name, handler := range map[string]func(*gin.Context){
		"register": auth.Register, "login": auth.Login, "refresh": auth.Refresh, "logout": auth.Logout,
		"verify": auth.VerifyEmail, "password": user.UpdatePassword, "email": user.UpdateEmail, "callsign": user.UpdateCallSign,
	} {
		t.Run(name, func(t *testing.T) {
			response := emailRequest(handler, models.User{}, strings.Repeat("x", int(AuthJSONMaxBytes)+1))
			var body common.ErrorResponse
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != 413 || body.Code != common.ErrorCodeRequestBodyTooLarge {
				t.Fatalf("oversized body: %d %s", response.Code, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store")
			}
		})
	}
}

type endlessAuthBody struct{ read int }

func (r *endlessAuthBody) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = ' '
	}
	r.read += len(p)
	return len(p), nil
}
func (*endlessAuthBody) Close() error { return nil }

func TestAuthJSONReadsAtMostLimitPlusOne(t *testing.T) {
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	reader := &endlessAuthBody{}
	ctx.Request.Body, ctx.Request.ContentLength = reader, -1
	err := bindAuthJSON(ctx, &common.LoginInput{})
	if !errors.Is(err, errAuthBodyTooLarge) || reader.read != int(AuthJSONMaxBytes)+1 {
		t.Fatalf("unbounded read: bytes=%d err=%v", reader.read, err)
	}
}

func TestAuthJSONInvalidAndReadFailure(t *testing.T) {
	for _, body := range []io.ReadCloser{io.NopCloser(strings.NewReader(`{`)), &failingAuthBody{}} {
		response := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(response)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		ctx.Request.Body = body
		err := bindAuthJSON(ctx, &common.LoginInput{})
		if err == nil {
			t.Fatal("malformed/read failure accepted")
		}
		respondAuthBindingError(ctx, err)
		if response.Code != 400 {
			t.Fatalf("invalid-body status=%d", response.Code)
		}
	}
}

type failingAuthBody struct{}

func (*failingAuthBody) Read([]byte) (int, error) { return 0, errors.New("injected read failure") }
func (*failingAuthBody) Close() error             { return nil }
