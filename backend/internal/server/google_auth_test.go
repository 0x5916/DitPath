package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"opencw/internal/authlimits"
	"opencw/internal/common"
	"opencw/internal/configs"
	"opencw/internal/googleauth"
	handlers "opencw/internal/handlers/v1"
	"opencw/internal/middlewares"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const googleTestOrigin = "https://test.example.invalid"
const googleTestBody = `{"credential":"test-token","nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}`

func googleTestRouter(t *testing.T) (*gin.Engine, *int) {
	t.Helper()
	previous, mode := configs.App, gin.Mode()
	configs.App.GoogleClientID = "123-test.apps.googleusercontent.com"
	configs.App.CORSOrigins = []string{googleTestOrigin}
	configs.App.GinMode = "debug" // Google must remain strict in development.
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { configs.App = previous; gin.SetMode(mode) })
	limiter, err := authlimits.NewLimiter(authlimits.DefaultPolicy(), nil)
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	CORSSetup(engine)
	auth := engine.Group("/v1/auth")
	calls := new(int)
	registerGoogleAuthRoutes(auth, nil, limiter, nil, func(context.Context, string, string) (googleauth.Identity, error) {
		*calls++
		return googleauth.Identity{}, googleauth.ErrInvalidCredential
	})
	for path, operation := range map[string]authlimits.Operation{"/login": authlimits.Login, "/register": authlimits.Registration} {
		auth.POST(path, middlewares.AuthRequestLimit(operation, limiter, nil), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	}
	return engine, calls
}

func googleTestRequest(engine *gin.Engine, method, path, origin, mediaType, header, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	request.Header.Set("Content-Type", mediaType)
	request.Header.Set("X-OpenCW-Auth", header)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	return response
}

func TestGoogleRouteProtectionAndPrecedence(t *testing.T) {
	for _, tc := range []struct {
		name, origin, mediaType, header, body, code string
		status                                      int
	}{
		{"missing origin", "", "application/json", "google", googleTestBody, common.ErrorCodeGoogleRequestRejected, 403},
		{"null origin", "null", "application/json", "google", googleTestBody, common.ErrorCodeGoogleRequestRejected, 403},
		{"untrusted debug origin", "https://evil.invalid", "application/json", "google", googleTestBody, common.ErrorCodeGoogleRequestRejected, 403},
		{"missing custom header", googleTestOrigin, "application/json", "", googleTestBody, common.ErrorCodeGoogleRequestRejected, 403},
		{"form body", googleTestOrigin, "application/x-www-form-urlencoded", "google", googleTestBody, common.ErrorCodeGoogleJSONRequired, 415},
		{"malformed JSON", googleTestOrigin, "application/json", "google", "{", common.ErrorCodeInvalidRequestBody, 400},
		{"oversized body", googleTestOrigin, "application/json", "google", strings.Repeat("x", 16385), common.ErrorCodeRequestBodyTooLarge, 413},
		{"invalid credential", googleTestOrigin, "application/json; charset=utf-8", "google", googleTestBody, common.ErrorCodeGoogleCredentialInvalid, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine, calls := googleTestRouter(t)
			response := googleTestRequest(engine, "POST", "/v1/auth/google", tc.origin, tc.mediaType, tc.header, tc.body)
			var body common.ErrorResponse
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != tc.status || body.Code != tc.code || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("response = %d %s, err=%v", response.Code, response.Body, err)
			}
			wantCalls := 0
			if tc.status == 401 {
				wantCalls = 1
			}
			if *calls != wantCalls {
				t.Fatalf("verification calls=%d, want=%d", *calls, wantCalls)
			}
			if tc.origin == "https://evil.invalid" && response.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("untrusted origin received CORS permission")
			}
		})
	}
	engine, calls := googleTestRouter(t)
	configs.App.GoogleClientID = ""
	response := googleTestRequest(engine, "POST", "/v1/auth/google", "", "text/plain", "", "{")
	if response.Code != 503 || !strings.Contains(response.Body.String(), common.ErrorCodeGoogleSignInDisabled) || *calls != 0 {
		t.Fatal("disabled precedence failed")
	}
}

func TestGooglePreflightAndSharedQuotas(t *testing.T) {
	engine, calls := googleTestRouter(t)
	for _, origin := range []string{googleTestOrigin, "https://evil.invalid"} {
		request := httptest.NewRequest("OPTIONS", "/v1/auth/google/register", nil)
		request.Header.Set("Origin", origin)
		request.Header.Set("Access-Control-Request-Method", "POST")
		request.Header.Set("Access-Control-Request-Headers", "content-type,x-opencw-auth")
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, request)
		if origin == googleTestOrigin {
			if response.Code != 204 || !strings.Contains(response.Header().Get("Access-Control-Allow-Headers"), "X-OpenCW-Auth") {
				t.Fatal("Google preflight rejected")
			}
		} else if response.Code != 403 || response.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatal("untrusted preflight allowed")
		}
	}
	for _, route := range []struct {
		google, password string
		limit            int
	}{{"/google", "/login", 10}, {"/google/register", "/register", 3}} {
		for i := 0; i < route.limit; i++ {
			body := googleTestBody
			if route.google == "/google/register" {
				body = strings.TrimSuffix(body, "}") + `,"username":"googleuser"}`
			}
			response := googleTestRequest(engine, "POST", "/v1/auth"+route.google, googleTestOrigin, "application/json", "google", body)
			if response.Code != 401 {
				t.Fatalf("admission %d: %d %s", i, response.Code, response.Body)
			}
		}
		response := googleTestRequest(engine, "POST", "/v1/auth"+route.password, googleTestOrigin, "application/json", "", "{}")
		if response.Code != 429 || response.Header().Get("Retry-After") == "" {
			t.Fatal("password and Google routes did not share quota")
		}
	}
	if *calls != 13 {
		t.Fatalf("preflight/refusal performed verification: %d", *calls)
	}
}

func TestGoogleRegisteredRoutesCreateAndReuseAccount(t *testing.T) {
	db := authHTTPDB(t)
	previousID := configs.App.GoogleClientID
	configs.App.GoogleClientID = "123-test.apps.googleusercontent.com"
	t.Cleanup(func() { configs.App.GoogleClientID = previousID })
	subject := uuid.NewString()
	email := subject + "@gmail.com"
	username := "g" + strings.ReplaceAll(subject, "-", "")[:12]
	t.Cleanup(func() {
		if err := db.Unscoped().Where("email = ?", email).Delete(&models.User{}).Error; err != nil {
			t.Error(err)
		}
	})
	engine := gin.New()
	CORSSetup(engine)
	limiter, err := authlimits.NewLimiter(authlimits.DefaultPolicy(), nil)
	if err != nil {
		t.Fatal(err)
	}
	registerGoogleAuthRoutes(engine.Group("/v1/auth"), db, limiter, nil, func(context.Context, string, string) (googleauth.Identity, error) {
		return googleauth.Identity{Subject: subject, Email: email, EmailVerified: true}, nil
	})
	userHandler := handlers.UserHandler{DB: db}
	engine.GET("/v1/user/me", middlewares.AuthRequired(), middlewares.LoadUser(db), userHandler.GetUserInfo)
	unknown := googleTestRequest(engine, "POST", "/v1/auth/google", googleTestOrigin, "application/json", "google", googleTestBody)
	authHTTPError(t, unknown, 409, common.ErrorCodeGoogleSignupRequired)
	var count int64
	if err := db.Model(&models.User{}).Where("email = ?", email).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("username prompt created an account: %d %v", count, err)
	}
	body := strings.TrimSuffix(googleTestBody, "}") + `,"username":"` + username + `"}`
	created := googleTestRequest(engine, "POST", "/v1/auth/google/register", googleTestOrigin, "application/json", "google", body)
	first := authHTTPTokenPair(t, created)
	returning := googleTestRequest(engine, "POST", "/v1/auth/google", googleTestOrigin, "application/json", "google", googleTestBody)
	second := authHTTPTokenPair(t, returning)
	if first.RefreshToken == second.RefreshToken {
		t.Fatal("returning sign-in reused a refresh credential")
	}
	for _, pair := range []common.AuthTokenPairResponse{first, second} {
		response := authHTTPSend(engine, authHTTPRequest{method: "GET", path: "/v1/user/me", token: pair.AccessToken})
		var info common.UserInfoResponse
		if json.Unmarshal(response.Body.Bytes(), &info) != nil || response.Code != 200 || info.Username != username || info.PasswordEnabled || !info.EmailVerified {
			t.Fatalf("issued token did not resolve its Google-only account: %d %s", response.Code, response.Body)
		}
	}
	if err := db.Model(&models.UserIdentity{}).Where("issuer = ? AND subject = ?", googleauth.Issuer, subject).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("returning login changed identity ownership: %d %v", count, err)
	}
}
