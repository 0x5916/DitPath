package training

import (
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
)

func computeCharacterMasteries(events []models.TrainingEvent, now time.Time) []common.TrainingCharacterMasteryResponse {
	var accumulator MasteryAccumulator
	for _, event := range events {
		accumulator.Add(event)
	}
	return accumulator.Masteries(now)
}

// masteryEvent builds a scored attempt for mastery policy tests.
func masteryEvent(session, character, createdAt string, correct bool, latencyMS int) models.TrainingEvent {
	ts, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		panic(err)
	}
	classification := "incorrect"
	if correct {
		classification = "automatic"
	}
	return models.TrainingEvent{
		SessionID:       session,
		TargetCharacter: character,
		Classification:  classification,
		IsCorrect:       correct,
		LatencyMS:       latencyMS,
		ClientCreatedAt: ts,
	}
}

func TestComputeCharacterMasteriesEmpty(t *testing.T) {
	masteries := computeCharacterMasteries(nil, time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC))
	if len(masteries) != 0 {
		t.Fatalf("expected no masteries, got %+v", masteries)
	}
}

func TestComputeCharacterMasteriesRequiresTwoSessions(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

	// 12 flawless fast attempts, but all inside a single session.
	singleSession := make([]models.TrainingEvent, 0, 12)
	for i := 0; i < 12; i++ {
		singleSession = append(singleSession, masteryEvent("sess_1", "K", "2026-10-04T12:00:00Z", true, 1000))
	}

	masteries := computeCharacterMasteries(singleSession, now)
	if len(masteries) != 1 {
		t.Fatalf("expected 1 mastery row, got %d", len(masteries))
	}
	if masteries[0].Status != "learning" {
		t.Fatalf("single-session character must never be stable, got %q", masteries[0].Status)
	}

	// Split across two sessions: now the same attempts qualify as stable.
	multiSession := make([]models.TrainingEvent, 0, 12)
	for i := 0; i < 6; i++ {
		multiSession = append(multiSession, masteryEvent("sess_1", "K", "2026-10-04T12:00:00Z", true, 1000))
	}
	for i := 0; i < 6; i++ {
		multiSession = append(multiSession, masteryEvent("sess_2", "K", "2026-10-04T13:00:00Z", true, 1000))
	}

	masteries = computeCharacterMasteries(multiSession, now)
	if masteries[0].Status != "stable" {
		t.Fatalf("two-session flawless character should be stable, got %q", masteries[0].Status)
	}
	if masteries[0].RollingAccuracy != 1 {
		t.Fatalf("rolling accuracy = %v, want 1", masteries[0].RollingAccuracy)
	}
}

func TestComputeCharacterMasteriesReviewWhenOverdue(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

	events := make([]models.TrainingEvent, 0, 12)
	for i := 0; i < 6; i++ {
		events = append(events, masteryEvent("sess_1", "K", "2026-09-25T12:00:00Z", true, 1000))
	}
	for i := 0; i < 6; i++ {
		events = append(events, masteryEvent("sess_2", "K", "2026-09-25T13:00:00Z", true, 1000))
	}

	masteries := computeCharacterMasteries(events, now)
	if masteries[0].Status != "review" {
		t.Fatalf("character practised 10 days ago should be due for review, got %q", masteries[0].Status)
	}
}

func TestComputeCharacterMasteriesRollingWindow(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

	// 5 old failures followed by 20 flawless fast attempts; the rolling
	// window (20) must ignore the failures while TotalAttempts stays 25.
	events := make([]models.TrainingEvent, 0, 25)
	for i := 0; i < 5; i++ {
		events = append(events, masteryEvent("sess_1", "K", "2026-10-01T10:00:00Z", false, 4000))
	}
	for i := 0; i < 10; i++ {
		events = append(events, masteryEvent("sess_1", "K", "2026-10-04T10:00:00Z", true, 1000))
	}
	for i := 0; i < 10; i++ {
		events = append(events, masteryEvent("sess_2", "K", "2026-10-04T11:00:00Z", true, 1000))
	}

	masteries := computeCharacterMasteries(events, now)
	if len(masteries) != 1 {
		t.Fatalf("expected 1 mastery row, got %d", len(masteries))
	}
	if masteries[0].TotalAttempts != 25 {
		t.Fatalf("total attempts = %d, want 25", masteries[0].TotalAttempts)
	}
	if masteries[0].RollingAccuracy != 1 {
		t.Fatalf("rolling accuracy = %v, want 1 (old failures must be outside the window)", masteries[0].RollingAccuracy)
	}
	if masteries[0].Status != "stable" {
		t.Fatalf("status = %q, want stable", masteries[0].Status)
	}
}

func TestComputeCharacterMasteriesMedianRounding(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

	events := []models.TrainingEvent{
		masteryEvent("sess_1", "K", "2026-10-04T12:00:00Z", true, 1001),
		masteryEvent("sess_1", "K", "2026-10-04T12:01:00Z", true, 1002),
	}

	masteries := computeCharacterMasteries(events, now)
	if masteries[0].MedianLatencyMS == nil {
		t.Fatal("expected a median latency")
	}
	if *masteries[0].MedianLatencyMS != 1002 {
		t.Fatalf("median latency = %d, want 1002", *masteries[0].MedianLatencyMS)
	}
}

func TestComputeCharacterMasteriesExcludesUnmeasured(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

	event := masteryEvent("sess_1", "K", "2026-10-04T12:00:00Z", true, 1000)
	event.Classification = "unmeasured"

	masteries := computeCharacterMasteries([]models.TrainingEvent{event}, now)
	if len(masteries) != 0 {
		t.Fatalf("unmeasured attempts must not create mastery rows, got %+v", masteries)
	}
}
