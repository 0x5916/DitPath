package server

import (
	"encoding/json"
	"github.com/google/uuid"
	"opencw/internal/configs"
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
