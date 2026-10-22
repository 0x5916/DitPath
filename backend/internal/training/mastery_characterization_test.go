package training

import (
	"encoding/json"
	"testing"
	"time"

	"opencw/internal/models"
)

func TestMasteryPolicyCharacterization(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name           string
		attempts       int
		correct        int
		twoSessions    bool
		latencyMS      int
		lastAttemptAge time.Duration
		want           string
	}{
		{"eleven attempts", 11, 11, true, 1000, time.Hour, `[{"character":"T","status":"learning","rolling_accuracy":1,"median_latency_ms":1000,"total_attempts":11}]`},
		{"twelve attempts", 12, 12, true, 1000, time.Hour, `[{"character":"T","status":"stable","rolling_accuracy":1,"median_latency_ms":1000,"total_attempts":12}]`},
		{"single session", 12, 12, false, 1000, time.Hour, `[{"character":"T","status":"learning","rolling_accuracy":1,"median_latency_ms":1000,"total_attempts":12}]`},
		{"seventeen correct", 20, 17, true, 1000, time.Hour, `[{"character":"T","status":"learning","rolling_accuracy":0.85,"median_latency_ms":1000,"total_attempts":20}]`},
		{"eighteen correct", 20, 18, true, 1000, time.Hour, `[{"character":"T","status":"stable","rolling_accuracy":0.9,"median_latency_ms":1000,"total_attempts":20}]`},
		{"latency at threshold", 12, 12, true, 1500, time.Hour, `[{"character":"T","status":"stable","rolling_accuracy":1,"median_latency_ms":1500,"total_attempts":12}]`},
		{"latency above threshold", 12, 12, true, 1501, time.Hour, `[{"character":"T","status":"learning","rolling_accuracy":1,"median_latency_ms":1501,"total_attempts":12}]`},
		{"review at deadline", 12, 12, true, 1000, 72 * time.Hour, `[{"character":"T","status":"review","rolling_accuracy":1,"median_latency_ms":1000,"total_attempts":12}]`},
		{"before review deadline", 12, 12, true, 1000, 72*time.Hour - time.Nanosecond, `[{"character":"T","status":"stable","rolling_accuracy":1,"median_latency_ms":1000,"total_attempts":12}]`},
		{"no correct latency", 12, 0, true, 1000, time.Hour, `[{"character":"T","status":"learning","rolling_accuracy":0,"median_latency_ms":null,"total_attempts":12}]`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			events := make([]models.TrainingEvent, tt.attempts)
			for i := range events {
				session := "first"
				if tt.twoSessions && i%2 == 1 {
					session = "second"
				}
				classification := "incorrect"
				if i < tt.correct {
					classification = "automatic"
				}
				events[i] = models.TrainingEvent{
					TargetCharacter: "T", SessionID: session, Classification: classification,
					IsCorrect: i < tt.correct, LatencyMS: tt.latencyMS, ClientCreatedAt: now.Add(-tt.lastAttemptAge),
				}
			}
			assertMasteryJSON(t, events, now, tt.want)
		})
	}
}

func TestEmptyMasteryCharacterization(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name   string
		events []models.TrainingEvent
	}{
		{"nil events", nil},
		{"empty events", []models.TrainingEvent{}},
		{"unmeasured event", []models.TrainingEvent{{TargetCharacter: "T", Classification: "unmeasured"}}},
		{"blank target", []models.TrainingEvent{{TargetCharacter: " \t ", Classification: "incorrect"}}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assertMasteryJSON(t, tt.events, now, `[]`)
		})
	}
}

func TestNormalizedSortedMasteryCharacterization(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	events := []models.TrainingEvent{
		{TargetCharacter: " t ", Classification: "automatic", IsCorrect: true, LatencyMS: 1001},
		{TargetCharacter: " a ", Classification: "incorrect", LatencyMS: 2000},
		{TargetCharacter: "T", Classification: "automatic", IsCorrect: true, LatencyMS: 1002},
		{TargetCharacter: "e", Classification: "automatic", IsCorrect: true, LatencyMS: 900},
	}
	assertMasteryJSON(t, events, now, `[{"character":"A","status":"learning","rolling_accuracy":0,"median_latency_ms":null,"total_attempts":1},{"character":"E","status":"learning","rolling_accuracy":1,"median_latency_ms":900,"total_attempts":1},{"character":"T","status":"learning","rolling_accuracy":1,"median_latency_ms":1002,"total_attempts":2}]`)
}

func assertMasteryJSON(t *testing.T, events []models.TrainingEvent, now time.Time, want string) {
	t.Helper()
	got, err := json.Marshal(computeCharacterMasteries(events, now))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Fatalf("mastery JSON:\n got %s\nwant %s", got, want)
	}
}
