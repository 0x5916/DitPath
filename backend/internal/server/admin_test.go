package server

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"opencw/internal/configs"
	"opencw/internal/models"
	"opencw/internal/utils"
	"testing"
	"time"
)

func TestAdminDirectoryAccess(t *testing.T) {
	db := authHTTPDB(t)
	owner, other := authHTTPUser(t, db, true), authHTTPUser(t, db, true)
	old := configs.App.AdminUserID
	t.Cleanup(func() { configs.App.AdminUserID = old })
	router := authHTTPRouter(t, db, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now)
	for _, test := range []struct {
		name           string
		ownerID, actor uuid.UUID
		status         int
	}{
		{"disabled", uuid.Nil, owner.ID, 403}, {"guest", owner.ID, uuid.Nil, 401}, {"ordinary", owner.ID, other.ID, 403}, {"owner", owner.ID, owner.ID, 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			configs.App.AdminUserID = test.ownerID
			token := ""
			if test.actor != uuid.Nil {
				var err error
				token, err = utils.GenerateAccessToken(test.actor, time.Now())
				if err != nil {
					t.Fatal(err)
				}
			}
			res := authHTTPSend(router, authHTTPRequest{path: "/v1/admin/users/search", token: token, body: `{"search":"` + other.Email + `"}`})
			if res.Code != test.status || res.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status %d, headers %v", res.Code, res.Header())
			}
			if res.Code == 200 {
				var result struct{ Data []struct{ ID uuid.UUID } }
				if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil || len(result.Data) != 1 || result.Data[0].ID != other.ID {
					t.Fatal(res.Body.String())
				}
			}
		})
	}
}

func TestAdminSearchAndPagination(t *testing.T) {
	db := authHTTPDB(t).Begin()
	t.Cleanup(func() { db.Rollback() })
	// All rows share one timestamp, so the ID tie-breaker is required.
	const group = "Dir_Case"
	at := time.Date(2004, 3, 2, 7, 0, 0, 0, time.UTC)
	var owner models.User
	for i := range 27 {
		user := models.User{Base: models.Base{CreatedAt: at}, Username: fmt.Sprintf("%s%02d", group, i), Email: fmt.Sprintf("fix%%%02d@fixture.invalid", i), Password: "fixture"}
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		owner = user
	}
	old := configs.App.AdminUserID
	configs.App.AdminUserID = owner.ID
	t.Cleanup(func() { configs.App.AdminUserID = old })
	api := authHTTPRouter(t, db, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now)
	token, err := utils.GenerateAccessToken(owner.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		Data []struct{ ID uuid.UUID }
		Next *string `json:"next_cursor"`
	}
	search := func(term, cursor string) result {
		body, _ := json.Marshal(map[string]string{"search": term, "cursor": cursor})
		response := authHTTPSend(api, authHTTPRequest{path: "/v1/admin/users/search", token: token, body: string(body)})
		var page result
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || response.Code != 200 {
			t.Fatal(response.Body.String())
		}
		return page
	}
	first := search("IR_cAS", "")
	if len(first.Data) != 25 || first.Next == nil {
		t.Fatal(first)
	}
	second := search("IR_cAS", *first.Next)
	if len(second.Data) != 2 || second.Next != nil {
		t.Fatal(second)
	}
	seen := map[uuid.UUID]bool{}
	for _, row := range append(first.Data, second.Data...) {
		if seen[row.ID] {
			t.Fatal("repeat directory row")
		}
		seen[row.ID] = true
	}
	if page := search("X%01", ""); len(page.Data) != 1 {
		t.Fatal(page)
	}
	if page := search("DI__CASE", ""); len(page.Data) != 0 {
		t.Fatal(page)
	}
}
