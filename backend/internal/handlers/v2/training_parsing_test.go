package handlers

import (
	"encoding/json"
	"testing"
)

func TestTrainingEventParsingRejectionSnapshots(t *testing.T) {
	for _, test := range []struct {
		name, raw, id, missingMessage string
	}{
		{"id before wrong field", `{"id":"  before  ","latency_ms":"wrong"}`, "  before  ", ""},
		{"id after wrong field", `{"latency_ms":"wrong","id":"  after  "}`, "  after  ", ""},
		{"last duplicate id wins", `{"id":"first","id":" second ","latency_ms":"wrong"}`, " second ", ""},
		{"wrong last id retains first", `{"id":" first ","id":123}`, " first ", ""},
		{"valid last id retains earlier type error", `{"id":123,"id":" last "}`, " last ", ""},
		{"null last id retains first", `{"id":" kept ","id":null,"latency_ms":"wrong"}`, " kept ", ""},
		{"case aliases overwrite exact id", `{"ID":"alias","id":"exact","Id":" final ","is_correct":"wrong"}`, " final ", ""},
		{"null alias retains exact id", `{"id":" kept ","ID":null,"session_id":123}`, " kept ", ""},
		{"alias after null id", `{"id":null,"ID":" alias ","latency_ms":"wrong"}`, " alias ", ""},
		{"null id with wrong field", `{"id":null,"latency_ms":"wrong"}`, "", ""},
		{"typed object trims rejected id", `{"id":" trimmed "}`, "trimmed", "session_id is required"},
		{"null event", `null`, "", "id is required"},
		{"empty object", `{}`, "", "id is required"},
		{"string event", `"event"`, "", ""},
		{"number event", `123`, "", ""},
		{"boolean event", `false`, "", ""},
		{"empty array", `[]`, "", ""},
		{"object array", `[{"id":"array"}]`, "", ""},
		{"syntax error after id loses id", `{"id":" lost ",`, "", ""},
		{"syntax error before id", `{"latency_ms":,"id":" lost "}`, "", ""},
		{"trailing value loses id", `{"id":" lost ","latency_ms":"wrong"} true`, "", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			events := []json.RawMessage{json.RawMessage(test.raw)}
			valid, rejected := validateTrainingEvents(events)
			code, message := "INVALID_FIELD", "event must be a JSON object"
			if test.missingMessage != "" {
				code, message = "MISSING_FIELD", test.missingMessage
			}
			want := `[{"id":` + string(mustJSON(t, test.id)) + `,"error_code":"` + code + `","message":"` + message + `"}]`
			if len(valid) != 0 || string(mustJSON(t, rejected)) != want {
				t.Fatalf("valid=%+v rejected=%s; want no valid events and %s", valid, mustJSON(t, rejected), want)
			}
			// Invalid JSON cannot be embedded as a member of an HTTP JSON batch.
			if json.Valid(events[0]) {
				assertTrainingBatchResponse(t, events, `{"acknowledged_ids":[],"rejected_events":`+want+`}`)
			}
		})
	}
}

func TestTrainingEventParsingMixedRejectedBatchSnapshot(t *testing.T) {
	invalidTiming := validEventMap()
	invalidTiming["id"], invalidTiming["latency_ms"] = " trimmed ", -1
	wrongType := validEventMap()
	wrongType["id"], wrongType["char_wpm"] = " raw id ", "wrong"
	events := []json.RawMessage{
		mustJSON(t, wrongType),
		mustJSON(t, invalidTiming),
		json.RawMessage(`null`),
		json.RawMessage(`{"id":"first","ID":" alias ","ID":null,"is_correct":"wrong"}`),
		json.RawMessage(`[]`),
		json.RawMessage(`{"latency_ms":"wrong","id":" after "}`),
	}
	want := `{"acknowledged_ids":[],"rejected_events":[{"id":" raw id ","error_code":"INVALID_FIELD","message":"event must be a JSON object"},{"id":"trimmed","error_code":"INVALID_TIMING","message":"latency_ms cannot be negative"},{"id":"","error_code":"MISSING_FIELD","message":"id is required"},{"id":" alias ","error_code":"INVALID_FIELD","message":"event must be a JSON object"},{"id":"","error_code":"INVALID_FIELD","message":"event must be a JSON object"},{"id":" after ","error_code":"INVALID_FIELD","message":"event must be a JSON object"}]}`
	assertTrainingBatchResponse(t, events, want)
}
