package training

import (
	"math"
	"sort"
	"strings"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
)

// masteryPolicy mirrors the client's DEFAULT_MASTERY_POLICY
// (frontend/src/lib/training/v2/types.ts). Keep both definitions in sync.
var masteryPolicy = struct {
	minAttemptsForStability int
	minSessionsForStability int
	targetAccuracy          float64
	maxAutomaticLatencyMS   int
	reviewIntervalDays      int
	rollingWindowSize       int
}{
	minAttemptsForStability: 12,
	minSessionsForStability: 2,
	targetAccuracy:          0.9,
	maxAutomaticLatencyMS:   1500,
	reviewIntervalDays:      3,
	rollingWindowSize:       20,
}

// ComputeCharacterMasteries mirrors the client CharacterMastery reducer
// (frontend/src/lib/training/v2/mastery.ts) for the reduced snapshot shape:
// rolling window accuracy, median correct latency, and the two-session
// stability rule (a single session can never produce a stable character).
// The scored history in events must be chronological.
type characterHistory struct {
	total            int
	firstSession     string
	multipleSessions bool
	window           []models.TrainingEvent
}

// MasteryAccumulator retains only the rolling window and the facts needed from
// older attempts. Its memory follows distinct characters, never event count.
// Add must receive events in client_created_at,id order.
type MasteryAccumulator struct{ characters map[string]*characterHistory }

func (a *MasteryAccumulator) Add(event models.TrainingEvent) {
	if event.Classification == "unmeasured" {
		return
	}
	character := strings.ToUpper(strings.TrimSpace(event.TargetCharacter))
	if character == "" {
		return
	}
	if a.characters == nil {
		a.characters = make(map[string]*characterHistory)
	}
	history := a.characters[character]
	if history == nil {
		history = &characterHistory{firstSession: event.SessionID, window: make([]models.TrainingEvent, 0, masteryPolicy.rollingWindowSize)}
		a.characters[character] = history
	}
	history.total++
	history.multipleSessions = history.multipleSessions || event.SessionID != history.firstSession
	if len(history.window) == masteryPolicy.rollingWindowSize {
		copy(history.window, history.window[1:])
		history.window = history.window[:len(history.window)-1]
	}
	history.window = append(history.window, event)
}

func ComputeCharacterMasteries(events []models.TrainingEvent, now time.Time) []common.TrainingCharacterMasteryResponse {
	var accumulator MasteryAccumulator
	for _, event := range events {
		accumulator.Add(event)
	}
	return accumulator.Masteries(now)
}

func (a *MasteryAccumulator) Masteries(now time.Time) []common.TrainingCharacterMasteryResponse {
	characters := make([]string, 0, len(a.characters))
	for character := range a.characters {
		characters = append(characters, character)
	}
	sort.Strings(characters)

	masteries := make([]common.TrainingCharacterMasteryResponse, 0, len(characters))
	for _, character := range characters {
		// Events arrive ordered by client_created_at, so the window is the tail.
		history := a.characters[character]
		totalAttempts := history.total
		window := history.window

		correctInWindow := 0
		correctLatencies := make([]int, 0, len(window))
		for _, attempt := range window {
			if attempt.IsCorrect {
				correctInWindow++
				correctLatencies = append(correctLatencies, attempt.LatencyMS)
			}
		}

		rollingAccuracy := float64(correctInWindow) / float64(len(window))
		medianLatency := medianOfInts(correctLatencies)

		status := "learning"
		hasMinAttempts := totalAttempts >= masteryPolicy.minAttemptsForStability
		hasMultiSession := history.multipleSessions
		hasAccuracy := rollingAccuracy >= masteryPolicy.targetAccuracy
		hasAutomaticSpeed := medianLatency != nil && *medianLatency <= masteryPolicy.maxAutomaticLatencyMS

		if hasMinAttempts && hasMultiSession && hasAccuracy && hasAutomaticSpeed {
			lastPractisedAt := window[len(window)-1].ClientCreatedAt
			dueAt := lastPractisedAt.Add(time.Duration(masteryPolicy.reviewIntervalDays) * 24 * time.Hour)
			if !now.Before(dueAt) {
				status = "review"
			} else {
				status = "stable"
			}
		}

		masteries = append(masteries, common.TrainingCharacterMasteryResponse{
			Character:       character,
			Status:          status,
			RollingAccuracy: math.Round(rollingAccuracy*1000) / 1000,
			MedianLatencyMS: medianLatency,
			TotalAttempts:   totalAttempts,
		})
	}

	return masteries
}

// medianOfInts matches the client median helper: midpoint for even counts,
// rounded half away from zero. Returns nil when no samples exist.
func medianOfInts(values []int) *int {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]int(nil), values...)
	sort.Ints(sorted)

	mid := len(sorted) / 2
	if len(sorted)%2 == 1 {
		median := sorted[mid]
		return &median
	}
	median := int(math.Round(float64(sorted[mid-1]+sorted[mid]) / 2))
	return &median
}
