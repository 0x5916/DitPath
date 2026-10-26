package learning

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"opencw/internal/models"
	"slices"
	"time"
)

func LockAccount(tx *gorm.DB, userID uuid.UUID) (*models.LearningEvidenceSyncState, error) {
	state := models.LearningEvidenceSyncState{UserID: userID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&state).Error; err != nil {
		return nil, err
	}
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&state, "user_id = ?", userID).Error
	return &state, err
}
func lookup(tx *gorm.DB, user uuid.UUID, key string, bySemantic bool) (Record, error) {
	var row models.LearningEvidenceRecord
	field := "record_id"
	if bySemantic {
		field = "semantic_key"
	}
	err := tx.Take(&row, "user_id = ? AND "+field+" = ?", user, key).Error
	if err != nil {
		return Record{}, err
	}
	record, rejection := Validate(row.Payload)
	if rejection != nil {
		return Record{}, fmt.Errorf("invalid stored learning evidence")
	}
	return record, nil
}
func dependency(tx *gorm.DB, user uuid.UUID, key string, bySemantic bool, id string) (Record, *Rejection, error) {
	record, err := lookup(tx, user, key, bySemantic)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Record{}, Reject(id, "MISSING_EVIDENCE_DEPENDENCY", "Upload required evidence first", true), nil
	}
	return record, nil, err
}
func equalJSON(a, b any) bool {
	left, _ := json.Marshal(a)
	right, _ := json.Marshal(b)
	return bytes.Equal(left, right)
}
func textSet(data map[string]any, key string) []string {
	result, _ := data[key].([]string)
	return result
}

// Store requires the learning account lock in its surrounding transaction.
func Store(tx *gorm.DB, state *models.LearningEvidenceSyncState, clientID uuid.UUID, record Record) (*Rejection, error) {
	previous, err := lookup(tx, state.UserID, record.ID, false)
	if err == nil {
		if !bytes.Equal(previous.Canonical, record.Canonical) {
			return Reject(record.ID, "ID_CONFLICT", "Evidence content is immutable", false), nil
		}
		return nil, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	_, err = lookup(tx, state.UserID, record.SemanticKey, true)
	if err == nil {
		return Reject(record.ID, "EVIDENCE_SET_CONFLICT", "Evidence identity already has a canonical record", false), nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	rejection, err := checkDependencies(tx, state.UserID, record)
	if err != nil || rejection != nil {
		return rejection, err
	}
	state.LastRevision++
	hash := sha256.Sum256(record.Canonical)
	row := models.LearningEvidenceRecord{UserID: state.UserID, RecordID: record.ID, Kind: record.Kind,
		SessionID: record.SessionID, ProfileID: record.ProfileID, SemanticKey: record.SemanticKey,
		PolicyVersion: PolicyVersion, Payload: record.Canonical, PayloadHash: hash[:], ClientID: clientID,
		ReceivedAt: time.Now().UTC().Truncate(time.Microsecond), Revision: state.LastRevision}
	if record.Kind == "observation" {
		presentation := record.Text("presentation_id")
		row.PresentationID = &presentation
	}
	if err = tx.Create(&row).Error; err != nil {
		return nil, err
	}
	change := models.LearningEvidenceChange{UserID: state.UserID, Revision: state.LastRevision, Kind: record.Kind, RecordID: record.ID, Payload: record.Canonical}
	if err = tx.Create(&change).Error; err != nil {
		return nil, err
	}
	return nil, tx.Model(state).Update("last_revision", state.LastRevision).Error
}
func checkDependencies(tx *gorm.DB, user uuid.UUID, r Record) (*Rejection, error) {
	conflict := func(message string) (*Rejection, error) {
		return Reject(r.ID, "EVIDENCE_SET_CONFLICT", message, false), nil
	}
	switch r.Kind {
	case "plan":
		var prior models.LearningEvidenceRecord
		err := tx.Take(&prior, "user_id = ? AND kind = ? AND profile_id = ?", user, "plan", r.ProfileID).Error
		if err == nil {
			p, rejection := Validate(prior.Payload)
			if rejection != nil {
				return nil, fmt.Errorf("invalid stored profile")
			}
			if !equalJSON(p.Data["profile"], r.Data["profile"]) {
				return conflict("Profile ID is already associated with different conditions")
			}
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	case "exposure-open":
		if r.Text("source") == "coaching" || r.Text("source") == "screening" {
			plan, reject, err := dependency(tx, user, semantic("plan", r.SessionID), true, r.ID)
			if reject != nil || err != nil {
				return reject, err
			}
			if startsBefore(r.Data["started_at"], plan.Text("started_at")) {
				return conflict("Exposure precedes its plan")
			}
			if plan.Text("purpose") != r.Text("source") {
				return conflict("Exposure purpose differs from its plan")
			}
			for _, ch := range textSet(r.Data, "characters") {
				if !slices.Contains(textSet(plan.Data, "introduced_characters"), ch) {
					return conflict("Exposure is outside the taught set")
				}
			}
		}
		return nil, nil
	case "exposure-close":
		open, reject, err := dependency(tx, user, r.Text("open_id"), false, r.ID)
		if reject != nil || err != nil {
			return reject, err
		}
		if open.Kind != "exposure-open" {
			return conflict("Closure must reference an exposure-open")
		}
		ends := r.Data["last_exposure"].(map[string]any)
		chars := textSet(open.Data, "characters")
		if len(ends) != len(chars) {
			return conflict("Exposure closure character set differs")
		}
		for _, ch := range chars {
			end, exists := ends[ch]
			if !exists {
				return conflict("Exposure closure character set differs")
			}
			if end != nil && open.Data["started_at"] != nil {
				endTime, _ := time.Parse(time.RFC3339Nano, end.(map[string]any)["latest"].(string))
				startTime, _ := time.Parse(time.RFC3339Nano, open.Data["started_at"].(map[string]any)["earliest"].(string))
				if endTime.Before(startTime) {
					return conflict("Exposure cannot end before it starts")
				}
			}
		}
		return nil, nil
	case "observation", "terminal":
		plan, reject, err := dependency(tx, user, semantic("plan", r.SessionID), true, r.ID)
		if reject != nil || err != nil {
			return reject, err
		}
		if r.Kind == "observation" {
			var prior models.LearningEvidenceRecord
			err := tx.Take(&prior, "user_id = ? AND presentation_id = ?", user, r.Text("presentation_id")).Error
			if err == nil {
				return conflict("A first presentation already has a canonical observation")
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, err
			}
			if startsBefore(r.Data["first_presented_at"], plan.Text("started_at")) {
				return conflict("Observation precedes its plan")
			}
			_, err = lookup(tx, user, semantic("terminal", r.SessionID), true)
			if err == nil {
				return conflict("No observations may be appended after finalization")
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, err
			}
			var prompt map[string]any
			for _, p := range plan.Data["prompts"].([]any) {
				if p.(map[string]any)["id"] == r.Text("prompt_id") {
					prompt = p.(map[string]any)
					break
				}
			}
			if prompt == nil {
				return conflict("Observation prompt is outside the frozen plan")
			}
			for _, key := range []string{"char_wpm", "eff_wpm", "freq_hz"} {
				if r.Data[key] != plan.Data[key] {
					return conflict("Observation playback differs from the frozen plan")
				}
			}
			open, reject, err := dependency(tx, user, semantic("exposure-open", r.Text("presentation_id")), true, r.ID)
			if reject != nil || err != nil {
				return reject, err
			}
			if open.SessionID != r.SessionID || open.Text("source") != plan.Text("purpose") || !slices.Contains(textSet(open.Data, "characters"), prompt["character"].(string)) {
				return conflict("First presentation does not match the planned prompt")
			}
			if disjoint(r.Data["first_presented_at"], open.Data["started_at"]) {
				return conflict("Observation and exposure start bounds disagree")
			}
			if strictlyAfter(r.Data["prior_exposure"], r.Data["first_presented_at"]) {
				return conflict("Prior exposure cannot follow the first presentation")
			}
			if legacy := r.Text("legacy_attempt_id"); legacy != "" {
				var attempt models.TrainingEvent
				err = tx.Take(&attempt, "user_id = ? AND event_id = ?", user, legacy).Error
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return Reject(r.ID, "MISSING_EVIDENCE_DEPENDENCY", "Referenced attempt is unavailable", true), nil
				}
				if err != nil {
					return nil, err
				}
				if attempt.SessionID != r.SessionID || attempt.PromptID != r.Text("prompt_id") || attempt.TargetCharacter != prompt["character"] {
					return conflict("Referenced attempt differs from the planned prompt")
				}
			}
			return nil, nil
		}
		if end := r.Text("ended_at"); end != "" {
			a, _ := time.Parse(time.RFC3339Nano, end)
			b, _ := time.Parse(time.RFC3339Nano, plan.Text("started_at"))
			if a.Before(b) {
				return conflict("Terminal end precedes plan start")
			}
		}
		var observations []models.LearningEvidenceRecord
		if err := tx.Where("user_id = ? AND kind = ? AND session_id = ?", user, "observation", r.SessionID).Limit(101).Find(&observations).Error; err != nil {
			return nil, err
		}
		ids := textSet(r.Data, "observation_ids")
		for _, o := range observations {
			observed, rejection := Validate(o.Payload)
			if rejection != nil {
				return nil, fmt.Errorf("invalid stored observation")
			}
			if end := r.Text("ended_at"); end != "" && startsAfter(observed.Data["first_presented_at"], end) {
				return conflict("Observation follows the terminal end")
			}
			if !slices.Contains(ids, o.RecordID) {
				return conflict("Accepted observation is outside the terminal manifest")
			}
		}
		if len(observations) != len(ids) {
			return Reject(r.ID, "MISSING_EVIDENCE_DEPENDENCY", "Upload all manifest observations first", true), nil
		}
		if r.Text("status") == "completed" && len(ids) != len(plan.Data["prompts"].([]any)) {
			return conflict("Completed review requires all planned observations")
		}
		return nil, nil
	}
	return nil, fmt.Errorf("unsupported evidence kind")
}

func boundTime(value any, key string) time.Time {
	if value == nil {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339Nano, value.(map[string]any)[key].(string))
	return t
}
func startsBefore(value any, instant string) bool {
	t, _ := time.Parse(time.RFC3339Nano, instant)
	return value != nil && boundTime(value, "latest").Before(t)
}
func startsAfter(value any, instant string) bool {
	t, _ := time.Parse(time.RFC3339Nano, instant)
	return value != nil && boundTime(value, "earliest").After(t)
}
func strictlyAfter(first, second any) bool {
	return first != nil && second != nil && boundTime(first, "earliest").After(boundTime(second, "latest"))
}
func disjoint(first, second any) bool {
	return strictlyAfter(first, second) || strictlyAfter(second, first)
}
