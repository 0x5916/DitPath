// Package authlimits owns bounded public-auth admission and source attribution.
package authlimits

import (
	"context"
	"errors"
	"net/netip"
	"sync"
	"time"
)

const (
	LoginLimit        = 10
	RegistrationLimit = 3
	TotalLimit        = 60
	SourceLimit       = 10000
	Window            = time.Minute
)

type Operation uint8

const (
	Login Operation = iota
	Registration
)

var (
	ErrRateLimited      = errors.New("authentication request quota exhausted")
	ErrCapacity         = errors.New("authentication source store full")
	ErrInvalidSource    = errors.New("invalid authentication source")
	ErrInvalidOperation = errors.New("invalid authentication operation")
)

type Policy struct {
	LoginLimit, RegistrationLimit, TotalLimit, SourceLimit int
	Window                                                 time.Duration
}

func DefaultPolicy() Policy {
	return Policy{LoginLimit, RegistrationLimit, TotalLimit, SourceLimit, Window}
}

type history struct{ login, registration []time.Time }

type Limiter struct {
	mu      sync.Mutex
	policy  Policy
	now     func() time.Time
	sources map[netip.Addr]*history
	total   []time.Time
}

func NewLimiter(policy Policy, now func() time.Time) (*Limiter, error) {
	if policy.LoginLimit <= 0 || policy.RegistrationLimit <= 0 || policy.TotalLimit <= 0 || policy.SourceLimit <= 0 || policy.Window <= 0 {
		return nil, errors.New("authentication limits must be positive")
	}
	if now == nil {
		now = time.Now // retain monotonic timestamps; never convert them to wall time
	}
	return &Limiter{policy: policy, now: now, sources: make(map[netip.Addr]*history), total: make([]time.Time, 0, policy.TotalLimit)}, nil
}

var defaultLimiter = func() *Limiter {
	limiter, err := NewLimiter(DefaultPolicy(), nil)
	if err != nil {
		panic(err)
	}
	return limiter
}()

func DefaultLimiter() *Limiter { return defaultLimiter }

// prune compacts in place; queue capacity stays bounded across window turnover.
func prune(times []time.Time, cutoff time.Time) []time.Time {
	first := 0
	for first < len(times) && !times[first].After(cutoff) {
		first++
	}
	copy(times, times[first:])
	return times[:len(times)-first]
}

// Admit atomically charges the source/endpoint and process quotas, or neither.
func (l *Limiter) Admit(ctx context.Context, source netip.Addr, operation Operation) (time.Duration, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	source = source.Unmap().WithZone("")
	if !source.IsValid() || source.IsUnspecified() {
		return 0, ErrInvalidSource
	}
	if operation != Login && operation != Registration {
		return 0, ErrInvalidOperation
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	now := l.now()
	cutoff := now.Add(-l.policy.Window)
	l.total = prune(l.total, cutoff)
	for key, entry := range l.sources {
		entry.login = prune(entry.login, cutoff)
		entry.registration = prune(entry.registration, cutoff)
		if len(entry.login)+len(entry.registration) == 0 {
			delete(l.sources, key)
		}
	}
	entry := l.sources[source]
	limit := l.policy.LoginLimit
	var attempts []time.Time
	if operation == Registration {
		limit = l.policy.RegistrationLimit
	}
	if entry != nil {
		attempts = entry.login
		if operation == Registration {
			attempts = entry.registration
		}
	}
	var retry time.Duration
	if len(attempts) >= limit {
		retry = attempts[0].Add(l.policy.Window).Sub(now)
	}
	if len(l.total) >= l.policy.TotalLimit {
		if global := l.total[0].Add(l.policy.Window).Sub(now); global > retry {
			retry = global
		}
	}
	if retry > 0 {
		return retry, ErrRateLimited
	}
	if entry == nil {
		if len(l.sources) >= l.policy.SourceLimit {
			return 0, ErrCapacity
		}
		entry = &history{login: make([]time.Time, 0, l.policy.LoginLimit), registration: make([]time.Time, 0, l.policy.RegistrationLimit)}
		l.sources[source] = entry
	}
	if operation == Login {
		entry.login = append(entry.login, now)
	} else {
		entry.registration = append(entry.registration, now)
	}
	l.total = append(l.total, now)
	return 0, nil
}
