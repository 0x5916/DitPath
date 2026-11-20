package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"morsewell/internal/authlimits"
	"morsewell/internal/common"
	"morsewell/internal/configs"
	"morsewell/internal/googleauth"
	"morsewell/internal/models"
	"morsewell/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestDeleteAccountErasesDataAndRejectsStaleMailReview(t *testing.T) {
	h := newMailHarness(t)
	user, other := h.user(true), h.user(true)
	h.opt(user, "support", true)
	preview := h.preview(user)
	h.submit(h.preview(user).Review, 202)
	thread := models.ForumThread{UserID: user.ID, Category: "help", Title: "Example", Body: "Example post"}
	otp := models.EmailOTP{UserID: &user.ID, Code: "123456", Email: user.Email, ExpiredAt: time.Now()}
	for _, row := range []any{&thread, &otp, &models.Progress{UserID: user.ID}} {
		if err := h.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := h.db.Delete(&otp).Error; err != nil {
		t.Fatal(err)
	}
	reply := models.ForumReply{UserID: other.ID, ThreadID: thread.ID, Body: "A reply"}
	if err := h.db.Create(&reply).Error; err != nil {
		t.Fatal(err)
	}
	pair := authHTTPTokenPair(t, authHTTPSend(h.api, authHTTPRequest{path: "/v1/auth/login", body: authHTTPLogin(user, "old-password")}))
	remove := func(password string) int {
		return authHTTPSend(h.api, authHTTPRequest{path: "/v1/user/me", method: "DELETE", token: pair.AccessToken, body: fmt.Sprintf(`{"current_password":%q}`, password)}).Code
	}
	if status := remove("incorrect"); status != 401 {
		t.Fatal(status)
	}
	if err := h.db.Callback().Delete().Before("gorm:delete").Register("test:interrupt-account-delete", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			tx.AddError(errors.New("rollback deletion"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	failed := remove("old-password")
	h.db.Callback().Delete().Remove("test:interrupt-account-delete")
	var count int64
	if failed != 500 || h.db.Unscoped().Model(&otp).Where("user_id=?", user.ID).Count(&count).Error != nil || count != 1 {
		t.Fatal("failed erasure did not roll back")
	}
	if status := remove("old-password"); status != 204 {
		t.Fatal(status)
	}
	h.submit(preview.Review, 409)
	for _, table := range []any{&models.EmailOTP{}, &models.OwnerRecipient{}, &models.EmailConsent{}, &models.Progress{}, &models.ForumThread{}, &models.RefreshToken{}} {
		if err := h.db.Unscoped().Model(table).Where("user_id=?", user.ID).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("residual %T: %d %v", table, count, err)
		}
	}
	if err := h.db.Unscoped().Take(&reply, "id=?", reply.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("reply cascade: %v", err)
	}
	h.call(other, "GET", "user/me", nil, 200, nil)
	h.call(user, "GET", "user/me", nil, 401, nil)
	h.call(models.User{}, "POST", "auth/refresh", gin.H{"refresh_token": pair.RefreshToken}, 401, nil)
}

func TestGoogleDeletionRequiresNewProofForLinkedIdentity(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	if err := db.Model(&user).Update("password", "").Error; err != nil {
		t.Fatal(err)
	}
	identity := models.UserIdentity{UserID: user.ID, Issuer: googleauth.Issuer, Subject: uuid.NewString(), Provider: "google"}
	if err := db.Create(&identity).Error; err != nil {
		t.Fatal(err)
	}
	previous := configs.App.GoogleClientID
	configs.App.GoogleClientID = "123-test.apps.googleusercontent.com"
	t.Cleanup(func() { configs.App.GoogleClientID = previous })
	limiter, err := authlimits.NewLimiter(authHTTPPolicy(), nil)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	CORSSetup(router)
	registerAccountDeletionRoutes(router.Group("/v1"), db, authHTTPWork(t, nil, nil), limiter, nil, func(_ context.Context, credential, nonce string) (googleauth.Identity, error) {
		if credential == "empty-subject" {
			return googleauth.Identity{}, nil
		}
		if credential == nonce {
			return googleauth.Identity{Subject: identity.Subject}, nil
		}
		return googleauth.Identity{Subject: "different-identity", Email: user.Email}, nil
	})
	token, err := utils.GenerateAccessToken(user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{"Origin": {googleTestOrigin}, "X-Opencw-Auth": {"google"}}
	intent := readLinkIntent(t, authHTTPSend(router, authHTTPRequest{path: "/v1/user/deletion-challenge", body: "{}", token: token, headers: headers}))
	remove := authHTTPRequest{method: "DELETE", path: "/v1/user/me", token: token, headers: headers}
	link, err := googleauth.NewLinkChallenge(configs.App.JWTSecret, user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range [][2]string{{link, googleauth.LinkNonce(link)}, {intent.Challenge, "another-account"}, {intent.Challenge, "empty-subject"}} {
		remove.body = fmt.Sprintf(`{"challenge":%q,"credential":%q}`, invalid[0], invalid[1])
		authHTTPError(t, authHTTPSend(router, remove), 401, common.ErrorCodeGoogleCredentialInvalid)
	}
	remove.body = fmt.Sprintf(`{"challenge":%q,"credential":%q}`, intent.Challenge, intent.Nonce)
	headers.Set("Origin", "https://wrong.invalid")
	authHTTPError(t, authHTTPSend(router, remove), 403, common.ErrorCodeGoogleRequestRejected)
	headers.Set("Origin", googleTestOrigin)
	if err := db.Model(&user).Update("password", "fake:current-password").Error; err != nil {
		t.Fatal(err)
	}
	authHTTPError(t, authHTTPSend(router, authHTTPRequest{path: "/v1/user/deletion-challenge", body: "{}", token: token, headers: headers}), 401, common.ErrorCodeInvalidCredentials)
	authHTTPError(t, authHTTPSend(router, remove), 401, common.ErrorCodeInvalidCredentials)
	if err := db.Model(&user).Update("password", "").Error; err != nil {
		t.Fatal(err)
	}
	if res := authHTTPSend(router, remove); res.Code != 204 {
		t.Fatalf("verified deletion: %d %s", res.Code, res.Body)
	}
	authHTTPError(t, authHTTPSend(router, remove), 401, common.ErrorCodeUserNotFound)
	if err := db.Unscoped().Take(&identity, "id=?", identity.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("identity survived: %v", err)
	}
}
