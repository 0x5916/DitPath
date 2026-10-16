package authlimits

import (
	"context"
	"errors"
	"net/netip"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testPolicy() Policy {
	return Policy{LoginLimit: 10, RegistrationLimit: 3, TotalLimit: 60, SourceLimit: 10_000, Window: time.Minute}
}

func testLimiter(t *testing.T, policy Policy, now func() time.Time) *Limiter {
	t.Helper()
	limiter, err := NewLimiter(policy, now)
	if err != nil {
		t.Fatal(err)
	}
	return limiter
}

func admit(t *testing.T, limiter *Limiter, source string, operation Operation) {
	t.Helper()
	if retry, err := limiter.Admit(context.Background(), netip.MustParseAddr(source), operation); err != nil || retry != 0 {
		t.Fatalf("admission: retry %v, error %v", retry, err)
	}
}

type observedCancellationContext struct {
	context.Context
	checked chan struct{}
	once    sync.Once
}

func (ctx *observedCancellationContext) Err() error {
	err := ctx.Context.Err()
	ctx.once.Do(func() { close(ctx.checked) })
	return err
}

func TestDefaultPolicyAndSharedLimiter(t *testing.T) {
	if got := DefaultPolicy(); got != testPolicy() {
		t.Fatalf("default policy = %+v", got)
	}
	if DefaultLimiter() != DefaultLimiter() {
		t.Fatal("default construction created independent quotas")
	}
}

func TestInvalidPolicies(t *testing.T) {
	for _, field := range []string{"login", "registration", "total", "sources", "window"} {
		t.Run(field, func(t *testing.T) {
			policy := testPolicy()
			switch field {
			case "login":
				policy.LoginLimit = 0
			case "registration":
				policy.RegistrationLimit = 0
			case "total":
				policy.TotalLimit = -1
			case "sources":
				policy.SourceLimit = 0
			case "window":
				policy.Window = 0
			}
			if _, err := NewLimiter(policy, time.Now); err == nil {
				t.Fatal("invalid policy accepted")
			}
		})
	}
}

func TestSourceEndpointQuotas(t *testing.T) {
	now := time.Now()
	limiter := testLimiter(t, testPolicy(), func() time.Time { return now })
	source := netip.MustParseAddr("192.0.2.1")
	for _, test := range []struct {
		name string
		op   Operation
		max  int
	}{{"login", Login, 10}, {"registration", Registration, 3}} {
		t.Run(test.name, func(t *testing.T) {
			for range test.max {
				admit(t, limiter, source.String(), test.op)
			}
			for range 2 {
				if retry, err := limiter.Admit(context.Background(), source, test.op); !errors.Is(err, ErrRateLimited) || retry != time.Minute {
					t.Fatalf("quota denial: retry %v, error %v", retry, err)
				}
			}
			admit(t, limiter, "192.0.2.2", test.op)
		})
	}
	if len(limiter.total) != 15 || len(limiter.sources) != 2 {
		t.Fatalf("denials changed state: total %d, sources %d", len(limiter.total), len(limiter.sources))
	}
}

func TestCombinedQuotaAcrossSourcesAndEndpoints(t *testing.T) {
	now := time.Now()
	limiter := testLimiter(t, testPolicy(), func() time.Time { return now })
	for i := range 60 {
		operation := Login
		if i%2 != 0 {
			operation = Registration
		}
		source := netip.AddrFrom4([4]byte{192, 0, 2, byte(i + 1)})
		admit(t, limiter, source.String(), operation)
	}
	for _, operation := range []Operation{Login, Registration} {
		if retry, err := limiter.Admit(context.Background(), netip.MustParseAddr("198.51.100.1"), operation); !errors.Is(err, ErrRateLimited) || retry != time.Minute {
			t.Fatalf("combined denial: retry %v, error %v", retry, err)
		}
	}
	if len(limiter.total) != 60 || len(limiter.sources) != 60 {
		t.Fatal("denied new source allocated or appended history")
	}
}

func TestRollingBoundaryAndDeniedRequestsDoNotExtendExpiry(t *testing.T) {
	base := time.Now()
	now := base
	policy := testPolicy()
	policy.LoginLimit = 1
	limiter := testLimiter(t, policy, func() time.Time { return now })
	source := netip.MustParseAddr("192.0.2.1")
	admit(t, limiter, source.String(), Login)
	now = base.Add(59*time.Second + 100*time.Millisecond)
	if retry, err := limiter.Admit(context.Background(), source, Login); !errors.Is(err, ErrRateLimited) || retry != 900*time.Millisecond {
		t.Fatalf("fractional retry: %v, %v", retry, err)
	}
	if len(limiter.total) != 1 || !limiter.total[0].Equal(base) {
		t.Fatal("denial extended expiry")
	}
	now = base.Add(time.Minute)
	admit(t, limiter, source.String(), Login)
	if len(limiter.total) != 1 || !limiter.total[0].Equal(now) {
		t.Fatal("exactly 60-second-old admission did not expire")
	}
}

func TestRetryWaitsForAllBlockingQuotas(t *testing.T) {
	base := time.Now()
	now := base
	policy := testPolicy()
	policy.LoginLimit, policy.TotalLimit = 2, 3
	limiter := testLimiter(t, policy, func() time.Time { return now })
	admit(t, limiter, "192.0.2.2", Registration)
	now = base.Add(10 * time.Second)
	admit(t, limiter, "192.0.2.1", Login)
	now = base.Add(20 * time.Second)
	admit(t, limiter, "192.0.2.1", Login)
	now = base.Add(30 * time.Second)
	if retry, err := limiter.Admit(context.Background(), netip.MustParseAddr("192.0.2.1"), Login); !errors.Is(err, ErrRateLimited) || retry != 40*time.Second {
		t.Fatalf("maximum blocking retry: %v, %v", retry, err)
	}
	if len(limiter.total) != 3 || len(limiter.sources[netip.MustParseAddr("192.0.2.1")].login) != 2 {
		t.Fatal("denial appended history")
	}
}

func TestSourceCapacityPreservesLiveRecordsAndRecoversAtExpiry(t *testing.T) {
	now := time.Now()
	policy := testPolicy()
	policy.SourceLimit = 2
	limiter := testLimiter(t, policy, func() time.Time { return now })
	admit(t, limiter, "192.0.2.1", Login)
	admit(t, limiter, "192.0.2.2", Registration)
	newSource := netip.MustParseAddr("192.0.2.3")
	if _, err := limiter.Admit(context.Background(), newSource, Login); !errors.Is(err, ErrCapacity) {
		t.Fatalf("new source at capacity: %v", err)
	}
	if len(limiter.sources) != 2 || len(limiter.total) != 2 || limiter.sources[newSource] != nil {
		t.Fatal("capacity denial allocated, appended, or evicted")
	}
	admit(t, limiter, "192.0.2.1", Registration)
	if len(limiter.sources[netip.MustParseAddr("192.0.2.1")].login) != 1 {
		t.Fatal("existing source lost active endpoint history")
	}
	now = now.Add(time.Minute)
	admit(t, limiter, newSource.String(), Login)
	if len(limiter.sources) != 1 || len(limiter.total) != 1 {
		t.Fatal("expiry did not reclaim source records")
	}
}

func TestQuotaDenialPrecedesSourceCapacity(t *testing.T) {
	now := time.Now()
	policy := testPolicy()
	policy.SourceLimit, policy.TotalLimit = 1, 1
	limiter := testLimiter(t, policy, func() time.Time { return now })
	admit(t, limiter, "192.0.2.1", Login)
	if _, err := limiter.Admit(context.Background(), netip.MustParseAddr("192.0.2.2"), Registration); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("global quota/full source store returned %v", err)
	}
	if len(limiter.sources) != 1 || len(limiter.total) != 1 {
		t.Fatal("denial mutated admissions")
	}
}

func TestConcurrentAdmissionsAreAtomic(t *testing.T) {
	for _, test := range []struct {
		name   string
		source bool
		max    int
	}{{"source", true, 10}, {"combined", false, 60}} {
		t.Run(test.name, func(t *testing.T) {
			now := time.Now()
			limiter := testLimiter(t, testPolicy(), func() time.Time { return now })
			var accepted atomic.Int32
			start := make(chan struct{})
			var pending sync.WaitGroup
			for i := range 100 {
				pending.Go(func() {
					<-start
					source := netip.AddrFrom4([4]byte{192, 0, 2, byte(i + 1)})
					if test.source {
						source = netip.MustParseAddr("192.0.2.1")
					}
					if _, err := limiter.Admit(context.Background(), source, Login); err == nil {
						accepted.Add(1)
					} else if !errors.Is(err, ErrRateLimited) {
						t.Errorf("unexpected refusal: %v", err)
					}
				})
			}
			close(start)
			pending.Wait()
			if got := accepted.Load(); got != int32(test.max) || len(limiter.total) != test.max {
				t.Fatalf("accepted %d, retained %d, want %d", got, len(limiter.total), test.max)
			}
		})
	}
}

func TestCancellationDoesNotConsumeQuota(t *testing.T) {
	now := time.Now()
	limiter := testLimiter(t, testPolicy(), func() time.Time { return now })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := limiter.Admit(ctx, netip.MustParseAddr("192.0.2.1"), Login); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled admission: %v", err)
	}
	if len(limiter.sources) != 0 || len(limiter.total) != 0 {
		t.Fatal("canceled request consumed quota")
	}
	ctx, cancel = context.WithCancel(context.Background())
	observed := &observedCancellationContext{Context: ctx, checked: make(chan struct{})}
	limiter.mu.Lock()
	result := make(chan error, 1)
	go func() {
		_, err := limiter.Admit(observed, netip.MustParseAddr("192.0.2.2"), Login)
		result <- err
	}()
	select {
	case <-observed.checked:
	case <-time.After(5 * time.Second):
		limiter.mu.Unlock()
		cancel()
		t.Fatal("admission did not check cancellation before mutex acquisition")
	}
	cancel()
	limiter.mu.Unlock()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation while mutex held: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled admission did not return")
	}
	if len(limiter.sources) != 0 || len(limiter.total) != 0 {
		t.Fatal("canceled mutex contender consumed quota")
	}
	ctx, cancel = context.WithCancel(context.Background())
	if _, err := limiter.Admit(ctx, netip.MustParseAddr("192.0.2.1"), Login); err != nil {
		t.Fatal(err)
	}
	cancel()
	if len(limiter.total) != 1 {
		t.Fatal("cancellation refunded admitted request")
	}
}

func TestProductionClockRetainsMonotonicTimestamps(t *testing.T) {
	limiter := testLimiter(t, testPolicy(), nil)
	stamp := limiter.now()
	if stamp == stamp.Round(0) {
		t.Fatal("production clock discarded monotonic elapsed time")
	}
	admit(t, limiter, "192.0.2.1", Login)
	if retained := limiter.total[0]; retained == retained.Round(0) {
		t.Fatal("admission storage converted monotonic timestamp to wall time")
	}
}

func TestLimiterCanonicalSourcesShareQuota(t *testing.T) {
	now := time.Now()
	policy := testPolicy()
	policy.LoginLimit = 1
	for _, test := range []struct{ first, alias string }{
		{"::ffff:192.0.2.1", "192.0.2.1"},
		{"fe80::1%en0", "fe80::1%en1"},
	} {
		t.Run(test.first, func(t *testing.T) {
			limiter := testLimiter(t, policy, func() time.Time { return now })
			admit(t, limiter, test.first, Login)
			if _, err := limiter.Admit(context.Background(), netip.MustParseAddr(test.alias), Login); !errors.Is(err, ErrRateLimited) {
				t.Fatalf("source alias obtained a new budget: %v", err)
			}
			if len(limiter.sources) != 1 || len(limiter.total) != 1 {
				t.Fatal("source alias allocated or charged additional history")
			}
		})
	}
}

func TestInvalidAdmissionDoesNotAllocateState(t *testing.T) {
	now := time.Now()
	limiter := testLimiter(t, testPolicy(), func() time.Time { return now })
	for _, source := range []netip.Addr{{}, netip.MustParseAddr("0.0.0.0"), netip.MustParseAddr("::"), netip.MustParseAddr("::ffff:0.0.0.0")} {
		if _, err := limiter.Admit(context.Background(), source, Login); !errors.Is(err, ErrInvalidSource) {
			t.Fatalf("invalid source %v admitted: %v", source, err)
		}
	}
	if _, err := limiter.Admit(context.Background(), netip.MustParseAddr("192.0.2.1"), Operation(99)); !errors.Is(err, ErrInvalidOperation) {
		t.Fatalf("invalid operation admitted: %v", err)
	}
	if len(limiter.sources) != 0 || len(limiter.total) != 0 {
		t.Fatal("invalid admission mutated quota state")
	}
}

func TestHistoriesAndBackingStorageRemainBounded(t *testing.T) {
	now := time.Now()
	policy := testPolicy()
	policy.LoginLimit, policy.RegistrationLimit, policy.TotalLimit = 2, 2, 4
	limiter := testLimiter(t, policy, func() time.Time { return now })
	for range 100 {
		for _, operation := range []Operation{Login, Registration} {
			admit(t, limiter, "192.0.2.1", operation)
		}
		history := limiter.sources[netip.MustParseAddr("192.0.2.1")]
		if len(history.login) > 2 || cap(history.login) > 4 || len(history.registration) > 2 || cap(history.registration) > 4 || len(limiter.total) > 4 || cap(limiter.total) > 8 {
			t.Fatal("retained histories or backing storage exceed bounded limits")
		}
		now = now.Add(30 * time.Second)
	}
}

func TestIsolatedProcessesAndRestartHaveIndependentQuotas(t *testing.T) {
	now := time.Now()
	policy := testPolicy()
	policy.LoginLimit = 1
	first := testLimiter(t, policy, func() time.Time { return now })
	second := testLimiter(t, policy, func() time.Time { return now })
	admit(t, first, "192.0.2.1", Login)
	admit(t, second, "192.0.2.1", Login)
	restarted := testLimiter(t, policy, func() time.Time { return now })
	admit(t, restarted, "192.0.2.1", Login)
	if _, err := first.Admit(context.Background(), netip.MustParseAddr("192.0.2.1"), Login); !errors.Is(err, ErrRateLimited) {
		t.Fatal("independent process altered first process quota")
	}
}
