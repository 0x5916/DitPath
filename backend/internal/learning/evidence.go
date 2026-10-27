package learning

import (
	"slices"
	"sort"
)

type Attainment struct {
	Key           string   `json:"key"`
	ClaimID       string   `json:"claimId,omitempty"`
	BasisKey      string   `json:"basisKey,omitempty"`
	OwnerKey      string   `json:"ownerKey"`
	ProfileKey    string   `json:"profileKey"`
	PolicyVersion string   `json:"policyVersion"`
	Character     string   `json:"character"`
	Kind          string   `json:"kind"`
	AwardedAt     string   `json:"awardedAt"`
	CheckIDs      []string `json:"checkIds"`
	Status        string   `json:"status"`
}
type EvidenceContext struct {
	OwnerKey   string `json:"ownerKey"`
	ProfileKey string `json:"profileKey"`
	Character  string `json:"character"`
	NowISO     string `json:"nowIso"`
	Coverage   string `json:"coverage"`
}
type CurrentEvidence struct {
	Freshness string  `json:"freshness"`
	Criterion string  `json:"criterion"`
	CheckID   *string `json:"checkId"`
}
type Revalidation struct {
	AwardKey            string   `json:"awardKey"`
	ClaimID             string   `json:"claimId,omitempty"`
	Reason              string   `json:"reason"`
	CheckIDs            []string `json:"checkIds"`
	ReplacementBasisKey string   `json:"replacementBasisKey,omitempty"`
}
type CharacterEvidence struct {
	OwnerKey           string          `json:"ownerKey"`
	ProfileKey         string          `json:"profileKey"`
	Character          string          `json:"character"`
	PolicyVersion      string          `json:"policyVersion"`
	Current            CurrentEvidence `json:"current"`
	Historical         []Attainment    `json:"historical"`
	Candidates         []Attainment    `json:"candidates"`
	Revalidation       []Revalidation  `json:"revalidation"`
	RepeatedDifficulty bool            `json:"repeatedDifficulty"`
	Issues             []string        `json:"issues"`
}

func canonicalChecks(checks []EvaluatedCheck) ([]EvaluatedCheck, []string) {
	byID := map[string]EvaluatedCheck{}
	keys := []string{}
	conflicts := map[string]bool{}
	for _, check := range checks {
		key := canonical([]string{check.OwnerKey, check.ID})
		previous, exists := byID[key]
		if exists && canonical(previous) != canonical(check) {
			conflicts[key] = true
		} else {
			if !exists {
				keys = append(keys, key)
			}
			byID[key] = check
		}
	}
	result := []EvaluatedCheck{}
	for _, key := range keys {
		if !conflicts[key] {
			result = append(result, byID[key])
		}
	}
	return result, sortedKeys(conflicts)
}
func scoped(check EvaluatedCheck, context EvidenceContext) bool {
	_, ok := check.Targets[context.Character]
	return check.OwnerKey == context.OwnerKey && check.ProfileKey == context.ProfileKey && check.PolicyVersion == PolicyVersion && ok
}
func chronological(checks []EvaluatedCheck) {
	sort.SliceStable(checks, func(a, b int) bool {
		left, right := ms(*checks[a].CompletedAt), ms(*checks[b].CompletedAt)
		if left == right {
			return checks[a].ID < checks[b].ID
		}
		return left < right
	})
}
func scopeKey(context EvidenceContext, kind string) string {
	return canonical([]string{context.OwnerKey, context.ProfileKey, context.Character, kind, PolicyVersion})
}
func basisKey(key string, ids []string) string { return canonical(append([]string{key}, ids...)) }

// ProjectCharacterEvidence distinguishes current performance from immutable claims.
func ProjectCharacterEvidence(input []EvaluatedCheck, persisted []Attainment, context EvidenceContext) CharacterEvidence {
	now := ms(context.NowISO)
	scopedChecks := []EvaluatedCheck{}
	knownExposures := []EvaluatedCheck{}
	for _, check := range input {
		if scoped(check, context) {
			scopedChecks = append(scopedChecks, check)
		}
		if _, ok := check.Targets[context.Character]; ok && check.OwnerKey == context.OwnerKey {
			knownExposures = append(knownExposures, check)
		}
	}
	unique, conflicts := canonicalChecks(scopedChecks)
	knownExposures, _ = canonicalChecks(knownExposures)
	eligible := []EvaluatedCheck{}
	byID := map[string]EvaluatedCheck{}
	for _, check := range unique {
		byID[check.ID] = check
		if check.Complete && check.CompletedAt != nil && ms(*check.CompletedAt) <= now {
			eligible = append(eligible, check)
		}
	}
	chronological(eligible)
	uncertain := context.Coverage == "partial" || len(conflicts) > 0
	current := CurrentEvidence{Freshness: "none", Criterion: "insufficient"}
	if len(eligible) > 0 {
		last := eligible[len(eligible)-1]
		id := last.ID
		current.CheckID = &id
		if now-ms(*last.CompletedAt) <= freshnessMS {
			current.Freshness = "recent"
			if passesTarget(last, context.Character) {
				current.Criterion = "met"
			} else {
				current.Criterion = "not-met"
			}
		} else {
			current.Freshness = "stale"
		}
	} else {
		for _, check := range unique {
			if !check.Complete {
				current.Freshness = "incomplete"
				break
			}
		}
	}
	if uncertain {
		current.Freshness = "incomplete"
		current.Criterion = "insufficient"
	}
	result := CharacterEvidence{OwnerKey: context.OwnerKey, ProfileKey: context.ProfileKey, Character: context.Character, PolicyVersion: PolicyVersion, Current: current, Historical: []Attainment{}, Candidates: []Attainment{}, Revalidation: []Revalidation{}, Issues: []string{}}
	for _, key := range conflicts {
		result.Issues = append(result.Issues, "conflicting-check:"+key)
	}
	history := []Attainment{}
	for _, award := range persisted {
		if award.OwnerKey == context.OwnerKey && award.ProfileKey == context.ProfileKey && award.Character == context.Character {
			result.Historical = append(result.Historical, award)
			if award.PolicyVersion == PolicyVersion {
				history = append(history, award)
			}
		}
	}
	invalid := func(award Attainment) bool {
		if award.Status == "unverified" {
			return true
		}
		for _, item := range result.Revalidation {
			if item.Reason == "invalid-witness" && ((item.ClaimID != "" && item.ClaimID == award.ClaimID) || (item.ClaimID == "" && item.AwardKey == award.Key && canonical(item.CheckIDs) == canonical(award.CheckIDs))) {
				return true
			}
		}
		return false
	}
	witness := func(award Attainment) []EvaluatedCheck {
		if len(award.CheckIDs) != 2 {
			return nil
		}
		pair := []EvaluatedCheck{}
		for _, id := range award.CheckIDs {
			check, exists := byID[id]
			if !exists {
				return nil
			}
			pair = append(pair, check)
		}
		return pair
	}
	addInvalid := func(award Attainment) {
		result.Revalidation = append(result.Revalidation, Revalidation{AwardKey: award.Key, ClaimID: award.ClaimID, Reason: "invalid-witness", CheckIDs: append([]string{}, award.CheckIDs...)})
	}
	indexOf := func(id string) int {
		for index, check := range eligible {
			if check.ID == id {
				return index
			}
		}
		return -1
	}
	for _, award := range history {
		pair := witness(award)
		if pair == nil {
			continue
		}
		if pair[0].CompletedAt != nil && pair[1].CompletedAt != nil {
			chronological(pair)
		}
		valid := pair[0].ID != pair[1].ID && passesTarget(pair[0], context.Character) && passesTarget(pair[1], context.Character)
		if valid {
			valid = ms(*pair[1].CompletedAt) <= ms(award.AwardedAt)
		}
		if valid && award.Kind == "proficiency" {
			valid = ms(*pair[1].CompletedAt)-ms(*pair[0].CompletedAt) <= freshnessMS && indexOf(pair[1].ID) == indexOf(pair[0].ID)+1
		} else if valid {
			valid = recordedColdPass(pair[0], context.Character, knownExposures) && recordedColdPass(pair[1], context.Character, knownExposures)
		}
		if !valid {
			addInvalid(award)
		}
	}
	rejected := map[string]bool{}
	for _, award := range history {
		if invalid(award) {
			basis := award.BasisKey
			if basis == "" {
				basis = basisKey(scopeKey(context, award.Kind), award.CheckIDs)
			}
			rejected[basis] = true
		}
	}
	earliest := func(kind string) *Attainment {
		var result *Attainment
		for _, award := range history {
			if award.Kind != kind || invalid(award) || ms(award.AwardedAt) > now {
				continue
			}
			if result == nil || ms(award.AwardedAt) < ms(result.AwardedAt) || (ms(award.AwardedAt) == ms(result.AwardedAt) && canonical(award.CheckIDs) < canonical(result.CheckIDs)) {
				copy := award
				result = &copy
			}
		}
		return result
	}
	selectAward := func(kind string, pair []EvaluatedCheck) *Attainment {
		previous := earliest(kind)
		if pair == nil || uncertain {
			return previous
		}
		ids := []string{pair[0].ID, pair[1].ID}
		key := scopeKey(context, kind)
		candidate := Attainment{Key: key, BasisKey: basisKey(key, ids), OwnerKey: context.OwnerKey, ProfileKey: context.ProfileKey, PolicyVersion: PolicyVersion, Character: context.Character, Kind: kind, AwardedAt: *pair[1].CompletedAt, CheckIDs: ids, Status: "provisional"}
		if previous != nil && ms(previous.AwardedAt) <= ms(candidate.AwardedAt) {
			return previous
		}
		result.Candidates = append(result.Candidates, candidate)
		for _, award := range history {
			if award.Kind == kind && !invalid(award) && ms(award.AwardedAt) <= now && ms(award.AwardedAt) > ms(candidate.AwardedAt) {
				result.Revalidation = append(result.Revalidation, Revalidation{AwardKey: award.Key, ClaimID: award.ClaimID, Reason: "earlier-attainment-found", CheckIDs: append([]string{}, award.CheckIDs...), ReplacementBasisKey: candidate.BasisKey})
			}
		}
		return &candidate
	}
	var proficiencyPair []EvaluatedCheck
	if !uncertain {
		for i := 1; i < len(eligible); i++ {
			pair := eligible[i-1 : i+1]
			key := basisKey(scopeKey(context, "proficiency"), []string{pair[0].ID, pair[1].ID})
			if ms(*pair[1].CompletedAt)-ms(*pair[0].CompletedAt) <= freshnessMS && passesTarget(pair[0], context.Character) && passesTarget(pair[1], context.Character) && !rejected[key] {
				proficiencyPair = pair
				break
			}
		}
	}
	proficiency := selectAward("proficiency", proficiencyPair)
	if proficiency != nil {
		anchor := ms(proficiency.AwardedAt)
		later := []EvaluatedCheck{}
		for _, check := range eligible {
			probe := check.Targets[context.Character].FirstProbe
			if recordedColdPass(check, context.Character, knownExposures) && probe != nil && validBounds(probe.PresentedAt) && ms(probe.PresentedAt.Earliest) > anchor {
				later = append(later, check)
			}
		}
		for _, award := range history {
			if award.Kind != "retention" || invalid(award) {
				continue
			}
			pair := witness(award)
			if pair == nil {
				continue
			}
			valid := true
			for _, check := range pair {
				probe := check.Targets[context.Character].FirstProbe
				if probe == nil || !validBounds(probe.PresentedAt) || ms(probe.PresentedAt.Earliest) <= anchor {
					valid = false
				}
			}
			if valid {
				valid = ms(pair[1].Targets[context.Character].FirstProbe.PresentedAt.Earliest)-anchor >= retentionSpanMS
			}
			if !valid {
				addInvalid(award)
				basis := award.BasisKey
				if basis == "" {
					basis = basisKey(scopeKey(context, "retention"), award.CheckIDs)
				}
				rejected[basis] = true
			}
		}
		var retentionPair []EvaluatedCheck
		for i := 1; i < len(later) && retentionPair == nil; i++ {
			if ms(later[i].Targets[context.Character].FirstProbe.PresentedAt.Earliest)-anchor < retentionSpanMS {
				continue
			}
			for earlier := 0; earlier < i; earlier++ {
				pair := []EvaluatedCheck{later[earlier], later[i]}
				if !rejected[basisKey(scopeKey(context, "retention"), []string{pair[0].ID, pair[1].ID})] {
					retentionPair = pair
					break
				}
			}
		}
		selectAward("retention", retentionPair)
	}
	recent := []EvaluatedCheck{}
	for _, check := range eligible {
		if now-ms(*check.CompletedAt) <= freshnessMS {
			recent = append(recent, check)
		}
	}
	if len(recent) >= 2 && !uncertain {
		last := recent[len(recent)-2:]
		a, b := last[0].Targets[context.Character], last[1].Targets[context.Character]
		fa, fb := a.Eligible-a.UnassistedCorrect, b.Eligible-b.UnassistedCorrect
		result.RepeatedDifficulty = fa >= 1 && fb >= 1 && fa+fb >= 3
	}
	return result
}

type ReviewState struct {
	OwnerKey        string   `json:"ownerKey"`
	ProfileKey      string   `json:"profileKey"`
	Character       string   `json:"character"`
	PolicyVersion   string   `json:"policyVersion"`
	AttainedAt      string   `json:"attainedAt"`
	Rung            int      `json:"rung"`
	DueAt           string   `json:"dueAt"`
	CycleID         string   `json:"cycleId"`
	AppliedCheckIDs []string `json:"appliedCheckIds"`
}
type ReviewResult struct {
	State  ReviewState `json:"state"`
	Issues []string    `json:"issues"`
}

func InitializeReview(award Attainment) ReviewState {
	return ReviewState{OwnerKey: award.OwnerKey, ProfileKey: award.ProfileKey, Character: award.Character, PolicyVersion: PolicyVersion, AttainedAt: award.AwardedAt, Rung: 0, DueAt: iso(ms(award.AwardedAt) + dayMS), CycleID: canonical([]string{award.Key, "initial-review"}), AppliedCheckIDs: []string{}}
}
func ReconcileReview(initial ReviewState, input []EvaluatedCheck, nowISO string) ReviewResult {
	state := initial
	state.AppliedCheckIDs = append([]string{}, initial.AppliedCheckIDs...)
	issues := []string{}
	selected := []EvaluatedCheck{}
	context := EvidenceContext{OwnerKey: initial.OwnerKey, ProfileKey: initial.ProfileKey, Character: initial.Character}
	for _, check := range input {
		if scoped(check, context) {
			selected = append(selected, check)
		}
	}
	checks, conflicts := canonicalChecks(selected)
	for _, id := range conflicts {
		issues = append(issues, "conflicting-check:"+id)
	}
	ordered := []EvaluatedCheck{}
	for _, check := range checks {
		if check.Complete && check.CompletedAt != nil && ms(*check.CompletedAt) <= ms(nowISO) && ms(check.StartedAt) >= ms(initial.AttainedAt) {
			ordered = append(ordered, check)
		}
	}
	sort.SliceStable(ordered, func(a, b int) bool {
		if ms(ordered[a].StartedAt) == ms(ordered[b].StartedAt) {
			return ordered[a].ID < ordered[b].ID
		}
		return ms(ordered[a].StartedAt) < ms(ordered[b].StartedAt)
	})
	overlapping := map[string]bool{}
	for a := range ordered {
		for b := a + 1; b < len(ordered); b++ {
			if ms(ordered[b].StartedAt) < ms(*ordered[a].CompletedAt) {
				overlapping[ordered[a].ID] = true
				overlapping[ordered[b].ID] = true
			}
		}
	}
	for _, check := range ordered {
		if slices.Contains(state.AppliedCheckIDs, check.ID) {
			continue
		}
		if overlapping[check.ID] {
			issues = append(issues, "ambiguous-check-order:"+check.ID)
			continue
		}
		probe := check.Targets[state.Character].FirstProbe
		if probe == nil || !validBounds(probe.PresentedAt) {
			issues = append(issues, "unknown-check-time:"+check.ID)
			continue
		}
		earliest, latest, due := ms(probe.PresentedAt.Earliest), ms(probe.PresentedAt.Latest), ms(state.DueAt)
		if earliest < due && latest >= due {
			issues = append(issues, "uncertain-due-boundary:"+check.ID)
			continue
		}
		state.AppliedCheckIDs = append(state.AppliedCheckIDs, check.ID)
		recovery := ms(*check.CompletedAt) + dayMS
		if latest < due {
			if !passesTarget(check, state.Character) {
				state.Rung = 0
				state.DueAt = iso(min(due, recovery))
			}
			continue
		}
		sameCycle := check.ReviewCycleIDs[state.Character] == state.CycleID
		gap, known := recordedColdGap(check, state.Character, checks)
		cold := known && gap >= coldGapMS
		failed := !passesTarget(check, state.Character) || (cold && !probe.Outcome.UnassistedCorrect)
		if failed {
			state.Rung = 0
			state.DueAt = iso(recovery)
			state.CycleID = canonical([]string{state.OwnerKey, state.ProfileKey, state.Character, PolicyVersion, check.ID, "recovery"})
		} else if sameCycle && cold && probe.Outcome.UnassistedCorrect && recordedColdPass(check, state.Character, checks) {
			state.Rung = min(state.Rung+1, len(reviewIntervalsMS)-1)
			state.DueAt = iso(ms(*check.CompletedAt) + reviewIntervalsMS[state.Rung])
			state.CycleID = canonical([]string{state.OwnerKey, state.ProfileKey, state.Character, PolicyVersion, check.ID, "passed"})
		}
	}
	return ReviewResult{state, issues}
}
