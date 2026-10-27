package learning

import (
	"sort"
	"time"
)

type ExposureFact struct {
	ID             string
	PresentationID string
	Characters     []string
	StartedAt      *TimeBounds
	CloseID        string
	EndReason      string
	LastExposure   map[string]*TimeBounds
}
type exposurePrefix struct {
	start          int64
	best           [2]*ExposureFact
	unknown        int
	unknownWitness [2]*ExposureFact
}
type ExposureIndex struct {
	byCharacter    map[string][]exposurePrefix
	byPresentation map[string]*ExposureFact
}

func exposureStart(fact *ExposureFact) int64 {
	if !validBounds(fact.StartedAt) {
		return -1 << 63
	}
	return ms(fact.StartedAt.Earliest)
}
func exposureEnd(fact *ExposureFact, character string) *TimeBounds {
	if fact.CloseID == "" {
		return nil
	}
	return fact.LastExposure[character]
}
func betterExposure(first, second *ExposureFact, character string) bool {
	if second == nil {
		return true
	}
	a, b := exposureEnd(first, character), exposureEnd(second, character)
	if ms(a.Latest) == ms(b.Latest) {
		return first.ID < second.ID
	}
	return ms(a.Latest) > ms(b.Latest)
}

// Prefix maxima make all first-probe gap queries O(log N), excluding their own action.
func NewExposureIndex(facts []*ExposureFact) *ExposureIndex {
	index := &ExposureIndex{byCharacter: map[string][]exposurePrefix{}, byPresentation: map[string]*ExposureFact{}}
	grouped := map[string][]*ExposureFact{}
	for _, fact := range facts {
		index.byPresentation[fact.PresentationID] = fact
		for _, ch := range fact.Characters {
			grouped[ch] = append(grouped[ch], fact)
		}
	}
	for ch, entries := range grouped {
		sort.Slice(entries, func(a, b int) bool {
			left, right := exposureStart(entries[a]), exposureStart(entries[b])
			if left == right {
				return entries[a].ID < entries[b].ID
			}
			return left < right
		})
		state := exposurePrefix{}
		for _, fact := range entries {
			state.start = exposureStart(fact)
			if !validBounds(exposureEnd(fact, ch)) {
				state.unknown++
				if state.unknownWitness[0] == nil {
					state.unknownWitness[0] = fact
				} else if state.unknownWitness[1] == nil {
					state.unknownWitness[1] = fact
				}
			} else if betterExposure(fact, state.best[0], ch) {
				state.best[1] = state.best[0]
				state.best[0] = fact
			} else if betterExposure(fact, state.best[1], ch) {
				state.best[1] = fact
			}
			index.byCharacter[ch] = append(index.byCharacter[ch], state)
		}
	}
	return index
}
func factIDs(fact *ExposureFact) []string {
	if fact == nil {
		return []string{}
	}
	ids := []string{fact.ID}
	if fact.CloseID != "" {
		ids = append(ids, fact.CloseID)
	}
	return ids
}

// Unknown ends remain unknown; no client-submitted prior-exposure snapshot is trusted.
func (index *ExposureIndex) Prior(character, presentation string, first *TimeBounds) (*TimeBounds, []string, bool) {
	if !validBounds(first) {
		return nil, []string{}, true
	}
	entries := index.byCharacter[character]
	limit := ms(first.Latest)
	count := sort.Search(len(entries), func(i int) bool { return entries[i].start > limit })
	if count == 0 {
		return nil, []string{}, false
	}
	state := entries[count-1]
	own := index.byPresentation[presentation]
	if own != nil && exposureStart(own) <= limit && !validBounds(exposureEnd(own, character)) {
		state.unknown--
	}
	if state.unknown > 0 {
		witness := state.unknownWitness[0]
		if witness != nil && witness.PresentationID == presentation {
			witness = state.unknownWitness[1]
		}
		return nil, factIDs(witness), true
	}
	best := state.best[0]
	if best != nil && best.PresentationID == presentation {
		best = state.best[1]
	}
	if best == nil {
		return nil, []string{}, false
	}
	return exposureEnd(best, character), factIDs(best), false
}
func domainBounds(value any) *TimeBounds {
	data, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	earliest, a := data["earliest"].(string)
	latest, b := data["latest"].(string)
	source, c := data["source"].(string)
	if !a || !b || !c {
		return nil
	}
	first, errA := time.Parse(time.RFC3339Nano, earliest)
	last, errB := time.Parse(time.RFC3339Nano, latest)
	if errA != nil || errB != nil {
		return nil
	}
	upper := last.UnixMilli()
	if last.Nanosecond()%int(time.Millisecond) != 0 {
		upper++
	}
	return &TimeBounds{Source: source, Earliest: iso(first.UnixMilli()), Latest: iso(upper)}
}
