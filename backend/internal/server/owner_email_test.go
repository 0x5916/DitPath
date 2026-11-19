package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"morsewell/internal/configs"
	"morsewell/internal/models"
	"morsewell/internal/ownermail"
	"morsewell/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/resend/resend-go/v4"
	"gorm.io/gorm"
)

type mailHarness struct {
	t     *testing.T
	db    *gorm.DB
	api   *gin.Engine
	owner models.User
}

func enableFixtureMail(t *testing.T, owner uuid.UUID) {
	old := configs.App
	configs.App.AdminUserID = owner
	configs.App.ResendFromEmail = "Morsewell <sender@example.invalid>"
	configs.App.OwnerMail = configs.OwnerMail{Enabled: true, ReplyTo: "support@example.invalid", Footer: "Morsewell Test, Test Street", UnsubscribeURL: "https://api.example.invalid/v1/email/unsubscribe"}
	t.Cleanup(func() { configs.App = old })
}

func newMailHarness(t *testing.T) *mailHarness {
	db := authHTTPDB(t)
	owner := authHTTPUser(t, db, true)
	enableFixtureMail(t, owner.ID)
	t.Cleanup(func() {
		if err := db.Where("owner_id=?", owner.ID).Delete(&models.OwnerMessage{}).Error; err != nil {
			t.Error(err)
		}
	})
	return &mailHarness{t, db, authHTTPRouter(t, db, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now), owner}
}

func (h *mailHarness) user(verified bool) models.User {
	h.t.Helper()
	u := authHTTPUser(h.t, h.db, true)
	if verified {
		if err := h.db.Model(&u).Update("email_verified", true).Error; err != nil {
			h.t.Fatal(err)
		}
	}
	return u
}

func (h *mailHarness) call(actor models.User, method, path string, input any, status int, out any) {
	h.t.Helper()
	raw, err := json.Marshal(input)
	if err != nil {
		h.t.Fatal(err)
	}
	token := ""
	if actor.ID != uuid.Nil {
		token, err = utils.GenerateAccessToken(actor.ID, time.Now())
		if err != nil {
			h.t.Fatal(err)
		}
	}
	res := authHTTPSend(h.api, authHTTPRequest{method: method, path: "/v1/" + path, body: string(raw), token: token})
	if res.Code != status {
		h.t.Fatalf("%s %s: got %d, expected %d: %s", method, path, res.Code, status, res.Body.String())
	}
	if out != nil {
		if err := json.Unmarshal(res.Body.Bytes(), out); err != nil {
			h.t.Fatal(err)
		}
	}
}

func (h *mailHarness) opt(u models.User, topic string, enabled bool) {
	h.t.Helper()
	h.call(u, "PUT", "settings/email-preferences", gin.H{"email": u.Email, "topic": topic, "enabled": enabled}, 200, nil)
}

type mailPreview struct {
	Review, From, ReplyTo, Footer string
	Recipients                    []struct {
		ID     uuid.UUID
		Reason string
	}
}

func (h *mailHarness) preview(users ...models.User) mailPreview {
	h.t.Helper()
	ids := []uuid.UUID{}
	for _, u := range users {
		ids = append(ids, u.ID)
	}
	var preview mailPreview
	h.call(h.owner, "POST", "admin/emails/preview", gin.H{"recipients": ids, "topic": "support", "subject": "Follow-up", "body": "First line\nSecond line"}, 200, &preview)
	return preview
}

func (h *mailHarness) submit(review string, status int) uuid.UUID {
	h.t.Helper()
	var result struct{ ID uuid.UUID }
	h.call(h.owner, "POST", "admin/emails", gin.H{"review": review}, status, &result)
	return result.ID
}

func (h *mailHarness) status(id uuid.UUID) map[uuid.UUID]string {
	h.t.Helper()
	var detail struct {
		Recipients []struct {
			ID     uuid.UUID
			Status string
		}
	}
	h.call(h.owner, "GET", "admin/emails/"+id.String(), nil, 200, &detail)
	states := map[uuid.UUID]string{}
	for _, r := range detail.Recipients {
		states[r.ID] = r.Status
	}
	return states
}

func TestOwnerEmailConsentAndUnsubscribe(t *testing.T) {
	h := newMailHarness(t)
	user := h.user(true)
	unverified := h.user(false)
	var prefs struct{ Support, Product, Verified bool }
	h.call(user, "GET", "settings/email-preferences", nil, 200, &prefs)
	if prefs.Support || prefs.Product || !prefs.Verified {
		t.Fatal(prefs)
	}
	h.call(unverified, "PUT", "settings/email-preferences", gin.H{"email": unverified.Email, "topic": "support", "enabled": true}, 403, nil)
	h.call(user, "PUT", "settings/email-preferences", gin.H{"email": "stale@example.invalid", "topic": "support", "enabled": true}, 409, nil)
	h.opt(user, "support", true)
	h.opt(user, "product", true)
	var consent models.EmailConsent
	if err := h.db.Take(&consent, "user_id=? AND topic='support'", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	link := "/v1/email/unsubscribe?token=" + consent.Token.String()
	perform := func(method, body string) int {
		req := httptest.NewRequest(method, link, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res := httptest.NewRecorder()
		h.api.ServeHTTP(res, req)
		return res.Code
	}
	if perform("GET", "") != 200 || perform("POST", "") != 400 {
		t.Fatal("confirmation contract")
	}
	h.call(user, "GET", "settings/email-preferences", nil, 200, &prefs)
	if !prefs.Support || !prefs.Product {
		t.Fatal(prefs)
	}
	for range 2 {
		if perform("POST", "List-Unsubscribe=One-Click") != 200 {
			t.Fatal("unsubscribe should be idempotent")
		}
	}
	h.call(user, "GET", "settings/email-preferences", nil, 200, &prefs)
	if prefs.Support || !prefs.Product {
		t.Fatal(prefs)
	}
	h.opt(user, "support", true)
	perform("POST", "List-Unsubscribe=One-Click")
	h.call(user, "GET", "settings/email-preferences", nil, 200, &prefs)
	if !prefs.Support {
		t.Fatal("old link affected renewed consent")
	}
	for _, email := range []string{"changed-" + user.Email, user.Email} {
		h.call(user, "PUT", "user/email", gin.H{"email": email}, 200, nil)
	}
	if err := h.db.Model(&user).Update("email_verified", true).Error; err != nil {
		t.Fatal(err)
	}
	h.call(user, "GET", "settings/email-preferences", nil, 200, &prefs)
	if prefs.Support || prefs.Product {
		t.Fatal("old consent after address round trip")
	}
	for _, actor := range []models.User{{}, user} {
		status := 403
		if actor.ID == uuid.Nil {
			status = 401
		}
		for _, p := range []string{"admin/emails", "admin/emails/preview"} {
			h.call(actor, "POST", p, nil, status, nil)
		}
		h.call(actor, "GET", "admin/emails", nil, status, nil)
		h.call(actor, "GET", "admin/emails/"+uuid.NewString(), nil, status, nil)
	}
	configs.App.OwnerMail.Enabled = false
	h.call(h.owner, "POST", "admin/emails/preview", nil, 503, nil)
}

type sendFunc func(context.Context, *resend.SendEmailRequest, *resend.SendEmailOptions) (*resend.SendEmailResponse, error)

func (f sendFunc) SendWithOptions(ctx context.Context, r *resend.SendEmailRequest, o *resend.SendEmailOptions) (*resend.SendEmailResponse, error) {
	return f(ctx, r, o)
}

func TestOwnerEmailDispatchAndHistory(t *testing.T) {
	h := newMailHarness(t)
	accepted, rejected, revoked, changed := h.user(true), h.user(true), h.user(true), h.user(true)
	unverified := h.user(false)
	for _, u := range []models.User{accepted, rejected, revoked, changed} {
		h.opt(u, "support", true)
	}
	p := h.preview(accepted, rejected, revoked, unverified, changed)
	if p.Review == "" || len(p.Recipients) != 5 || p.Recipients[3].Reason != "unverified" {
		t.Fatal("invalid preview")
	}
	var messages int64
	if err := h.db.Model(&models.OwnerMessage{}).Where("owner_id=?", h.owner.ID).Count(&messages).Error; err != nil || messages != 0 {
		t.Fatal("preview wrote a message")
	}
	h.submit("tampered."+p.Review, 400)
	// Two in-flight confirmations must produce one parent and one row per learner.
	raw, _ := json.Marshal(gin.H{"review": p.Review})
	token, _ := utils.GenerateAccessToken(h.owner.ID, time.Now())
	req := authHTTPRequest{path: "/v1/admin/emails", body: string(raw), token: token}
	a, b := authHTTPAsync(h.api, req), authHTTPAsync(h.api, req)
	var id uuid.UUID
	for _, result := range []<-chan *httptest.ResponseRecorder{a, b} {
		res := <-result
		var ack struct{ ID uuid.UUID }
		if (res.Code != 200 && res.Code != 202) || json.Unmarshal(res.Body.Bytes(), &ack) != nil || ack.ID == uuid.Nil {
			t.Fatal(res.Code)
		}
		if id != uuid.Nil && ack.ID != id {
			t.Fatal("duplicate message")
		}
		id = ack.ID
	}
	if h.submit(p.Review, 200) != id {
		t.Fatal("retry changed message")
	}
	var revokedConsent models.EmailConsent
	if err := h.db.Take(&revokedConsent, "user_id=? AND topic='support'", revoked.ID).Error; err != nil {
		t.Fatal(err)
	}
	unsub := httptest.NewRequest("POST", "/v1/email/unsubscribe?token="+revokedConsent.Token.String(), strings.NewReader("List-Unsubscribe=One-Click"))
	unsub.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	confirmation := httptest.NewRecorder()
	h.api.ServeHTTP(confirmation, unsub)
	if confirmation.Code != 200 {
		t.Fatal(confirmation.Code)
	}
	changed.Email = "new-" + changed.Email
	h.call(changed, "PUT", "user/email", gin.H{"email": changed.Email}, 200, nil)
	if err := h.db.Model(&changed).Update("email_verified", true).Error; err != nil {
		t.Fatal(err)
	}
	h.opt(changed, "support", true)
	var mu sync.Mutex
	sent := map[string]*resend.SendEmailRequest{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var email resend.SendEmailRequest
		if err := json.NewDecoder(r.Body).Decode(&email); err != nil || len(email.To) != 1 || len(email.Cc)+len(email.Bcc) > 0 || r.Header.Get("Idempotency-Key") == "" {
			t.Error("invalid private provider envelope")
			w.WriteHeader(422)
			return
		}
		mu.Lock()
		sent[email.To[0]] = &email
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if email.To[0] == rejected.Email {
			w.WriteHeader(422)
			io.WriteString(w, `{"message":"refused"}`)
			return
		}
		io.WriteString(w, `{"id":"mock-provider-id"}`)
	}))
	defer provider.Close()
	client := resend.NewCustomClient(provider.Client(), "fixture")
	client.BaseURL, _ = url.Parse(provider.URL + "/")
	worker := ownermail.Worker{DB: h.db, Settings: configs.App, Sender: client.Emails}
	for range 4 {
		if worked, err := worker.ProcessOne(t.Context()); err != nil || !worked {
			t.Fatalf("worker: %v %v", worked, err)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(sent) != 2 || sent[accepted.Email] == nil {
		t.Fatal("wrong recipients")
	}
	e := sent[accepted.Email]
	link := strings.Trim(e.Headers["List-Unsubscribe"], "<>")
	if !strings.HasPrefix(link, configs.App.OwnerMail.UnsubscribeURL+"?token=") || !strings.Contains(e.Text, link) || !strings.Contains(e.Text, "Second line") || !strings.Contains(e.Text, "Morsewell — Learn the code. Communicate well.") || e.ReplyTo != configs.App.OwnerMail.ReplyTo || e.Headers["List-Unsubscribe-Post"] != "List-Unsubscribe=One-Click" {
		t.Fatal("bad message or unsubscribe headers")
	}
	want := map[uuid.UUID]string{accepted.ID: "accepted", rejected.ID: "failed", revoked.ID: "skipped", unverified.ID: "skipped", changed.ID: "skipped"}
	if got := h.status(id); !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
	var history struct{ Data []models.OwnerMessage }
	h.call(h.owner, "GET", "admin/emails", nil, 200, &history)
	if len(history.Data) != 1 || history.Data[0].ID != id {
		t.Fatal(history)
	}
}

func TestOwnerEmailAmbiguousRestart(t *testing.T) {
	h := newMailHarness(t)
	user := h.user(true)
	h.opt(user, "support", true)
	for _, expire := range []bool{false, true} {
		t.Run(fmt.Sprintf("expired_%t", expire), func(t *testing.T) {
			id := h.submit(h.preview(user).Review, 202)
			var key string
			var original *resend.SendEmailRequest
			calls := 0
			send := sendFunc(func(_ context.Context, r *resend.SendEmailRequest, o *resend.SendEmailOptions) (*resend.SendEmailResponse, error) {
				calls++
				if calls == 1 {
					key = o.IdempotencyKey
					original = r
					return nil, errors.New("lost acknowledgement")
				}
				if key != o.IdempotencyKey || !reflect.DeepEqual(original, r) {
					t.Error("recovery changed provider request")
				}
				return &resend.SendEmailResponse{Id: "same-provider-id"}, nil
			})
			run := func() {
				w := ownermail.Worker{DB: h.db, Settings: configs.App, Sender: send}
				worked, err := w.ProcessOne(t.Context())
				if !worked || err != nil {
					t.Fatal(worked, err)
				}
			}
			run()
			changes := map[string]any{"next_attempt": time.Now().Add(-time.Minute)}
			if expire {
				changes["first_attempt"] = time.Now().Add(-25 * time.Hour)
			}
			if err := h.db.Model(&models.OwnerRecipient{}).Where("message_id=?", id).Updates(changes).Error; err != nil {
				t.Fatal(err)
			}
			run()
			state := h.status(id)[user.ID]
			if expire && (state != "unknown" || calls != 1) || !expire && (state != "accepted" || calls != 2) {
				t.Fatal(state, calls)
			}
		})
	}
}
