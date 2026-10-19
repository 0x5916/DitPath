package common

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func sessionFields(mode string) map[string]any {
	fields := map[string]any{
		"session_id": "session-1", "mode": mode, "curriculum_version": "koch-39-v1", "lesson": 1,
		"status": "completed", "started_at": "2026-10-20T00:00:00Z", "ended_at": "2026-10-20T00:02:00Z",
		"char_wpm": 20, "eff_wpm": 15, "freq_hz": 600, "prompt_count": 3, "attempt_count": 2,
		"event_ids": []string{"event-2", "event-1"},
	}
	if mode == "practice" {
		fields["prompt_count"], fields["attempt_count"], fields["event_ids"] = 1, 1, []string{}
		fields["accuracy"], fields["scoring_version"] = 0.75, "practice-copy-v1"
	}
	return fields
}

func encodeSession(t *testing.T, fields map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestValidateTrainingSession(t *testing.T) {
	tests := []struct {
		name string
		mode string
		edit func(map[string]any)
		ok   bool
	}{
		{"guided manifest", "guided", nil, true},
		{"practice", "practice", nil, true},
		{"introduction without attempts", "guided", func(v map[string]any) { v["attempt_count"], v["event_ids"] = 0, nil }, true},
		{"abandoned unknown end", "guided", func(v map[string]any) { v["status"], v["ended_at"] = "abandoned", nil }, true},
		{"UTF-8 ID boundary", "guided", func(v map[string]any) { v["session_id"] = strings.Repeat("é", 64) }, true},
		{"ownership even null", "guided", func(v map[string]any) { v["user_id"] = nil }, false},
		{"ownership case insensitive", "guided", func(v map[string]any) { v["USER_ID"] = "other-account" }, false},
		{"blank ID", "guided", func(v map[string]any) { v["session_id"] = " \t" }, false},
		{"reserved ID", "guided", func(v map[string]any) { v["session_id"] = "legacy:old" }, false},
		{"UTF-8 ID too long", "guided", func(v map[string]any) { v["session_id"] = strings.Repeat("é", 65) }, false},
		{"NUL ID", "guided", func(v map[string]any) { v["session_id"] = "a\x00b" }, false},
		{"mode", "guided", func(v map[string]any) { v["mode"] = "legacy" }, false},
		{"curriculum", "guided", func(v map[string]any) { v["curriculum_version"] = "future" }, false},
		{"lesson missing", "guided", func(v map[string]any) { delete(v, "lesson") }, false},
		{"lesson bound", "guided", func(v map[string]any) { v["lesson"] = 40 }, false},
		{"status", "guided", func(v map[string]any) { v["status"] = "running" }, false},
		{"speed null", "guided", func(v map[string]any) { v["char_wpm"] = nil }, false},
		{"speed bound", "guided", func(v map[string]any) { v["char_wpm"] = 51 }, false},
		{"effective speed", "guided", func(v map[string]any) { v["eff_wpm"] = 21 }, false},
		{"frequency bound", "guided", func(v map[string]any) { v["freq_hz"] = 299 }, false},
		{"prompt bound", "guided", func(v map[string]any) { v["prompt_count"] = 1001 }, false},
		{"attempt missing", "guided", func(v map[string]any) { delete(v, "attempt_count") }, false},
		{"attempt bound", "guided", func(v map[string]any) { v["attempt_count"] = 4 }, false},
		{"start missing", "guided", func(v map[string]any) { delete(v, "started_at") }, false},
		{"start invalid", "guided", func(v map[string]any) { v["started_at"] = "yesterday" }, false},
		{"zero year", "guided", func(v map[string]any) { v["started_at"] = "0000-01-01T00:00:00Z" }, false},
		{"zero year with valid UTC year", "guided", func(v map[string]any) { v["started_at"] = "0000-12-31T23:59:59-01:00" }, false},
		{"UTC year underflow", "guided", func(v map[string]any) { v["started_at"] = "0001-01-01T00:00:00+01:00" }, false},
		{"UTC start year overflow", "guided", func(v map[string]any) {
			v["started_at"], v["ended_at"] = "9999-12-31T23:59:59-01:00", "9999-12-31T23:59:59-01:00"
		}, false},
		{"UTC end year overflow", "guided", func(v map[string]any) { v["ended_at"] = "9999-12-31T23:59:59-01:00" }, false},
		{"last representable year", "guided", func(v map[string]any) {
			v["started_at"], v["ended_at"] = "9999-12-31T23:59:58Z", "9999-12-31T23:59:59Z"
		}, true},
		{"completion without end", "guided", func(v map[string]any) { v["ended_at"] = nil }, false},
		{"end before start", "guided", func(v map[string]any) { v["ended_at"] = "2026-10-19T23:59:59Z" }, false},
		{"submicrosecond reversed time", "guided", func(v map[string]any) {
			v["started_at"], v["ended_at"] = "2026-10-20T00:00:00.0000009Z", "2026-10-20T00:00:00.0000005Z"
		}, false},
		{"manifest count", "guided", func(v map[string]any) { v["event_ids"] = []string{"event-1"} }, false},
		{"manifest duplicate", "guided", func(v map[string]any) { v["event_ids"] = []string{"event-1", "event-1"} }, false},
		{"manifest reserved ID", "guided", func(v map[string]any) { v["event_ids"] = []string{"event-1", "legacy:old"} }, false},
		{"guided score", "guided", func(v map[string]any) { v["accuracy"] = 1 }, false},
		{"guided score case insensitive", "guided", func(v map[string]any) { v["ACCURACY"] = 1 }, false},
		{"guided null score", "guided", func(v map[string]any) { v["accuracy"] = nil }, false},
		{"guided derived count", "guided", func(v map[string]any) { v["correct_attempt_count"] = 2 }, false},
		{"guided scoring version", "guided", func(v map[string]any) { v["scoring_version"] = "practice-copy-v1" }, false},
		{"practice abandoned", "practice", func(v map[string]any) { v["status"] = "abandoned" }, false},
		{"practice counts", "practice", func(v map[string]any) { v["prompt_count"] = 2 }, false},
		{"practice manifest", "practice", func(v map[string]any) { v["event_ids"] = []string{"event-1"} }, false},
		{"practice accuracy missing", "practice", func(v map[string]any) { delete(v, "accuracy") }, false},
		{"practice accuracy bound", "practice", func(v map[string]any) { v["accuracy"] = 1.01 }, false},
		{"practice scoring version", "practice", func(v map[string]any) { v["scoring_version"] = "future" }, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fields := sessionFields(test.mode)
			if test.edit != nil {
				test.edit(fields)
			}
			session, err := ValidateTrainingSession(encodeSession(t, fields))
			if (err == nil) != test.ok {
				t.Fatalf("success=%v, want %v: %v", err == nil, test.ok, err)
			}
			if test.ok && session.Mode == "guided" && len(session.EventIDs) == 2 && session.EventIDs[0] != "event-1" {
				t.Fatal("manifest was not sorted")
			}
		})
	}
}

func TestTrainingSessionMalformedRecords(t *testing.T) {
	for _, raw := range []string{"null", "[]", "true", "{} trailing", `{"session_id":1}`, `{"session_id":"` + string([]byte{0xff}) + `"}`} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ValidateTrainingSession(json.RawMessage(raw)); err == nil {
				t.Fatal("malformed session accepted")
			}
		})
	}
	raw := encodeSession(t, sessionFields("practice"))
	raw = bytes.Replace(raw, []byte(`"accuracy":0.75`), []byte(`"accuracy":1e309`), 1)
	if _, err := ValidateTrainingSession(raw); err == nil {
		t.Fatal("non-finite score accepted")
	}
}

func TestCanonicalTrainingSessionSemanticRetries(t *testing.T) {
	fields := sessionFields("guided")
	first, err := ValidateTrainingSession(encodeSession(t, fields))
	if err != nil {
		t.Fatal(err)
	}
	fields["started_at"], fields["ended_at"] = "2026-10-20T08:00:00.0000009+08:00", "2026-10-20T08:02:00+08:00"
	fields["event_ids"] = []string{"event-1", "event-2"}
	second, err := ValidateTrainingSession(encodeSession(t, fields))
	if err != nil {
		t.Fatal(err)
	}
	one, err := CanonicalTrainingSession(first)
	if err != nil {
		t.Fatal(err)
	}
	two, err := CanonicalTrainingSession(second)
	if err != nil || !bytes.Equal(one, two) {
		t.Fatalf("equivalent retry differs: %s / %s (%v)", one, two, err)
	}
	second.Status = "abandoned"
	two, _ = CanonicalTrainingSession(second)
	if bytes.Equal(one, two) {
		t.Fatal("changed terminal content has identical canonical input")
	}
	fields["status"], fields["attempt_count"], fields["event_ids"] = "abandoned", 0, nil
	delete(fields, "ended_at")
	first, _ = ValidateTrainingSession(encodeSession(t, fields))
	fields["ended_at"] = nil
	fields["event_ids"] = []string{}
	second, _ = ValidateTrainingSession(encodeSession(t, fields))
	one, _ = CanonicalTrainingSession(first)
	two, _ = CanonicalTrainingSession(second)
	if !bytes.Equal(one, two) {
		t.Fatal("absent/null optional fields differ")
	}
}

func TestTrainingSessionPreservesIdentityAndNormalizesZero(t *testing.T) {
	fields := sessionFields("practice")
	fields["session_id"], fields["accuracy"] = " session-1 ", json.Number("-0")
	raw := encodeSession(t, fields)
	session, err := ValidateTrainingSession(raw)
	if err != nil || session.SessionID != " session-1 " || SessionIDFromRaw(raw) != session.SessionID {
		t.Fatalf("identity changed: %q (%v)", session.SessionID, err)
	}
	one, _ := CanonicalTrainingSession(session)
	fields["accuracy"] = 0
	session, _ = ValidateTrainingSession(encodeSession(t, fields))
	two, _ := CanonicalTrainingSession(session)
	if !bytes.Equal(one, two) {
		t.Fatal("signed zero differs")
	}
}
