package learning

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"slices"
	"testing"
)

type rawPolicyCheck struct {
	Plan         CheckPlan     `json:"plan"`
	Observations []Observation `json:"observations"`
	CompletedAt  *string       `json:"completedAt"`
}

func policyDifference(want, got any, path string) string {
	if reflect.DeepEqual(want, got) {
		return ""
	}
	switch expected := want.(type) {
	case map[string]any:
		actual, ok := got.(map[string]any)
		if !ok {
			return fmt.Sprintf("%s type: want object got %T", path, got)
		}
		keys := []string{}
		for key := range expected {
			keys = append(keys, key)
		}
		for key := range actual {
			if _, ok := expected[key]; !ok {
				return path + " unexpected field " + key
			}
		}
		slices.Sort(keys)
		for _, key := range keys {
			value, exists := actual[key]
			if !exists {
				return path + " missing field " + key
			}
			if difference := policyDifference(expected[key], value, path+"."+key); difference != "" {
				return difference
			}
		}
	case []any:
		actual, ok := got.([]any)
		if !ok || len(expected) != len(actual) {
			return fmt.Sprintf("%s array length/type: want %d got %v", path, len(expected), got)
		}
		for index := range expected {
			if difference := policyDifference(expected[index], actual[index], fmt.Sprintf("%s[%d]", path, index)); difference != "" {
				return difference
			}
		}
	default:
		return fmt.Sprintf("%s: want %v got %v", path, want, got)
	}
	return ""
}
func assertPolicyJSON(t *testing.T, want json.RawMessage, got any) {
	t.Helper()
	var expected, actual any
	_ = json.Unmarshal(want, &expected)
	raw, _ := json.Marshal(got)
	_ = json.Unmarshal(raw, &actual)
	if diff := policyDifference(expected, actual, "result"); diff != "" {
		t.Fatal(diff)
	}
}
func TestLearningPolicySharedParity(t *testing.T) {
	raw, err := os.ReadFile("../../../frontend/testdata/learning-policy-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		PolicyVersion string `json:"policyVersion"`
		Cases         []struct {
			ID        string           `json:"id"`
			Kind      string           `json:"kind"`
			Checks    []rawPolicyCheck `json:"checks"`
			Context   EvidenceContext  `json:"context"`
			Persisted []Attainment     `json:"persisted"`
			Initial   ReviewState      `json:"initial"`
			NowISO    string           `json:"nowIso"`
			Expected  json.RawMessage  `json:"expected"`
		} `json:"cases"`
	}
	if err = json.Unmarshal(raw, &fixture); err != nil || fixture.PolicyVersion != PolicyVersion {
		t.Fatal("invalid parity fixture", err)
	}
	for _, c := range fixture.Cases {
		t.Run(c.ID, func(t *testing.T) {
			evaluated := []EvaluatedCheck{}
			for _, check := range c.Checks {
				evaluated = append(evaluated, EvaluateCheck(check.Plan, check.Observations, check.CompletedAt))
			}
			if c.Kind == "evidence" {
				assertPolicyJSON(t, c.Expected, map[string]any{"evaluated": evaluated, "projection": ProjectCharacterEvidence(evaluated, c.Persisted, c.Context)})
			} else if c.Kind == "review" {
				assertPolicyJSON(t, c.Expected, ReconcileReview(c.Initial, evaluated, c.NowISO))
			} else {
				t.Fatal("unknown parity fixture kind")
			}
		})
	}
}
