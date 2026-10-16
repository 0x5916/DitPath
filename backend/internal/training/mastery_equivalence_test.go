package training

import (
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"
)

// Compare the streaming state to the former complete-history batch algorithm,
// retained below as an independent grouping/windowing reference.
func TestStreamingMasteryMatchesFormerBatchReducer(t *testing.T) {
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	targets := []string{" t ", "e", "A", "N", "", "  ", "語"}
	events := make([]models.TrainingEvent, 7000)
	var accumulator MasteryAccumulator
	for i := range events {
		classification := "automatic"
		if i%13 == 0 {
			classification = "unmeasured"
		}
		events[i] = models.TrainingEvent{TargetCharacter: targets[i%len(targets)], Classification: classification,
			SessionID: fmt.Sprintf("session-%d", i/23), IsCorrect: i%11 != 0, LatencyMS: 1200 + i%601,
			ClientCreatedAt: now.Add(-72 * time.Hour).Add(time.Duration(i) * time.Second)}
		accumulator.Add(events[i])
	}
	for _, offset := range []time.Duration{0, time.Hour, 72 * time.Hour} {
		t.Run(offset.String(), func(t *testing.T) {
			at := now.Add(offset)
			want := batchMasteryReference(events, at)
			got := accumulator.Masteries(at)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("streamed mastery differs from batch: got=%+v want=%+v", got, want)
			}
		})
	}
}

func batchMasteryReference(events []models.TrainingEvent, now time.Time) []common.TrainingCharacterMasteryResponse {
	byCharacter := make(map[string][]models.TrainingEvent)
	for _, event := range events {
		if event.Classification == "unmeasured" {
			continue
		}
		character := strings.ToUpper(strings.TrimSpace(event.TargetCharacter))
		if character == "" {
			continue
		}
		byCharacter[character] = append(byCharacter[character], event)
	}

	characters := make([]string, 0, len(byCharacter))
	for character := range byCharacter {
		characters = append(characters, character)
	}
	sort.Strings(characters)

	masteries := make([]common.TrainingCharacterMasteryResponse, 0, len(characters))
	for _, character := range characters {
		// Events arrive ordered by client_created_at, so the window is the tail.
		attempts := byCharacter[character]
		totalAttempts := len(attempts)

		sessions := make(map[string]struct{})
		for _, attempt := range attempts {
			sessions[attempt.SessionID] = struct{}{}
		}

		windowStart := totalAttempts - masteryPolicy.rollingWindowSize
		if windowStart < 0 {
			windowStart = 0
		}
		window := attempts[windowStart:]

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
		hasMultiSession := len(sessions) >= masteryPolicy.minSessionsForStability
		hasAccuracy := rollingAccuracy >= masteryPolicy.targetAccuracy
		hasAutomaticSpeed := medianLatency != nil && *medianLatency <= masteryPolicy.maxAutomaticLatencyMS

		if hasMinAttempts && hasMultiSession && hasAccuracy && hasAutomaticSpeed {
			lastPractisedAt := attempts[totalAttempts-1].ClientCreatedAt
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
