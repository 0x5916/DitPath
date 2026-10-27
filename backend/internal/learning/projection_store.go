package learning

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"opencw/internal/models"
)

type checkAggregate struct {
	plan         CheckPlan
	observations []Observation
	completedAt  *string
}
type ledgerState struct {
	checks   map[string]*checkAggregate
	facts    map[string]*ExposureFact
	profiles map[string]GoalProfile
	claims   []Attainment
}

func newLedgerState() *ledgerState {
	return &ledgerState{checks: map[string]*checkAggregate{}, facts: map[string]*ExposureFact{}, profiles: map[string]GoalProfile{}, claims: []Attainment{}}
}
func wireProfile(data map[string]any) GoalProfile {
	return GoalProfile{ID: data["id"].(string), Task: data["task"].(string), CharWPM: data["char_wpm"].(int), AudioCondition: data["audio_condition"].(string), ResponseSupport: data["response_support"].(string)}
}
func profileToWire(p GoalProfile) map[string]any {
	return map[string]any{"id": p.ID, "task": p.Task, "char_wpm": p.CharWPM, "audio_condition": p.AudioCondition, "response_support": p.ResponseSupport}
}
func boolPointer(value any) *bool {
	if v, ok := value.(bool); ok {
		return &v
	}
	return nil
}
func stringPointer(value any) *string {
	if v, ok := value.(string); ok {
		return &v
	}
	return nil
}
func intPointer(value any) *int {
	if v, ok := value.(int); ok {
		return &v
	}
	return nil
}
func wireStringArray(value any) []string {
	if values, ok := value.([]string); ok {
		return values
	}
	result := []string{}
	if values, ok := value.([]any); ok {
		for _, v := range values {
			if s, ok := v.(string); ok {
				result = append(result, s)
			}
		}
	}
	return result
}
func millisISO(value string) string { return iso(ms(value)) }
func (state *ledgerState) add(record Record, owner string) error {
	data := record.Data
	switch record.Kind {
	case "plan":
		if record.Text("purpose") != "mixed-check" {
			return nil
		}
		profile := wireProfile(data["profile"].(map[string]any))
		plan := CheckPlan{Purpose: "mixed-check", ID: record.SessionID, OwnerKey: owner, PolicyVersion: PolicyVersion, Profile: profile, StartedAt: millisISO(record.Text("started_at")), Targets: textSet(data, "targets"), IntroducedCharacters: textSet(data, "introduced_characters"), Prompts: []CheckPrompt{}, FreshOrder: data["fresh_order"] == true, Feedback: record.Text("feedback"), ReviewCycleIDs: map[string]string{}}
		for _, value := range data["prompts"].([]any) {
			p := value.(map[string]any)
			plan.Prompts = append(plan.Prompts, CheckPrompt{p["id"].(string), p["character"].(string), p["role"].(string)})
		}
		if cycles, ok := data["review_cycle_ids"].(map[string]any); ok {
			for ch, value := range cycles {
				plan.ReviewCycleIDs[ch] = value.(string)
			}
		}
		state.checks[plan.ID] = &checkAggregate{plan: plan, observations: []Observation{}}
		state.profiles[canonical(profile)] = profile
	case "observation":
		check := state.checks[record.SessionID]
		if check == nil {
			return nil
		}
		check.observations = append(check.observations, Observation{ID: record.ID, OwnerKey: owner, CheckID: record.SessionID, PromptID: record.Text("prompt_id"), PresentationID: record.Text("presentation_id"), FirstResponse: stringPointer(data["first_response"]), FinalResponse: stringPointer(data["final_response"]), Skipped: data["skipped"] == true, ReplayCountBeforeResponse: intPointer(data["replay_count_before_response"]), HelpBeforeResponse: boolPointer(data["help_before_response"]), AudioValid: boolPointer(data["audio_valid"]), InterruptionInvalidated: boolPointer(data["interruption_invalidated"]), ResponseInterface: record.Text("response_interface"), FirstPresentedAt: domainBounds(data["first_presented_at"]), PriorExposure: nil})
	case "terminal":
		if check := state.checks[record.SessionID]; check != nil && record.Text("status") == "completed" {
			value := millisISO(record.Text("ended_at"))
			check.completedAt = &value
		}
	case "exposure-open":
		state.facts[record.ID] = &ExposureFact{ID: record.ID, PresentationID: record.Text("presentation_id"), Characters: textSet(data, "characters"), StartedAt: domainBounds(data["started_at"]), LastExposure: map[string]*TimeBounds{}}
	case "exposure-close":
		fact := state.facts[record.Text("open_id")]
		if fact == nil {
			return fmt.Errorf("stored closure has no exposure guard")
		}
		fact.CloseID = record.ID
		fact.EndReason = record.Text("end_reason")
		for ch, value := range data["last_exposure"].(map[string]any) {
			fact.LastExposure[ch] = domainBounds(value)
		}
	case "milestone":
		profileData, ok := data["profile"].(map[string]any)
		if !ok {
			return fmt.Errorf("stored milestone has no profile")
		}
		// Server records are decoded without client intake coercion.
		raw, _ := json.Marshal(profileData)
		normalized, _ := DecodeObject(raw)
		if !number(normalized, "char_wpm", 5, 50, false) {
			return fmt.Errorf("invalid milestone profile")
		}
		profile := wireProfile(normalized)
		profileKey := canonical(profile)
		ch, kind := record.Text("character"), record.Text("milestone_kind")
		key := scopeKey(EvidenceContext{OwnerKey: owner, ProfileKey: profileKey, Character: ch}, kind)
		ids := wireStringArray(data["check_ids"])
		state.claims = append(state.claims, Attainment{Key: key, ClaimID: record.ID, BasisKey: basisKey(key, ids), OwnerKey: owner, ProfileKey: profileKey, PolicyVersion: record.Text("policy_version"), Character: ch, Kind: kind, AwardedAt: record.Text("awarded_at"), CheckIDs: ids, Status: "verified"})
		state.profiles[profileKey] = profile
	case "milestone-correction":
		for i := range state.claims {
			if state.claims[i].ClaimID == record.Text("milestone_id") {
				state.claims[i].Status = record.Text("status")
			}
		}
	}
	return nil
}
func serverID(prefix, key string) string {
	hash := sha256.Sum256([]byte(key))
	return prefix + hex.EncodeToString(hash[:])
}
func (state *ledgerState) evaluated() (checks []EvaluatedCheck, witnesses map[string]map[string][]string, unknown map[string]map[string]bool) {
	facts := []*ExposureFact{}
	for _, fact := range state.facts {
		facts = append(facts, fact)
	}
	index := NewExposureIndex(facts)
	checks = []EvaluatedCheck{}
	witnesses = map[string]map[string][]string{}
	unknown = map[string]map[string]bool{}
	ids := []string{}
	for id := range state.checks {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		aggregate := state.checks[id]
		byPrompt := map[string]*Observation{}
		for i := range aggregate.observations {
			byPrompt[aggregate.observations[i].PromptID] = &aggregate.observations[i]
		}
		witnesses[id] = map[string][]string{}
		unknown[id] = map[string]bool{}
		seen := map[string]bool{}
		for _, prompt := range aggregate.plan.Prompts {
			observation := byPrompt[prompt.ID]
			if observation == nil {
				continue
			}
			prior, evidence, uncertain := index.Prior(prompt.Character, observation.PresentationID, observation.FirstPresentedAt)
			observation.PriorExposure = prior
			// Intake stores evidence as supplied; awards additionally require a closed,
			// completed first delivery. An unresolved guard can be closed in a later batch.
			own := index.byPresentation[observation.PresentationID]
			if own == nil || own.EndReason != "completed" || !validBounds(exposureEnd(own, prompt.Character)) {
				observation.AudioValid = nil
				if own != nil && own.EndReason == "stopped" {
					value := false
					observation.AudioValid = &value
				}
			}
			if prompt.Role == "target" && !seen[prompt.Character] {
				seen[prompt.Character] = true
				witnesses[id][prompt.Character] = evidence
				unknown[id][prompt.Character] = uncertain
			}
		}
		checks = append(checks, EvaluateCheck(aggregate.plan, aggregate.observations, aggregate.completedAt))
	}
	return
}

// appendServerRecord uses its deterministic immutable identity, preserving the original watermark on retry.
func appendServerRecord(tx *gorm.DB, state *models.LearningEvidenceSyncState, payload map[string]any) error {
	id := payload["id"].(string)
	var count int64
	if err := tx.Model(&models.LearningEvidenceRecord{}).Where("user_id = ? AND record_id = ?", state.UserID, id).Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return nil
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(raw)
	state.LastRevision++
	record := models.LearningEvidenceRecord{UserID: state.UserID, RecordID: id, Kind: payload["kind"].(string), SemanticKey: semantic("server", id), PolicyVersion: PolicyVersion, Payload: raw, PayloadHash: hash[:], ClientID: uuid.Nil, ReceivedAt: time.Now().UTC(), Revision: state.LastRevision}
	if err = tx.Create(&record).Error; err != nil {
		return err
	}
	change := models.LearningEvidenceChange{UserID: state.UserID, Revision: state.LastRevision, Kind: record.Kind, RecordID: id, Payload: raw}
	if err = tx.Create(&change).Error; err != nil {
		return err
	}
	return tx.Model(state).Update("last_revision", state.LastRevision).Error
}

// ProjectAccount runs once after a batch under the same account lock. It never
// interprets absent exposure metadata as a demonstrated silent interval.
func ProjectAccount(tx *gorm.DB, state *models.LearningEvidenceSyncState, triggerIDs []string, now time.Time) error {
	ledger := newLedgerState()
	owner := "account:" + state.UserID.String()
	rows, err := tx.Model(&models.LearningEvidenceRecord{}).Where("user_id = ?", state.UserID).Order("revision ASC").Rows()
	if err != nil {
		return err
	}
	for rows.Next() {
		var row models.LearningEvidenceRecord
		if err = tx.ScanRows(rows, &row); err != nil {
			rows.Close()
			return err
		}
		record, rejection := DecodeStoredV1(row.Payload)
		if rejection != nil {
			rows.Close()
			return fmt.Errorf("invalid stored learning evidence: %s", rejection.Message)
		}
		if err = ledger.add(record, owner); err != nil {
			rows.Close()
			return err
		}
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err = rows.Close(); err != nil {
		return err
	}
	checks, witnesses, unknown := ledger.evaluated()
	byPresentation := map[string]*ExposureFact{}
	for _, fact := range ledger.facts {
		byPresentation[fact.PresentationID] = fact
	}
	byID := map[string]EvaluatedCheck{}
	scopes := map[string]EvidenceContext{}
	for _, check := range checks {
		byID[check.ID] = check
		for ch := range check.Targets {
			key := canonical([]string{check.ProfileKey, ch})
			scopes[key] = EvidenceContext{OwnerKey: owner, ProfileKey: check.ProfileKey, Character: ch, NowISO: iso(now.UnixMilli()), Coverage: "complete"}
		}
	}
	keys := []string{}
	for key := range scopes {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	slices.Sort(triggerIDs)
	watermark := strconv.FormatInt(state.LastRevision, 10)
	recorded := now.UTC().Truncate(time.Microsecond).Format(time.RFC3339Nano)
	for _, key := range keys {
		context := scopes[key]
		projection := ProjectCharacterEvidence(checks, ledger.claims, context)
		replacementIDs := map[string]string{}
		for _, candidate := range projection.Candidates {
			id := serverID("legacy:lp:m:", candidate.BasisKey)
			replacementIDs[candidate.BasisKey] = id
			observationIDs, exposureIDs := map[string]bool{}, map[string]bool{}
			gaps := []any{}
			for _, checkID := range candidate.CheckIDs {
				check := byID[checkID]
				for _, observationID := range check.EvidenceIDs {
					observationIDs[observationID] = true
				}
				for _, observation := range ledger.checks[checkID].observations {
					for _, witness := range factIDs(byPresentation[observation.PresentationID]) {
						exposureIDs[witness] = true
					}
				}
				for _, exposureID := range witnesses[checkID][candidate.Character] {
					exposureIDs[exposureID] = true
				}
				if candidate.Kind == "retention" {
					probe := check.Targets[candidate.Character].FirstProbe
					gap, _ := recordedColdGap(check, candidate.Character, checks)
					gaps = append(gaps, map[string]any{"check_id": checkID, "minimum_ms": gap, "prior_exposure": probe.PriorExposure, "first_presented_at": probe.PresentedAt})
				}
			}
			payload := map[string]any{"id": id, "kind": "milestone", "policy_version": PolicyVersion, "recorded_at": recorded, "character": candidate.Character, "profile": profileToWire(ledger.profiles[candidate.ProfileKey]), "milestone_kind": candidate.Kind, "awarded_at": candidate.AwardedAt, "check_ids": candidate.CheckIDs, "observation_ids": sortedKeys(observationIDs), "exposure_ids": sortedKeys(exposureIDs), "gap_bounds": gaps, "scope": "available-recorded-history", "source_revision": watermark}
			if err = appendServerRecord(tx, state, payload); err != nil {
				return err
			}
		}
		for _, correction := range projection.Revalidation {
			var prior *Attainment
			for i := range ledger.claims {
				claim := &ledger.claims[i]
				if (correction.ClaimID != "" && claim.ClaimID == correction.ClaimID) || (correction.ClaimID == "" && claim.Key == correction.AwardKey && canonical(claim.CheckIDs) == canonical(correction.CheckIDs)) {
					prior = claim
					break
				}
			}
			if prior == nil || prior.Status == "unverified" {
				continue
			}
			// An open guard can arrive before its closure in another batch. Keep that
			// claim pending in the current client projection; do not reject its basis forever.
			pending := false
			if prior.Kind == "retention" && correction.Reason == "invalid-witness" {
				for _, checkID := range prior.CheckIDs {
					if unknown[checkID][prior.Character] {
						pending = true
					}
				}
			}
			if pending {
				continue
			}
			status, reason := "unverified", "late-evidence-invalidated"
			var replacement any
			if correction.Reason == "earlier-attainment-found" {
				status, reason = "superseded", "earlier-attainment-found"
				replacement = replacementIDs[correction.ReplacementBasisKey]
				if replacement == "" {
					continue
				}
			}
			id := serverID("legacy:lp:c:", canonical([]any{prior.ClaimID, status, reason, triggerIDs, replacement}))
			payload := map[string]any{"id": id, "kind": "milestone-correction", "policy_version": PolicyVersion, "recorded_at": recorded, "milestone_id": prior.ClaimID, "status": status, "reason": reason, "evidence_ids": triggerIDs, "source_revision": watermark, "replacement_id": replacement}
			if err = appendServerRecord(tx, state, payload); err != nil {
				return err
			}
		}
	}
	return nil
}

// Deterministic convenience for tests and future disposable projection caches.
func sortedChecks(checks []EvaluatedCheck) {
	sort.Slice(checks, func(a, b int) bool { return checks[a].ID < checks[b].ID })
}
