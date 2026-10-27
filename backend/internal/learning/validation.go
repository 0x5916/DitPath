// Package learning owns the additive prospective learning evidence contract.
package learning

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

const PolicyVersion = "learning-policy-1.0"
const MaxPayloadBytes = 256 * 1024
const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?/"

type Rejection struct {
	ID        string `json:"id"`
	ErrorCode string `json:"error_code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

func Reject(id, code, message string, retryable bool) *Rejection {
	return &Rejection{id, code, message, retryable}
}

type Record struct {
	ID, Kind, SessionID, ProfileID, SemanticKey string
	Data                                        map[string]any
	Canonical                                   []byte
}

func (r Record) Text(key string) string { value, _ := r.Data[key].(string); return value }

func DecodeObject(raw []byte) (map[string]any, error) {
	if !utf8.Valid(raw) {
		return nil, fmt.Errorf("JSON must be UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil || value == nil {
		return nil, fmt.Errorf("expected a JSON object")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, fmt.Errorf("unexpected trailing JSON")
	}
	// encoding/json otherwise accepts repeated object keys with last-write-wins.
	if err := uniqueJSONKeys(raw); err != nil {
		return nil, err
	}
	return value, nil
}
func uniqueJSONKeys(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	var walk func() error
	walk = func() error {
		token, err := d.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		if delim == '{' {
			seen := map[string]bool{}
			for d.More() {
				token, err = d.Token()
				if err != nil {
					return err
				}
				key := token.(string)
				if seen[key] {
					return fmt.Errorf("duplicate JSON field")
				}
				seen[key] = true
				if err = walk(); err != nil {
					return err
				}
			}
		} else if delim == '[' {
			for d.More() {
				if err = walk(); err != nil {
					return err
				}
			}
		}
		_, err = d.Token()
		return err
	}
	return walk()
}
func fields(value map[string]any, allowed string) error {
	for key := range value {
		if !slices.Contains(strings.Fields(allowed), key) {
			return fmt.Errorf("unsupported field %s", key)
		}
	}
	return nil
}
func id(value any) bool {
	s, ok := value.(string)
	return ok && strings.TrimSpace(s) != "" && len(s) <= 128 && !strings.ContainsRune(s, 0) && !strings.HasPrefix(s, "legacy:")
}
func normalizeTime(value any) (string, bool) {
	s, ok := value.(string)
	if !ok {
		return "", false
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil || t.Year() < 1 || t.UTC().Year() < 1 || t.UTC().Year() > 9999 {
		return "", false
	}
	return t.UTC().Truncate(time.Microsecond).Format(time.RFC3339Nano), true
}
func stamp(m map[string]any, key string, nullable bool) bool {
	value, exists := m[key]
	if !exists {
		return false
	}
	if nullable && value == nil {
		return true
	}
	t, ok := normalizeTime(value)
	if ok {
		m[key] = t
	}
	return ok
}
func number(m map[string]any, key string, min, max int, nullable bool) bool {
	v, exists := m[key]
	if !exists {
		return false
	}
	if nullable && v == nil {
		return true
	}
	n, ok := v.(json.Number)
	if !ok {
		return false
	}
	i, err := n.Int64()
	if err != nil || i < int64(min) || i > int64(max) {
		return false
	}
	m[key] = int(i)
	return true
}
func boolean(m map[string]any, key string, nullable bool) bool {
	v, exists := m[key]
	if !exists {
		return false
	}
	if nullable && v == nil {
		return true
	}
	_, ok := v.(bool)
	return ok
}
func enum(m map[string]any, key string, values ...string) bool {
	s, ok := m[key].(string)
	return ok && slices.Contains(values, s)
}
func char(value any) bool {
	s, ok := value.(string)
	return ok && len(s) == 1 && strings.Contains(characters, s)
}
func stringSet(m map[string]any, key string, max int, check func(any) bool) bool {
	values, ok := m[key].([]any)
	if !ok || len(values) > max {
		return false
	}
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		if !check(value) {
			return false
		}
		s := value.(string)
		if seen[s] {
			return false
		}
		seen[s] = true
		result = append(result, s)
	}
	slices.Sort(result)
	m[key] = result
	return true
}
func playback(m map[string]any) bool {
	return number(m, "char_wpm", 5, 50, false) && number(m, "eff_wpm", 5, 50, false) && number(m, "freq_hz", 300, 2000, false) && m["eff_wpm"].(int) <= m["char_wpm"].(int)
}
func bounds(value any) bool {
	if value == nil {
		return true
	}
	m, ok := value.(map[string]any)
	if !ok || fields(m, "earliest latest source") != nil {
		return false
	}
	if !stamp(m, "earliest", false) || !stamp(m, "latest", false) || !enum(m, "source", "monotonic-anchored", "wall-clock-bounded") {
		return false
	}
	a, _ := time.Parse(time.RFC3339Nano, m["earliest"].(string))
	b, _ := time.Parse(time.RFC3339Nano, m["latest"].(string))
	return !b.Before(a)
}
func namedBounds(m map[string]any, key string) bool { v, exists := m[key]; return exists && bounds(v) }
func semantic(parts ...string) string {
	raw, _ := json.Marshal(parts)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

// Keep the stored schema-1/policy-1.0 decoder independent of rollout gates.
const mixedCheckIntakeEnabled = true

func Validate(raw json.RawMessage) (Record, *Rejection) { return validateV1(raw, true) }
func DecodeStoredV1(raw json.RawMessage) (Record, *Rejection) {
	data, err := DecodeObject(raw)
	if err == nil && (data["kind"] == "milestone" || data["kind"] == "milestone-correction") {
		record := Record{Data: data}
		record.ID, _ = data["id"].(string)
		record.Kind, _ = data["kind"].(string)
		if !strings.HasPrefix(record.ID, "legacy:lp:") || len(record.ID) > 128 || data["policy_version"] != PolicyVersion {
			return record, Reject(record.ID, "INVALID_RECORD", "Invalid stored server record", false)
		}
		record.Canonical, _ = json.Marshal(data)
		return record, nil
	}
	return validateV1(raw, false)
}

// validateV1 remains the historical decoder when later policies are introduced.
func validateV1(raw json.RawMessage, intake bool) (Record, *Rejection) {
	data, err := DecodeObject(raw)
	r := Record{Data: data}
	if value, ok := data["id"].(string); ok {
		r.ID = value
	}
	if value, ok := data["kind"].(string); ok {
		r.Kind = value
	}
	bad := func(code, message string) (Record, *Rejection) { return r, Reject(r.ID, code, message, false) }
	if err != nil {
		return bad("INVALID_RECORD", "Invalid evidence JSON")
	}
	if !id(data["id"]) || !stamp(data, "recorded_at", false) {
		return bad("INVALID_RECORD", "Require native id and recorded_at")
	}
	if data["policy_version"] != PolicyVersion {
		return bad("UNSUPPORTED_POLICY_VERSION", "Unsupported policy_version")
	}
	base := "id kind policy_version recorded_at "
	switch r.Kind {
	case "plan":
		if intake && !mixedCheckIntakeEnabled && data["purpose"] == "mixed-check" {
			return bad("FEATURE_NOT_ENABLED", "Mixed assessment and milestone projection are not enabled")
		}
		err = fields(data, base+"session_id purpose curriculum_version profile char_wpm eff_wpm freq_hz started_at introduced_characters targets prompts fresh_order feedback review_cycle_ids")
		if err != nil || !id(data["session_id"]) || !enum(data, "purpose", "coaching", "screening", "mixed-check") || data["curriculum_version"] != "koch-39-v1" || !playback(data) || !stamp(data, "started_at", false) || !boolean(data, "fresh_order", false) {
			return bad("INVALID_RECORD", "Invalid learning plan")
		}
		profile, ok := data["profile"].(map[string]any)
		if !ok || fields(profile, "id task char_wpm audio_condition response_support") != nil || !id(profile["id"]) || profile["task"] != "single-character" || profile["audio_condition"] != "clean" || profile["response_support"] != "open" || !number(profile, "char_wpm", 5, 50, false) || profile["char_wpm"] != data["char_wpm"] {
			return bad("INVALID_RECORD", "Invalid goal profile")
		}
		if !stringSet(data, "introduced_characters", 40, char) || len(data["introduced_characters"].([]string)) < 1 || !stringSet(data, "targets", 8, char) {
			return bad("INVALID_RECORD", "Invalid taught/target characters")
		}
		taught := data["introduced_characters"].([]string)
		targets := data["targets"].([]string)
		for _, ch := range targets {
			if !slices.Contains(taught, ch) {
				return bad("INVALID_RECORD", "Targets must be taught characters")
			}
		}

		prompts, ok := data["prompts"].([]any)
		if !ok || len(prompts) > 100 {
			return bad("INVALID_RECORD", "Invalid prompt plan")
		}
		seen := map[string]bool{}
		counts := map[string]int{}
		symbols := map[string]bool{}
		anchors := 0
		for _, value := range prompts {
			prompt, ok := value.(map[string]any)
			if !ok || fields(prompt, "id character role") != nil || !id(prompt["id"]) || !char(prompt["character"]) || !enum(prompt, "role", "target", "anchor") || !slices.Contains(taught, prompt["character"].(string)) || seen[prompt["id"].(string)] {
				return bad("INVALID_RECORD", "Invalid plan prompt")
			}
			seen[prompt["id"].(string)] = true
			ch := prompt["character"].(string)
			counts[ch]++
			symbols[ch] = true
			if prompt["role"] == "anchor" {
				anchors++
			}
			if data["purpose"] != "screening" && (prompt["role"] == "target") != slices.Contains(targets, ch) {
				return bad("INVALID_RECORD", "Prompt role differs from target set")
			}
			if data["purpose"] == "screening" && prompt["role"] != "target" {
				return bad("INVALID_RECORD", "Screening prompts must have target role")
			}
		}
		if data["purpose"] == "mixed-check" {
			wantedAnchors := 0
			if len(taught) > len(targets) {
				wantedAnchors = 4
			}
			if len(taught) < 2 || len(targets) < 1 || len(targets) > 2 || data["fresh_order"] != true || data["feedback"] != "after-check" || anchors != wantedAnchors || len(symbols) < min(4, len(taught)) {
				return bad("INVALID_RECORD", "Mixed checks require fresh open recall with valid targets, anchors and delayed feedback")
			}
			for _, ch := range targets {
				if counts[ch] != 10 {
					return bad("INVALID_RECORD", "Mixed check targets require ten opportunities")
				}
			}
			if data["review_cycle_ids"] == nil {
				delete(data, "review_cycle_ids")
			} else {
				cycles, ok := data["review_cycle_ids"].(map[string]any)
				if !ok || len(cycles) > 2 {
					return bad("INVALID_RECORD", "Invalid review cycles")
				}
				for ch, value := range cycles {
					cycle, ok := value.(string)
					if !ok || !slices.Contains(targets, ch) || strings.TrimSpace(cycle) == "" || len(cycle) > 2048 || strings.ContainsRune(cycle, 0) {
						return bad("INVALID_RECORD", "Invalid bounded review cycle")
					}
				}
			}
		} else {
			if data["feedback"] != "immediate" || data["review_cycle_ids"] != nil {
				return bad("INVALID_RECORD", "Coaching/screening cannot claim a review cycle")
			}
			delete(data, "review_cycle_ids")
			if data["purpose"] == "coaching" {
				if len(prompts) != 12 || len(targets) != 2 {
					return bad("INVALID_RECORD", "Coaching requires twelve prompts and two targets")
				}
				each := 3
				if len(taught) == 2 {
					each = 6
				}
				for _, ch := range targets {
					if counts[ch] != each {
						return bad("INVALID_RECORD", "Coaching must balance pair practice and available anchors")
					}
				}
			} else if len(prompts) != 8 || len(symbols) != min(8, len(taught)) {
				return bad("INVALID_RECORD", "Screening must sample up to eight distinct taught characters in eight prompts")
			}
		}
		r.SessionID = data["session_id"].(string)
		r.ProfileID = profile["id"].(string)
		r.SemanticKey = semantic("plan", r.SessionID)
	case "observation":
		err = fields(data, base+"session_id prompt_id presentation_id first_response final_response skipped replay_count_before_response help_before_response audio_valid interruption_invalidated response_interface first_presented_at prior_exposure char_wpm eff_wpm freq_hz legacy_attempt_id")
		if err != nil || !id(data["session_id"]) || !id(data["prompt_id"]) || !id(data["presentation_id"]) || !playback(data) || !boolean(data, "skipped", false) || !number(data, "replay_count_before_response", 0, 1000, true) || !boolean(data, "help_before_response", true) || !boolean(data, "audio_valid", true) || !boolean(data, "interruption_invalidated", true) || !enum(data, "response_interface", "keyboard", "full-alphabet", "restricted") {
			return bad("INVALID_RECORD", "Invalid observation context")
		}
		for _, field := range []string{"first_response", "final_response"} {
			v, exists := data[field]
			if !exists {
				return bad("INVALID_RECORD", "Response is required, nullable")
			}
			if v != nil {
				s, ok := v.(string)
				if !ok || utf8.RuneCountInString(s) > 64 {
					return bad("INVALID_RECORD", "Invalid response text")
				}
				data[field] = strings.ToUpper(strings.TrimSpace(s))
			}
		}
		if value := data["legacy_attempt_id"]; value != nil && !id(value) {
			return bad("INVALID_RECORD", "Invalid legacy attempt reference")
		}
		if !namedBounds(data, "first_presented_at") || !namedBounds(data, "prior_exposure") {
			return bad("INVALID_TIME_BOUNDS", "Invalid observation time bounds")
		}
		if data["legacy_attempt_id"] == nil {
			delete(data, "legacy_attempt_id")
		}
		if data["skipped"] == true && data["first_response"] != nil && data["first_response"] != "" {
			return bad("INVALID_RECORD", "A skipped opportunity cannot also have a first response")
		}
		r.SessionID = data["session_id"].(string)
		r.SemanticKey = semantic("observation", r.SessionID, data["prompt_id"].(string))
	case "exposure-open":
		if intake && !mixedCheckIntakeEnabled && data["source"] == "mixed-check" {
			return bad("FEATURE_NOT_ENABLED", "Mixed assessment is not enabled")
		}
		if _, exists := data["session_id"]; !exists {
			return bad("INVALID_RECORD", "session_id is required, nullable")
		}
		err = fields(data, base+"session_id presentation_id characters source started_at")
		if err != nil || (data["session_id"] != nil && !id(data["session_id"])) || !id(data["presentation_id"]) || !stringSet(data, "characters", 40, char) || len(data["characters"].([]string)) == 0 || !enum(data, "source", "guided", "reference", "coaching", "screening", "mixed-check", "group", "word", "callsign") {
			return bad("INVALID_RECORD", "Invalid exposure action")
		}
		if !namedBounds(data, "started_at") {
			return bad("INVALID_TIME_BOUNDS", "Invalid exposure start bounds")
		}
		if value, ok := data["session_id"].(string); ok {
			r.SessionID = value
		}
		r.SemanticKey = semantic("exposure-open", data["presentation_id"].(string))
	case "exposure-close":
		err = fields(data, base+"open_id end_reason last_exposure")
		if err != nil || !id(data["open_id"]) || !enum(data, "end_reason", "completed", "stopped", "recovery") {
			return bad("INVALID_RECORD", "Invalid exposure closure")
		}
		ends, ok := data["last_exposure"].(map[string]any)
		if !ok || len(ends) < 1 || len(ends) > 40 {
			return bad("INVALID_RECORD", "Invalid exposure characters")
		}
		for character, value := range ends {
			if !char(character) || !bounds(value) {
				return bad("INVALID_TIME_BOUNDS", "Invalid exposure end bounds")
			}
		}
		r.SemanticKey = semantic("exposure-close", data["open_id"].(string))
	case "terminal":
		err = fields(data, base+"session_id status ended_at observation_ids")
		if err != nil || !id(data["session_id"]) || !enum(data, "status", "completed", "abandoned", "incomplete") || !stamp(data, "ended_at", data["status"] != "completed") || !stringSet(data, "observation_ids", 100, id) {
			return bad("INVALID_RECORD", "Invalid terminal manifest")
		}
		r.SessionID = data["session_id"].(string)
		r.SemanticKey = semantic("terminal", r.SessionID)
	default:
		return bad("INVALID_RECORD", "Unsupported client record kind")
	}
	r.Canonical, err = json.Marshal(data)
	if err != nil {
		return bad("INVALID_RECORD", "Cannot encode evidence")
	}
	return r, nil
}
