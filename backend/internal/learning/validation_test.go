package learning

import (
	"encoding/json"
	"fmt"
	"testing"
)

func planFixture() map[string]any {
	prompts := []any{}
	for i := range 12 {
		ch := "K"
		if i%2 == 1 {
			ch = "M"
		}
		prompts = append(prompts, map[string]any{"id": fmt.Sprint("p", i), "character": ch, "role": "target"})
	}
	return map[string]any{"id": "plan-1", "kind": "plan", "policy_version": PolicyVersion, "recorded_at": "2026-10-27T00:00:00Z", "session_id": "session-1", "purpose": "coaching", "curriculum_version": "koch-39-v1", "profile": map[string]any{"id": "clean20", "task": "single-character", "char_wpm": 20, "audio_condition": "clean", "response_support": "open"}, "char_wpm": 20, "eff_wpm": 12, "freq_hz": 600, "started_at": "2026-10-27T00:00:00Z", "introduced_characters": []string{"K", "M"}, "targets": []string{"K", "M"}, "prompts": prompts, "fresh_order": true, "feedback": "immediate"}
}
func encoded(value any) []byte { raw, _ := json.Marshal(value); return raw }
func TestValidateLearningPlan(t *testing.T) {
	for _, test := range []struct {
		name, code string
		mutate     func(map[string]any)
	}{
		{"unknown owner", "INVALID_RECORD", func(m map[string]any) { m["user_id"] = "someone" }},
		{"unsupported policy", "UNSUPPORTED_POLICY_VERSION", func(m map[string]any) { m["policy_version"] = "other" }},
		{"invalid mixed", "INVALID_RECORD", func(m map[string]any) { m["purpose"] = "mixed-check" }},
		{"invalid speed", "INVALID_RECORD", func(m map[string]any) { m["eff_wpm"] = 21 }},
		{"invalid profile", "INVALID_RECORD", func(m map[string]any) { m["profile"].(map[string]any)["char_wpm"] = 25 }},
		{"untaught target", "INVALID_RECORD", func(m map[string]any) { m["targets"] = []string{"K", "Z"} }},
		{"duplicate prompt", "INVALID_RECORD", func(m map[string]any) { p := m["prompts"].([]any); p[1] = p[0] }},
		{"false purpose", "INVALID_RECORD", func(m map[string]any) { m["purpose"] = "practice" }},
		{"legacy id", "INVALID_RECORD", func(m map[string]any) { m["id"] = "legacy:1" }},
		{"invalid date", "INVALID_RECORD", func(m map[string]any) { m["recorded_at"] = "yesterday" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			m := planFixture()
			test.mutate(m)
			_, r := Validate(encoded(m))
			if r == nil || r.ErrorCode != test.code {
				t.Fatalf("got %+v", r)
			}
		})
	}
	first, r := Validate(encoded(planFixture()))
	if r != nil {
		t.Fatal(r)
	}
	second := planFixture()
	second["recorded_at"] = "2026-10-27T08:00:00+08:00"
	second["started_at"] = "2026-10-27T08:00:00+08:00"
	second["targets"] = []string{"M", "K"}
	canonical, r := Validate(encoded(second))
	if r != nil || string(first.Canonical) != string(canonical.Canonical) {
		t.Fatalf("normalization mismatch: %s %s %+v", first.Canonical, canonical.Canonical, r)
	}
}
func TestValidateLearningObservationUnknownsAndBounds(t *testing.T) {
	input := map[string]any{"id": "a", "kind": "observation", "policy_version": PolicyVersion, "recorded_at": "2026-10-27T00:00:00Z", "session_id": "s", "prompt_id": "p", "presentation_id": "x", "first_response": nil, "final_response": nil, "skipped": false, "replay_count_before_response": nil, "help_before_response": nil, "audio_valid": nil, "interruption_invalidated": nil, "response_interface": "keyboard", "first_presented_at": nil, "prior_exposure": nil, "char_wpm": 20, "eff_wpm": 12, "freq_hz": 600}
	r, rejection := Validate(encoded(input))
	if rejection != nil {
		t.Fatal(rejection)
	}
	if r.Data["audio_valid"] != nil || r.Data["replay_count_before_response"] != nil {
		t.Fatal("unknown evidence fabricated")
	}
	input["first_response"] = " k "
	r, rejection = Validate(encoded(input))
	if rejection != nil || r.Data["first_response"] != "K" {
		t.Fatal("response not normalized", rejection)
	}
	input["prior_exposure"] = map[string]any{"earliest": "2026-10-27T00:02:00Z", "latest": "2026-10-27T00:01:00Z", "source": "wall-clock-bounded"}
	_, rejection = Validate(encoded(input))
	if rejection == nil || rejection.ErrorCode != "INVALID_TIME_BOUNDS" {
		t.Fatal("reversed bounds accepted")
	}
	input["prior_exposure"] = nil
	delete(input, "audio_valid")
	_, rejection = Validate(encoded(input))
	if rejection == nil {
		t.Fatal("missing validity accepted as unknown")
	}
}
func TestLearningJSONAndServerOnlyClaims(t *testing.T) {
	for _, raw := range []string{`{"id":"a","id":"b"}`, `{"nested":{"x":1,"x":2}}`, `{} {}`, `[]`, `null`} {
		if _, err := DecodeObject([]byte(raw)); err == nil {
			t.Fatalf("invalid object accepted %s", raw)
		}
	}
	input := map[string]any{"id": "claim", "kind": "milestone", "policy_version": PolicyVersion, "recorded_at": "2026-10-27T00:00:00Z"}
	_, r := Validate(encoded(input))
	if r == nil {
		t.Fatal("client award accepted")
	}
}
func TestLearningExposureAndTerminalCanonicalization(t *testing.T) {
	for _, input := range []map[string]any{
		{"id": "open", "kind": "exposure-open", "session_id": nil, "presentation_id": "sound", "characters": []string{"M", "K"}, "source": "reference", "started_at": nil},
		{"id": "close", "kind": "exposure-close", "open_id": "open", "end_reason": "recovery", "last_exposure": map[string]any{"M": nil, "K": nil}},
		{"id": "end", "kind": "terminal", "session_id": "session", "status": "abandoned", "ended_at": nil, "observation_ids": []string{}},
	} {
		input["policy_version"] = PolicyVersion
		input["recorded_at"] = "2026-10-27T00:00:00Z"
		if _, r := Validate(encoded(input)); r != nil {
			t.Fatal(r)
		}
	}
}

func TestLearningPlanRoleAndCoverage(t *testing.T) {
	m := planFixture()
	m["introduced_characters"] = []string{"K", "M", "R", "S"}
	if _, r := Validate(encoded(m)); r == nil {
		t.Fatal("coaching ignored available anchors")
	}
	prompts := m["prompts"].([]any)
	for i := 6; i < 12; i++ {
		p := prompts[i].(map[string]any)
		p["character"] = "R"
		p["role"] = "anchor"
	}
	if _, r := Validate(encoded(m)); r != nil {
		t.Fatal(r)
	}
	prompts[0].(map[string]any)["role"] = "anchor"
	if _, r := Validate(encoded(m)); r == nil {
		t.Fatal("target has anchor role")
	}
	m = planFixture()
	m["purpose"] = "screening"
	m["targets"] = []string{}
	m["prompts"] = m["prompts"].([]any)[:8]
	if _, r := Validate(encoded(m)); r != nil {
		t.Fatal(r)
	}
	for _, value := range m["prompts"].([]any) {
		value.(map[string]any)["character"] = "K"
	}
	if _, r := Validate(encoded(m)); r == nil {
		t.Fatal("screening did not cover its available two symbols")
	}
}
