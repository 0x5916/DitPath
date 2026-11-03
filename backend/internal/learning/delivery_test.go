package learning

import (
	"fmt"
	"testing"
	"time"
)

// deliveryLedger mirrors the frontend terminal-completion scenarios using the
// same raw wire records: a completed terminal cannot qualify without a closed,
// completed first delivery.
func deliveryLedger(t *testing.T, mutate func(records map[string]map[string]any)) *ledgerState {
	t.Helper()
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	stamp := func(value time.Time) string { return value.UTC().Format(time.RFC3339Nano) }
	bounds := func(value time.Time) map[string]any {
		return map[string]any{"earliest": stamp(value), "latest": stamp(value), "source": "wall-clock-bounded"}
	}
	prompts := []any{}
	ids := []string{}
	records := map[string]map[string]any{}
	for index := 0; index < 14; index++ {
		character, role := "K", "target"
		if index >= 10 {
			character, role = "M", "anchor"
		}
		prompt, presentation := fmt.Sprintf("p%d", index), fmt.Sprintf("tone%d", index)
		prompts = append(prompts, map[string]any{"id": prompt, "character": character, "role": role})
		at := base.Add(time.Duration(index+1) * time.Second)
		open := fmt.Sprintf("open_%s", presentation)
		records[open] = map[string]any{
			"kind": "exposure-open", "session_id": "check", "presentation_id": presentation,
			"characters": []string{character}, "source": "mixed-check", "started_at": bounds(at),
		}
		records["close_"+presentation] = map[string]any{
			"kind": "exposure-close", "open_id": open, "end_reason": "completed",
			"last_exposure": map[string]any{character: bounds(at)},
		}
		observation := fmt.Sprintf("answer%d", index)
		records[observation] = map[string]any{
			"kind": "observation", "session_id": "check", "prompt_id": prompt,
			"presentation_id": presentation, "first_response": character, "final_response": character,
			"skipped": false, "replay_count_before_response": 0, "help_before_response": false,
			"audio_valid": true, "interruption_invalidated": false, "response_interface": "keyboard",
			"first_presented_at": bounds(at), "prior_exposure": nil,
		}
		ids = append(ids, observation)
	}
	plan := map[string]any{
		"kind": "plan", "session_id": "check", "purpose": "mixed-check",
		"profile":    map[string]any{"id": "clean-20", "task": "single-character", "char_wpm": 20, "audio_condition": "clean", "response_support": "open"},
		"started_at": stamp(base), "targets": []string{"K"}, "introduced_characters": []string{"K", "M"},
		"prompts": prompts, "fresh_order": true, "feedback": "after-check",
	}
	terminal := map[string]any{
		"kind": "terminal", "session_id": "check", "status": "completed",
		"ended_at": stamp(base.Add(time.Minute)), "observation_ids": ids,
	}
	records["plan"] = plan
	records["terminal"] = terminal
	mutate(records)
	state := newLedgerState()
	order := []string{"plan"}
	for _, kind := range []string{"exposure-open", "exposure-close", "observation"} {
		for id, data := range records {
			if data["kind"] == kind {
				order = append(order, id)
			}
		}
	}
	order = append(order, "terminal")
	for _, id := range order {
		data := records[id]
		if data == nil {
			continue
		}
		kind, _ := data["kind"].(string)
		record := Record{ID: id, Kind: kind, Data: data, SessionID: "check"}
		if err := state.add(record, "account:test"); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
	}
	return state
}
func TestCompletedTerminalRequiresEvaluatedDelivery(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(map[string]map[string]any)
		want   bool
	}{
		{"valid completion", func(map[string]map[string]any) {}, true},
		{"missing closure", func(records map[string]map[string]any) { delete(records, "close_tone0") }, false},
		{"stopped playback", func(records map[string]map[string]any) { records["close_tone0"]["end_reason"] = "stopped" }, false},
		{"invalid audio", func(records map[string]map[string]any) { records["answer0"]["audio_valid"] = false }, false},
		{"unresolved bounds", func(records map[string]map[string]any) {
			delete(records, "close_tone0")
			records["open_tone0"]["started_at"] = nil
		}, false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			checks, _, _ := deliveryLedger(t, test.mutate).evaluated()
			if len(checks) != 1 {
				t.Fatalf("checks: %d", len(checks))
			}
			if checks[0].Complete != test.want {
				t.Fatalf("complete=%v issues=%v", checks[0].Complete, checks[0].Issues)
			}
		})
	}
}
