package learning

import (
	"bytes"
	"encoding/json"
	"slices"
	"strings"
	"time"
)

const dayMS int64 = 86400000
const freshnessMS int64 = 14 * dayMS
const coldGapMS int64 = 20 * 3600000
const retentionSpanMS int64 = 7 * dayMS

var reviewIntervalsMS = []int64{dayMS, 3 * dayMS, 7 * dayMS, 14 * dayMS, 30 * dayMS}

type GoalProfile struct {
	ID              string `json:"id"`
	Task            string `json:"task"`
	CharWPM         int    `json:"charWpm"`
	AudioCondition  string `json:"audioCondition"`
	ResponseSupport string `json:"responseSupport"`
}
type TimeBounds struct {
	Source   string `json:"source"`
	Earliest string `json:"earliest"`
	Latest   string `json:"latest"`
}
type CheckPrompt struct {
	ID        string `json:"id"`
	Character string `json:"character"`
	Role      string `json:"role"`
}
type CheckPlan struct {
	Purpose              string            `json:"purpose"`
	ID                   string            `json:"id"`
	OwnerKey             string            `json:"ownerKey"`
	PolicyVersion        string            `json:"policyVersion"`
	Profile              GoalProfile       `json:"profile"`
	StartedAt            string            `json:"startedAt"`
	Targets              []string          `json:"targets"`
	IntroducedCharacters []string          `json:"introducedCharacters"`
	Prompts              []CheckPrompt     `json:"prompts"`
	FreshOrder           bool              `json:"freshOrder"`
	Feedback             string            `json:"feedback"`
	ReviewCycleIDs       map[string]string `json:"reviewCycleIds"`
}
type Observation struct {
	ID                        string      `json:"id"`
	OwnerKey                  string      `json:"ownerKey"`
	CheckID                   string      `json:"checkId"`
	PromptID                  string      `json:"promptId"`
	PresentationID            string      `json:"presentationId"`
	FirstResponse             *string     `json:"firstResponse"`
	FinalResponse             *string     `json:"finalResponse"`
	Skipped                   bool        `json:"skipped"`
	ReplayCountBeforeResponse *int        `json:"replayCountBeforeResponse"`
	HelpBeforeResponse        *bool       `json:"helpBeforeResponse"`
	AudioValid                *bool       `json:"audioValid"`
	InterruptionInvalidated   *bool       `json:"interruptionInvalidated"`
	ResponseInterface         string      `json:"responseInterface"`
	FirstPresentedAt          *TimeBounds `json:"firstPresentedAt"`
	PriorExposure             *TimeBounds `json:"priorExposure"`
}
type Outcome struct {
	Eligible          bool   `json:"eligible"`
	UnassistedCorrect bool   `json:"unassistedCorrect"`
	UnassistedAttempt bool   `json:"unassistedAttempt"`
	FinalCorrect      *bool  `json:"finalCorrect"`
	Kind              string `json:"kind"`
}
type Counts struct {
	Eligible          int `json:"eligible"`
	UnassistedCorrect int `json:"unassistedCorrect"`
	FinalCorrect      int `json:"finalCorrect"`
}
type TargetTrial struct {
	ObservationID string  `json:"observationId"`
	PromptID      string  `json:"promptId"`
	EnteredText   *string `json:"enteredText"`
	Outcome       Outcome `json:"outcome"`
}
type FirstProbe struct {
	Outcome       Outcome     `json:"outcome"`
	PresentedAt   *TimeBounds `json:"presentedAt"`
	PriorExposure *TimeBounds `json:"priorExposure"`
}
type TargetResult struct {
	Counts
	Trials     []TargetTrial `json:"trials"`
	FirstProbe *FirstProbe   `json:"firstProbe"`
}
type EvaluatedCheck struct {
	ID             string                  `json:"id"`
	OwnerKey       string                  `json:"ownerKey"`
	PolicyVersion  string                  `json:"policyVersion"`
	ProfileKey     string                  `json:"profileKey"`
	StartedAt      string                  `json:"startedAt"`
	CompletedAt    *string                 `json:"completedAt"`
	Complete       bool                    `json:"complete"`
	Issues         []string                `json:"issues"`
	EvidenceIDs    []string                `json:"evidenceIds"`
	Targets        map[string]TargetResult `json:"targets"`
	Whole          Counts                  `json:"whole"`
	ReviewCycleIDs map[string]string       `json:"reviewCycleIds"`
}

func canonical(value any) string {
	raw, _ := json.Marshal(value)
	var normalized any
	_ = json.Unmarshal(raw, &normalized)
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(normalized)
	return strings.TrimSuffix(buf.String(), "\n")
}
func millis(value string) (int64, bool) {
	t, err := time.Parse(time.RFC3339Nano, value)
	return t.UnixMilli(), err == nil
}
func ms(value string) int64    { result, _ := millis(value); return result }
func iso(value int64) string   { return time.UnixMilli(value).UTC().Format("2006-01-02T15:04:05.000Z") }
func isTrue(value *bool) bool  { return value != nil && *value }
func isFalse(value *bool) bool { return value != nil && !*value }
func validBounds(value *TimeBounds) bool {
	if value == nil || !slices.Contains([]string{"monotonic-anchored", "wall-clock-bounded"}, value.Source) {
		return false
	}
	first, a := millis(value.Earliest)
	last, b := millis(value.Latest)
	return a && b && first <= last
}
func coldGap(probe *FirstProbe) (int64, bool) {
	if probe == nil || !validBounds(probe.PresentedAt) || !validBounds(probe.PriorExposure) {
		return 0, false
	}
	gap := ms(probe.PresentedAt.Earliest) - ms(probe.PriorExposure.Latest)
	return gap, gap >= 0
}
func assess(character string, o Observation) Outcome {
	var final *bool
	if o.FinalResponse != nil {
		value := strings.ToUpper(strings.TrimSpace(*o.FinalResponse)) == character
		final = &value
	}
	result := Outcome{Kind: "unknown", FinalCorrect: final}
	if isFalse(o.AudioValid) || isTrue(o.InterruptionInvalidated) || (o.FirstResponse == nil && !o.Skipped) {
		result.Kind = "unmeasured"
		return result
	}
	if !isTrue(o.AudioValid) || !isFalse(o.InterruptionInvalidated) || o.HelpBeforeResponse == nil || o.ReplayCountBeforeResponse == nil || *o.ReplayCountBeforeResponse < 0 || !slices.Contains([]string{"keyboard", "full-alphabet"}, o.ResponseInterface) {
		return result
	}
	if o.Skipped && o.FirstResponse != nil && strings.TrimSpace(*o.FirstResponse) != "" {
		return result
	}
	result.Eligible = true
	result.UnassistedAttempt = !*o.HelpBeforeResponse && *o.ReplayCountBeforeResponse == 0
	if o.Skipped {
		result.Kind = "skipped"
		return result
	}
	if o.FirstResponse == nil || strings.ToUpper(strings.TrimSpace(*o.FirstResponse)) != character {
		result.Kind = "incorrect"
		return result
	}
	if *o.HelpBeforeResponse || *o.ReplayCountBeforeResponse > 0 {
		result.Kind = "supported"
		return result
	}
	result.Kind = "unassisted"
	result.UnassistedCorrect = true
	return result
}
func addCount(value Counts, outcome Outcome) Counts {
	if outcome.Eligible {
		value.Eligible++
		if isTrue(outcome.FinalCorrect) {
			value.FinalCorrect++
		}
	}
	if outcome.UnassistedCorrect {
		value.UnassistedCorrect++
	}
	return value
}
func uniqueStrings(values []string) map[string]bool {
	result := map[string]bool{}
	for _, value := range values {
		result[value] = true
	}
	return result
}
func sortedKeys(values map[string]bool) []string {
	result := []string{}
	for value := range values {
		result = append(result, value)
	}
	slices.Sort(result)
	return result
}

// EvaluateCheck is pure and mirrors the versioned TypeScript policy fixtures.
func EvaluateCheck(plan CheckPlan, observations []Observation, completedAt *string) EvaluatedCheck {
	issues := map[string]bool{}
	taught := uniqueStrings(plan.IntroducedCharacters)
	targets := uniqueStrings(plan.Targets)
	promptIDs, symbols := map[string]bool{}, map[string]bool{}
	other := 0
	for ch := range taught {
		if !targets[ch] {
			other++
		}
	}
	for _, prompt := range plan.Prompts {
		promptIDs[prompt.ID] = true
		symbols[prompt.Character] = true
	}
	if plan.Purpose != "mixed-check" || plan.ID == "" || plan.OwnerKey == "" || plan.PolicyVersion != PolicyVersion || plan.Profile.ID == "" || plan.Profile.Task != "single-character" || plan.Profile.AudioCondition != "clean" || plan.Profile.ResponseSupport != "open" || plan.Profile.CharWPM < 5 || plan.Profile.CharWPM > 50 {
		issues["unsupported-context"] = true
	}
	_, startOK := millis(plan.StartedAt)
	if !startOK {
		issues["invalid-time"] = true
	}
	if completedAt != nil {
		_, ok := millis(*completedAt)
		if !ok || ms(*completedAt) < ms(plan.StartedAt) {
			issues["invalid-time"] = true
		}
	}
	if !plan.FreshOrder || plan.Feedback != "after-check" {
		issues["unsupported-assessment"] = true
	}
	if len(targets) != len(plan.Targets) || len(targets) < 1 || len(targets) > 2 || len(taught) < 2 {
		issues["invalid-targets"] = true
	}
	for ch := range taught {
		if !char(ch) {
			issues["invalid-targets"] = true
		}
	}
	for ch := range targets {
		if !taught[ch] {
			issues["invalid-targets"] = true
		}
	}
	if len(promptIDs) != len(plan.Prompts) {
		issues["invalid-plan"] = true
	}
	anchorCount := 0
	targetCounts := map[string]int{}
	for _, prompt := range plan.Prompts {
		if prompt.ID == "" || !slices.Contains([]string{"target", "anchor"}, prompt.Role) || !taught[prompt.Character] || (prompt.Role == "target") != targets[prompt.Character] {
			issues["invalid-plan"] = true
		}
		if prompt.Role == "anchor" {
			anchorCount++
		} else if prompt.Role == "target" {
			targetCounts[prompt.Character]++
		}
	}
	if len(symbols) < min(4, len(taught)) {
		issues["insufficient-mix"] = true
	}
	for ch := range targets {
		if targetCounts[ch] != 10 {
			issues["invalid-target-count"] = true
		}
	}
	wantedAnchors := 0
	if other > 0 {
		wantedAnchors = 4
	}
	if anchorCount != wantedAnchors {
		issues["invalid-anchor-count"] = true
	}
	byID := map[string]Observation{}
	byPrompt := map[string]Observation{}
	presentations := map[string]bool{}
	for _, o := range observations {
		if prior, exists := byID[o.ID]; exists {
			if canonical(prior) != canonical(o) {
				issues["conflicting-observation"] = true
			}
			continue
		}
		byID[o.ID] = o
		if o.ID == "" || o.PresentationID == "" || o.OwnerKey != plan.OwnerKey || o.CheckID != plan.ID || !promptIDs[o.PromptID] {
			issues["invalid-observation-scope"] = true
			continue
		}
		if _, exists := byPrompt[o.PromptID]; exists || presentations[o.PresentationID] {
			issues["duplicate-presentation"] = true
			continue
		}
		if o.FirstPresentedAt != nil && (!validBounds(o.FirstPresentedAt) || ms(o.FirstPresentedAt.Latest) < ms(plan.StartedAt) || (completedAt != nil && ms(o.FirstPresentedAt.Earliest) > ms(*completedAt))) {
			issues["invalid-presentation-time"] = true
		}
		byPrompt[o.PromptID] = o
		presentations[o.PresentationID] = true
	}
	result := EvaluatedCheck{ID: plan.ID, OwnerKey: plan.OwnerKey, PolicyVersion: plan.PolicyVersion, ProfileKey: canonical(plan.Profile), StartedAt: plan.StartedAt, CompletedAt: completedAt, Targets: map[string]TargetResult{}, EvidenceIDs: []string{}, ReviewCycleIDs: map[string]string{}}
	for key, value := range plan.ReviewCycleIDs {
		result.ReviewCycleIDs[key] = value
	}
	for ch := range targets {
		result.Targets[ch] = TargetResult{Trials: []TargetTrial{}}
	}
	var previous *TimeBounds
	for _, prompt := range plan.Prompts {
		observation, exists := byPrompt[prompt.ID]
		if !exists {
			issues["missing-observation"] = true
			continue
		}
		if validBounds(observation.FirstPresentedAt) {
			if previous != nil && ms(observation.FirstPresentedAt.Latest) < ms(previous.Earliest) {
				issues["conflicting-presentation-order"] = true
			}
			previous = observation.FirstPresentedAt
		}
		outcome := assess(prompt.Character, observation)
		if !outcome.Eligible {
			issues["unmeasured-opportunity"] = true
		}
		result.Whole = addCount(result.Whole, outcome)
		if prompt.Role == "target" {
			target, exists := result.Targets[prompt.Character]
			if !exists {
				continue
			}
			target.Counts = addCount(target.Counts, outcome)
			var entered *string
			if observation.FirstResponse != nil {
				value := strings.ToUpper(strings.TrimSpace(*observation.FirstResponse))
				entered = &value
			}
			target.Trials = append(target.Trials, TargetTrial{observation.ID, prompt.ID, entered, outcome})
			if target.FirstProbe == nil {
				target.FirstProbe = &FirstProbe{outcome, observation.FirstPresentedAt, observation.PriorExposure}
			}
			result.Targets[prompt.Character] = target
		}
	}
	for id := range byID {
		result.EvidenceIDs = append(result.EvidenceIDs, id)
	}
	slices.Sort(result.EvidenceIDs)
	result.Issues = sortedKeys(issues)
	result.Complete = completedAt != nil && len(issues) == 0
	return result
}
func passesTarget(check EvaluatedCheck, character string) bool {
	result, exists := check.Targets[character]
	return check.Complete && exists && result.Eligible == 10 && result.UnassistedCorrect >= 9
}
func recordedColdGap(check EvaluatedCheck, character string, known []EvaluatedCheck) (int64, bool) {
	probe := check.Targets[character].FirstProbe
	gap, ok := coldGap(probe)
	if !ok {
		return 0, false
	}
	first := ms(probe.PresentedAt.Earliest)
	latest := ms(probe.PresentedAt.Latest)
	for _, other := range known {
		if other.ID == check.ID || other.OwnerKey != check.OwnerKey {
			continue
		}
		otherProbe := other.Targets[character].FirstProbe
		if otherProbe == nil || !validBounds(otherProbe.PresentedAt) || ms(otherProbe.PresentedAt.Earliest) > latest {
			continue
		}
		upper := ms(otherProbe.PresentedAt.Latest)
		if other.CompletedAt != nil {
			upper = max(upper, ms(*other.CompletedAt))
		}
		gap = min(gap, first-upper)
	}
	return gap, gap >= 0
}
func recordedColdPass(check EvaluatedCheck, character string, known []EvaluatedCheck) bool {
	gap, ok := recordedColdGap(check, character, known)
	probe := check.Targets[character].FirstProbe
	return passesTarget(check, character) && probe != nil && probe.Outcome.UnassistedCorrect && ok && gap >= coldGapMS
}
