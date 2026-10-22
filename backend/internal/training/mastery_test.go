package training

import (
	"opencw/internal/models"
	"reflect"
	"testing"
	"time"
)

func TestMasteryAccumulatorRetainsOnlyRollingWindow(t *testing.T) {
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	var accumulator MasteryAccumulator
	for i := 0; i < 100000; i++ {
		session := "first"
		if i > 0 {
			session = "second"
		}
		accumulator.Add(models.TrainingEvent{SessionID: session, TargetCharacter: " t ", Classification: "automatic", IsCorrect: true, LatencyMS: 1000, ClientCreatedAt: now.Add(time.Duration(i) * time.Millisecond)})
	}
	history := accumulator.characters["T"]
	if len(history.window) != 20 || cap(history.window) != 20 || history.totalAttempts != 100000 || !history.multipleSessions {
		t.Fatalf("unexpected retained history: size=%d cap=%d total=%d", len(history.window), cap(history.window), history.totalAttempts)
	}
	result := accumulator.Masteries(now)
	if len(result) != 1 || result[0].TotalAttempts != 100000 || result[0].Status != "stable" || result[0].RollingAccuracy != 1 {
		t.Fatalf("lost all-history facts: %+v", result)
	}
	if !reflect.DeepEqual(result, accumulator.Masteries(now)) {
		t.Fatal("read mutated state")
	}
}
func TestMasteryAccumulatorPreservesOldSessionAndWindowSemantics(t *testing.T) {
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	var accumulator MasteryAccumulator
	for i := 0; i < 42; i++ {
		session := "old"
		if i > 0 {
			session = "new"
		}
		accumulator.Add(models.TrainingEvent{SessionID: session, TargetCharacter: "E", Classification: "automatic", IsCorrect: i >= 22, LatencyMS: 1500, ClientCreatedAt: now})
	}
	result := accumulator.Masteries(now.Add(72 * time.Hour))
	if len(result) != 1 || result[0].Status != "review" || result[0].RollingAccuracy != 1 || result[0].TotalAttempts != 42 {
		t.Fatalf("unexpected mastery: %+v", result)
	}
	accumulator.Add(models.TrainingEvent{TargetCharacter: "T", Classification: "unmeasured"})
	accumulator.Add(models.TrainingEvent{TargetCharacter: " ", Classification: "incorrect"})
	if len(accumulator.characters) != 1 {
		t.Fatal("unscored event retained")
	}
}
