package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
)

func TestTrainingRoutesRequireAuthentication(t *testing.T) {
	engine := authHTTPRouter(t, nil, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now)
	routerV2Setup(engine, nil)
	for _, version := range []string{"/v1", "/v2"} {
		for _, route := range []struct{ method, path string }{
			{http.MethodPost, "/training/events/batch"},
			{http.MethodGet, "/training/snapshot"},
			{http.MethodPut, "/training/settings"},
		} {
			for _, token := range []string{"", "invalid"} {
				t.Run(version+route.path+"/"+token, func(t *testing.T) {
					code := common.ErrorCodeAuthHeaderRequired
					if token != "" {
						code = common.ErrorCodeInvalidToken
					}
					authHTTPError(t, authHTTPSend(engine, authHTTPRequest{method: route.method, path: version + route.path, body: "{", token: token}), 401, code)
				})
			}
		}
	}
}

func TestTrainingRouteValidationParity(t *testing.T) {
	engine := gin.New()
	for _, version := range []string{"/v1", "/v2"} {
		group := engine.Group(version, func(c *gin.Context) { c.Set("user", &models.User{}) })
		registerTrainingRoutes(group, nil)
	}
	for _, test := range []struct {
		name, method, path, body, code string
		status                         int
	}{
		{"malformed-events", "POST", "/events/batch", "{", common.ErrorCodeInvalidRequestBody, 400},
		{"unsupported-schema", "POST", "/events/batch", `{"schema_version":3,"events":[{}]}`, common.ErrorCodeTrainingSchemaVersion, 400},
		{"empty-events", "POST", "/events/batch", `{"schema_version":1,"events":[]}`, common.ErrorCodeInvalidRequestBody, 400},
		{"oversize-body", "POST", "/events/batch", strings.Repeat(" ", common.TrainingV2MaxPayloadBytes+1), common.ErrorCodeTrainingPayloadTooLarge, 413},
		{"too-many-events", "POST", "/events/batch", `{"schema_version":1,"events":[` + strings.Repeat("{},", 100) + `{}]}`, common.ErrorCodeTrainingBatchTooLarge, 400},
		{"malformed-settings", "PUT", "/settings", "{", common.ErrorCodeInvalidRequestBody, 400},
		{"missing-settings", "PUT", "/settings", `{}`, common.ErrorCodeInvalidRequestBody, 400},
		{"invalid-daily-goal", "PUT", "/settings", `{"char_wpm":20,"eff_wpm":12,"freq":600,"start_delay":0,"target_daily_minutes":241}`, common.ErrorCodeInvalidRequestBody, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			var previous string
			for _, version := range []string{"/v1", "/v2"} {
				response := authHTTPSend(engine, authHTTPRequest{method: test.method, path: version + "/training" + test.path, body: test.body})
				authHTTPError(t, response, test.status, test.code)
				if previous != "" && previous != response.Body.String() {
					t.Fatalf("validation response differs across aliases: %s / %s", previous, response.Body.String())
				}
				previous = response.Body.String()
			}
		})
	}
}

// Requires the existing migrated disposable database; no schema is changed here.
func TestTrainingRoutesShareStoredData(t *testing.T) {
	db := authHTTPDB(t)
	user := authHTTPUser(t, db, true)
	engine := authHTTPRouter(t, db, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now)
	routerV2Setup(engine, db)
	token, err := utils.GenerateAccessToken(user.ID, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	send := func(method, path, body string) []byte {
		t.Helper()
		response := authHTTPSend(engine, authHTTPRequest{method: method, path: path, body: body, token: token})
		if response.Code != http.StatusOK {
			t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body.String())
		}
		return response.Body.Bytes()
	}
	settingsBody := `{"char_wpm":20,"eff_wpm":12,"freq":600,"start_delay":0,"target_daily_minutes":15}`
	for _, version := range []string{"/v2", "/v1"} {
		var result common.TrainingSettingsUpdateResponse
		if err := json.Unmarshal(send("PUT", version+"/training/settings", settingsBody), &result); err != nil || result.UpdatedAt.IsZero() {
			t.Fatalf("settings response: %+v, %v", result, err)
		}
	}
	send("POST", "/v1/settings/cw", `{"char_wpm":22,"eff_wpm":12,"freq":650,"start_delay":0.5}`)
	var settings models.CWSettings
	if err := db.Take(&settings, "user_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if settings.CharWPM != 22 || settings.TargetDailyMinutes == nil || *settings.TargetDailyMinutes != 15 {
		t.Fatalf("legacy settings lost shared values or daily goal: %+v", settings)
	}
	batch := `{"schema_version":1,"events":[{"id":"route-event","session_id":"route-session","prompt_id":"route-prompt","prompt_kind":"recall","target_character":"K","entered_text":"K","is_correct":true,"classification":"automatic","latency_ms":1000,"replay_count":0,"input_mode":"keyboard","char_wpm":20,"eff_wpm":12,"freq_hz":600,"created_at":"2026-10-20T00:00:00Z"}]}`
	for _, version := range []string{"/v2", "/v1"} {
		var result common.TrainingEventBatchResponse
		if err := json.Unmarshal(send("POST", version+"/training/events/batch", batch), &result); err != nil || len(result.AcknowledgedIDs) != 1 || result.AcknowledgedIDs[0] != "route-event" || len(result.RejectedEvents) != 0 {
			t.Fatalf("event acknowledgement: %+v, %v", result, err)
		}
		// Schema 1 must keep its original first-write-wins duplicate behavior.
		batch = strings.Replace(batch, `"latency_ms":1000`, `"latency_ms":2000`, 1)
	}
	var events []models.TrainingEvent
	if err := db.Where("user_id = ?", user.ID).Find(&events).Error; err != nil || len(events) != 1 || events[0].LatencyMS != 1000 {
		t.Fatalf("cross-alias duplicate changed persisted evidence: %+v, %v", events, err)
	}
	var previous string
	for _, version := range []string{"/v1", "/v2"} {
		body := send("GET", version+"/training/snapshot", "")
		var snapshot common.TrainingSnapshotResponse
		if err := json.Unmarshal(body, &snapshot); err != nil || len(snapshot.CharacterMasteries) != 1 || snapshot.CharacterMasteries[0].TotalAttempts != 1 || snapshot.LastActiveAt == nil {
			t.Fatalf("snapshot lost shared evidence: %+v, %v", snapshot, err)
		}
		if previous != "" && previous != string(body) {
			t.Fatalf("snapshot differs across aliases: %s / %s", previous, body)
		}
		previous = string(body)
	}
}

func TestLearningEvidenceRoutesRequireAuthentication(t *testing.T) {
	engine := authHTTPRouter(t, nil, authHTTPWork(t, nil, nil), authHTTPPolicy(), time.Now)
	for _, route := range []struct{ method, path string }{{"POST", "/training/learning-evidence/batch"}, {"GET", "/training/learning-evidence/changes"}} {
		for _, token := range []string{"", "invalid"} {
			code := common.ErrorCodeAuthHeaderRequired
			if token != "" {
				code = common.ErrorCodeInvalidToken
			}
			authHTTPError(t, authHTTPSend(engine, authHTTPRequest{method: route.method, path: "/v1" + route.path, body: "{", token: token}), 401, code)
		}
	}
}
