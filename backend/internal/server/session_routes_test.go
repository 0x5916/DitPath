package server

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/utils"
)

func TestSessionRoutesAuthenticateBeforeValidatingRequests(t *testing.T) {
	engine := authHTTPRouter(t, nil, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now)
	for _, route := range []struct{ method, path, body string }{
		{http.MethodPost, "/v1/training/sessions/batch", "{"},
		{http.MethodGet, "/v1/training/sessions?limit=101", ""},
		{http.MethodGet, "/v1/training/changes?limit=101", ""},
	} {
		for _, token := range []string{"", "invalid"} {
			t.Run(route.method+route.path+"/"+token, func(t *testing.T) {
				code := common.ErrorCodeAuthHeaderRequired
				if token != "" {
					code = common.ErrorCodeInvalidToken
				}
				authHTTPError(t, authHTTPSend(engine, authHTTPRequest{method: route.method, path: route.path, body: route.body, token: token}), http.StatusUnauthorized, code)
			})
		}
	}
}

func TestSessionRoutesRemainV1Only(t *testing.T) {
	engine := authHTTPRouter(t, nil, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now)
	routerV2Setup(engine, nil)
	aliases := map[string]bool{
		"POST /v2/training/events/batch": false,
		"GET /v2/training/snapshot":      false,
		"PUT /v2/training/settings":      false,
	}
	for _, route := range engine.Routes() {
		if !strings.HasPrefix(route.Path, "/v2/training") {
			continue
		}
		key := route.Method + " " + route.Path
		if _, expected := aliases[key]; !expected {
			t.Fatalf("unexpected V2 training route: %s", key)
		}
		aliases[key] = true
	}
	for route, registered := range aliases {
		if !registered {
			t.Fatalf("existing compatibility alias was removed: %s", route)
		}
	}
	for _, route := range []struct{ method, path string }{
		{http.MethodPost, "/v2/training/sessions/batch"},
		{http.MethodGet, "/v2/training/sessions"},
		{http.MethodGet, "/v2/training/changes"},
	} {
		for _, token := range []string{"", "invalid"} {
			t.Run(route.method+route.path+"/"+token, func(t *testing.T) {
				response := authHTTPSend(engine, authHTTPRequest{method: route.method, path: route.path, body: "{", token: token})
				if response.Code != http.StatusNotFound || response.Header().Get("Location") != "" {
					t.Fatalf("V2 session route exposed or redirected: %d %s", response.Code, response.Body.String())
				}
			})
		}
	}
}

func TestSessionRoutesValidateAuthenticatedRequests(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	engine := authHTTPRouter(t, db, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now)
	token, err := utils.GenerateAccessToken(user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ method, path, body, code string }{
		{http.MethodPost, "/v1/training/sessions/batch", "{", common.ErrorCodeInvalidRequestBody},
		{http.MethodGet, "/v1/training/sessions?limit=101", "", common.ErrorCodeInvalidQueryParameter},
		{http.MethodGet, "/v1/training/changes?limit=101", "", common.ErrorCodeInvalidQueryParameter},
	} {
		t.Run(route.method+route.path, func(t *testing.T) {
			authHTTPError(t, authHTTPSend(engine, authHTTPRequest{method: route.method, path: route.path, body: route.body, token: token}), http.StatusBadRequest, route.code)
		})
	}
}
