package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"morsewell/internal/authlimits"
	"morsewell/internal/common"
	"morsewell/internal/configs"
	"morsewell/internal/googleauth"
	handlers "morsewell/internal/handlers/v1"
	"morsewell/internal/middlewares"
	"morsewell/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const linkRoute = "/v1/auth/google/link"

type testLinkIntent struct{ Challenge, Nonce string }

func readLinkIntent(t *testing.T, response *httptest.ResponseRecorder) testLinkIntent {
	t.Helper()
	var intent testLinkIntent
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &intent) != nil || intent.Challenge == "" || intent.Nonce == "" {
		t.Fatalf("invalid challenge response: %d %s", response.Code, response.Body)
	}
	return intent
}

func TestGoogleLinkRouteProtection(t *testing.T) {
	router, _ := googleTestRouter(t)
	proof, err := googleauth.NewLinkChallenge(configs.App.JWTSecret, uuid.New(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{linkRoute, linkRoute + "/challenge"} {
		headers := http.Header{"Origin": {googleTestOrigin}, "X-Opencw-Auth": {"google"}}
		for _, tc := range []struct{ token, code string }{{"", common.ErrorCodeAuthHeaderRequired}, {proof, common.ErrorCodeInvalidToken}} {
			response := authHTTPSend(router, authHTTPRequest{path: path, token: tc.token, headers: headers, body: "{}"})
			authHTTPError(t, response, 401, tc.code)
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("bearer rejection is cacheable")
			}
		}
		headers.Set("Access-Control-Request-Method", "POST")
		headers.Set("Access-Control-Request-Headers", "authorization, content-type, x-opencw-auth")
		preflight := authHTTPSend(router, authHTTPRequest{method: "OPTIONS", path: path, headers: headers})
		if preflight.Code != 204 || !strings.Contains(preflight.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
			t.Fatal("link preflight cannot carry authentication")
		}
		headers.Set("Origin", "https://untrusted.invalid")
		authHTTPError(t, authHTTPSend(router, authHTTPRequest{path: path, headers: headers}), 403, common.ErrorCodeGoogleRequestRejected)
	}
}

func TestGoogleLinkPreservesPasswordAccountAndProgress(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	if err := db.Model(&user).Update("email_verified", true).Error; err != nil {
		t.Fatal(err)
	}
	record := models.Progress{UserID: user.ID, Lesson: 12, CharWPM: 20, EffWPM: 17, Accuracy: 0.89}
	if err := db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	oldID := configs.App.GoogleClientID
	configs.App.GoogleClientID = "123-test.apps.googleusercontent.com"
	t.Cleanup(func() { configs.App.GoogleClientID = oldID })
	limiter, err := authlimits.NewLimiter(authHTTPPolicy(), nil)
	if err != nil {
		t.Fatal(err)
	}
	work := authHTTPWork(t, nil, nil)
	router := gin.New()
	CORSSetup(router)
	auth := router.Group("/v1/auth")
	auth.POST("/login", (&handlers.AuthHandler{DB: db, Passwords: work}).Login)
	subject := uuid.NewString()
	registerGoogleAuthRoutes(auth, db, work, limiter, nil, func(_ context.Context, credential, nonce string) (googleauth.Identity, error) {
		if credential == "existing-email-"+nonce {
			return googleauth.Identity{Subject: "other-" + subject, Email: user.Email, EmailVerified: true}, nil
		}
		if credential != "test-proof-"+nonce {
			return googleauth.Identity{}, googleauth.ErrInvalidCredential
		}
		return googleauth.Identity{Subject: subject, Email: subject + "@gmail.com", EmailVerified: true}, nil
	})
	router.GET("/v1/user/me", middlewares.AuthRequired(), middlewares.LoadUser(db), (&handlers.UserHandler{DB: db}).GetUserInfo)
	send := func(path, token, body string) *httptest.ResponseRecorder {
		return authHTTPSend(router, authHTTPRequest{path: path, token: token, body: body,
			headers: http.Header{"Origin": {googleTestOrigin}, "X-Opencw-Auth": {"google"}}})
	}
	passwordSession := authHTTPTokenPair(t, send("/v1/auth/login", "", authHTTPLogin(user, "old-password")))
	me := func(token string, linked bool) {
		t.Helper()
		response := authHTTPSend(router, authHTTPRequest{method: "GET", path: "/v1/user/me", token: token})
		var info common.UserInfoResponse
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &info) != nil || info.GoogleLinked != linked ||
			!info.PasswordEnabled || info.Username != user.Username || info.Email != user.Email || !info.EmailVerified {
			t.Fatalf("unexpected account status: %d %s", response.Code, response.Body)
		}
	}
	me(passwordSession.AccessToken, false)
	// Even when the address is identical, registration cannot silently link this identity.
	registration := fmt.Sprintf(`{"credential":"existing-email-%s","nonce":%q,"username":"newlearner"}`, googleTestNonce, googleTestNonce)
	authHTTPError(t, send("/v1/auth/google/register", "", registration), 409, common.ErrorCodeGoogleAccountConflict)
	intent := readLinkIntent(t, send(linkRoute+"/challenge", passwordSession.AccessToken, "{}"))
	link := func(proof, nonce, password string) *httptest.ResponseRecorder {
		return send(linkRoute, passwordSession.AccessToken, fmt.Sprintf(`{"challenge":%q,"credential":"test-proof-%s","current_password":%q}`, proof, nonce, password))
	}
	authHTTPError(t, link(passwordSession.AccessToken, intent.Nonce, "old-password"), 401, common.ErrorCodeGoogleCredentialInvalid)
	authHTTPError(t, link(intent.Challenge, "wrong-nonce", "old-password"), 401, common.ErrorCodeGoogleCredentialInvalid)
	authHTTPError(t, link(intent.Challenge, intent.Nonce, "wrong-password"), 401, common.ErrorCodeInvalidCredentials)
	me(passwordSession.AccessToken, false)
	for range 2 {
		if response := link(intent.Challenge, intent.Nonce, "old-password"); response.Code != 204 || response.Body.Len() != 0 {
			t.Fatalf("link failed: %d %s", response.Code, response.Body)
		}
	}
	var refreshCount int64
	if err := db.Model(&models.RefreshToken{}).Where("user_id = ?", user.ID).Count(&refreshCount).Error; err != nil || refreshCount != 1 {
		t.Fatal("linking changed the user's session count")
	}
	me(passwordSession.AccessToken, true)
	passwordAgain := authHTTPTokenPair(t, send("/v1/auth/login", "", authHTTPLogin(user, "old-password")))
	normalBody := fmt.Sprintf(`{"credential":"test-proof-%s","nonce":%q}`, googleTestNonce, googleTestNonce)
	googleSession := authHTTPTokenPair(t, send("/v1/auth/google", "", normalBody))
	for _, token := range []string{passwordAgain.AccessToken, googleSession.AccessToken} {
		me(token, true)
		claims := &jwt.RegisteredClaims{}
		if _, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) { return configs.App.JWTSecret, nil }); err != nil || claims.Subject != user.ID.String() {
			t.Fatalf("sign-in did not retain original UUID: %s, %v", claims.Subject, err)
		}
	}
	var retained models.Progress
	if err := db.Take(&retained, "id = ? AND user_id = ?", record.ID, user.ID).Error; err != nil || retained.Lesson != record.Lesson || retained.Accuracy != record.Accuracy {
		t.Fatal("training progress changed")
	}
}
