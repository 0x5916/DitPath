package training

import (
	"math"
	"sort"
	"strings"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
)

// These thresholds mirror the client's DEFAULT_MASTERY_POLICY
// (frontend/src/lib/training/v2/types.ts). Keep both definitions in sync.
const (
	minAttemptsForStability = 12
	targetAccuracy          = 0.9
	maxAutomaticLatencyMS   = 1500
	reviewInterval          = 3 * 24 * time.Hour
	rollingWindowSize       = 20
)

type characterHistory struct {
	totalAttempts    int
	firstSessionID   string
	multipleSessions bool
	window           []models.TrainingEvent
}

// MasteryAccumulator retains only the rolling window and the facts needed from
// older attempts. Its memory follows distinct characters, never event count.
type MasteryAccumulator struct{ characters map[string]*characterHistory }

// Add requires events in client_created_at,id order.
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
		history = &characterHistory{
			firstSessionID: event.SessionID,
			window:         make([]models.TrainingEvent, 0, rollingWindowSize),
		}
		a.characters[character] = history
	}
	history.totalAttempts++
	history.multipleSessions = history.multipleSessions || event.SessionID != history.firstSessionID
	if len(history.window) == rollingWindowSize {
		copy(history.window, history.window[1:])
		history.window = history.window[:len(history.window)-1]
	}
	history.window = append(history.window, event)
}

// Masteries returns summaries sorted by normalized character.
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
		hasMinAttempts := history.totalAttempts >= minAttemptsForStability
		hasAccuracy := rollingAccuracy >= targetAccuracy
		hasAutomaticSpeed := medianLatency != nil && *medianLatency <= maxAutomaticLatencyMS

		if hasMinAttempts && history.multipleSessions && hasAccuracy && hasAutomaticSpeed {
			lastPractisedAt := window[len(window)-1].ClientCreatedAt
			dueAt := lastPractisedAt.Add(reviewInterval)
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
			TotalAttempts:   history.totalAttempts,
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
