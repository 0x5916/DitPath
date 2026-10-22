package utils

import (
	"context"
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alexedwards/argon2id"
)

func passwordResult[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case result := <-ch:
		return result
	case <-time.After(5 * time.Second):
		t.Fatal("password worker did not complete")
		var zero T
		return zero
	}
}

func passwordWork(t *testing.T, limit int, hash func(string) (string, error), compare func(string, string) (bool, error)) *PasswordWork {
	t.Helper()
	w, err := NewPasswordWork(limit, hash, compare)
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func passwordReservation(t *testing.T, w *PasswordWork, ctx context.Context) *PasswordReservation {
	t.Helper()
	r, err := w.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Close)
	return r
}

func TestNewPasswordWorkRejectsNonpositiveCapacity(t *testing.T) {
	for _, limit := range []int{0, -1} {
		w, err := NewPasswordWork(limit, nil, nil)
		if w != nil || err == nil {
			t.Fatalf("capacity %d: got work=%v, error=%v", limit, w, err)
		}
	}
}

func TestPasswordWorkImmediateCapacityAndPeak(t *testing.T) {
	var active, peak atomic.Int32
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	worker := func() {
		n := active.Add(1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		started <- struct{}{}
		<-release
		active.Add(-1)
	}
	w := passwordWork(t, 2, func(string) (string, error) { worker(); return "hash", nil }, func(string, string) (bool, error) { worker(); return true, nil })
	first := passwordReservation(t, w, context.Background())
	second := passwordReservation(t, w, context.Background())
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)
	done := make(chan error, 2)
	go func() { _, err := first.Hash("password"); done <- err }()
	go func() { _, err := second.Compare("password", "hash"); done <- err }()
	passwordResult(t, started)
	passwordResult(t, started)
	denials := make(chan error, 50)
	for range 50 {
		go func() {
			r, err := w.Acquire(context.Background())
			if r != nil {
				r.Close()
			}
			denials <- err
		}()
	}
	for range 50 {
		if err := passwordResult(t, denials); !errors.Is(err, ErrPasswordCapacity) {
			t.Fatalf("contender got %v", err)
		}
	}
	if active.Load() != 2 || peak.Load() != 2 {
		t.Fatalf("active=%d, peak=%d; want both 2", active.Load(), peak.Load())
	}
	t.Logf("50 contenders refused before either worker returned; peak active work=%d", peak.Load())
	unblock()
	for range 2 {
		if err := passwordResult(t, done); err != nil {
			t.Fatal(err)
		}
	}
	first.Close()
	second.Close()
	passwordReservation(t, w, context.Background())
}

func TestPasswordWorkCanceledAdmissionAndWork(t *testing.T) {
	var calls int
	w := passwordWork(t, 1, func(string) (string, error) { calls++; return "hash", nil }, func(string, string) (bool, error) { calls++; return true, nil })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if r, err := w.Acquire(ctx); r != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled admission: reservation=%v, error=%v", r, err)
	}
	ctx, cancel = context.WithCancel(context.Background())
	r := passwordReservation(t, w, ctx)
	cancel()
	if _, err := r.Hash("password"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := r.Compare("password", "hash"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatalf("canceled reservation started %d workers", calls)
	}
}

func TestPasswordReservationCancellationRetainsCapacityAndCloseWaits(t *testing.T) {
	for _, operation := range []string{"hash", "compare"} {
		t.Run(operation, func(t *testing.T) {
			started, release := make(chan struct{}), make(chan struct{})
			worker := func() { close(started); <-release }
			w := passwordWork(t, 1, func(string) (string, error) { worker(); return "hash", nil }, func(string, string) (bool, error) { worker(); return true, nil })
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			r := passwordReservation(t, w, ctx)
			alias := *r
			unblock := sync.OnceFunc(func() { close(release) })
			t.Cleanup(unblock)
			done := make(chan error, 1)
			go func() {
				var err error
				if operation == "hash" {
					_, err = r.Hash("password")
				} else {
					_, err = r.Compare("password", "hash")
				}
				done <- err
			}()
			passwordResult(t, started)
			cancel()
			closed := make(chan struct{})
			go func() { alias.Close(); close(closed) }()
			if next, err := w.Acquire(context.Background()); next != nil || !errors.Is(err, ErrPasswordCapacity) {
				t.Fatalf("active canceled work released capacity: reservation=%v, error=%v", next, err)
			}
			select {
			case <-closed:
				t.Fatal("Close returned while password worker remained active")
			case <-time.After(20 * time.Millisecond):
			}
			unblock()
			if err := passwordResult(t, done); !errors.Is(err, context.Canceled) {
				t.Fatalf("finished canceled worker returned %v", err)
			}
			passwordResult(t, closed)
			passwordReservation(t, w, context.Background())
		})
	}
}

func TestPasswordReservationCopiedAliasSerializesWorkAndRechecksCancellation(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var comparisons atomic.Int32
	w := passwordWork(t, 1, func(string) (string, error) { close(started); <-release; return "hash", nil }, func(string, string) (bool, error) { comparisons.Add(1); return true, nil })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := passwordReservation(t, w, ctx)
	alias := *r
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)
	hashDone, compareDone := make(chan error, 1), make(chan error, 1)
	go func() { _, err := r.Hash("password"); hashDone <- err }()
	passwordResult(t, started)
	attempted := make(chan struct{})
	go func() { close(attempted); _, err := alias.Compare("password", "hash"); compareDone <- err }()
	passwordResult(t, attempted)
	select {
	case <-compareDone:
		t.Fatal("another operation ran before the first worker returned")
	case <-time.After(20 * time.Millisecond):
	}
	cancel()
	unblock()
	for _, done := range []chan error{hashDone, compareDone} {
		if err := passwordResult(t, done); !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	}
	if comparisons.Load() != 0 {
		t.Fatal("cancellation was not rechecked after acquiring the worker lock")
	}
}

func TestPasswordReservationCompareThenHashAndIdempotentClose(t *testing.T) {
	var operations []string
	w := passwordWork(t, 2, func(string) (string, error) { operations = append(operations, "hash"); return "replacement", nil }, func(string, string) (bool, error) { operations = append(operations, "compare"); return true, nil })
	r := passwordReservation(t, w, context.Background())
	passwordReservation(t, w, context.Background())
	if match, err := r.Compare("old", "stored"); !match || err != nil {
		t.Fatalf("compare: match=%v, error=%v", match, err)
	}
	if hash, err := r.Hash("new"); hash != "replacement" || err != nil {
		t.Fatalf("hash: hash=%q, error=%v", hash, err)
	}
	if len(operations) != 2 || operations[0] != "compare" || operations[1] != "hash" {
		t.Fatalf("operation order=%v", operations)
	}
	r.Close()
	r.Close()
	if _, err := r.Hash("new"); !errors.Is(err, ErrPasswordReservationClosed) {
		t.Fatal(err)
	}
	if _, err := r.Compare("old", "stored"); !errors.Is(err, ErrPasswordReservationClosed) {
		t.Fatal(err)
	}
	passwordReservation(t, w, context.Background())
	if next, err := w.Acquire(context.Background()); next != nil || !errors.Is(err, ErrPasswordCapacity) {
		t.Fatalf("double close over-released capacity: reservation=%v, error=%v", next, err)
	}
	if len(operations) != 2 {
		t.Fatalf("closed reservation ran workers: %v", operations)
	}
}

func TestPasswordReservationCopiedAliasSharesClose(t *testing.T) {
	var calls int
	w := passwordWork(t, 2, func(string) (string, error) { calls++; return "hash", nil }, func(string, string) (bool, error) { calls++; return true, nil })
	r := passwordReservation(t, w, context.Background())
	alias := *r
	r.Close()
	passwordReservation(t, w, context.Background())
	passwordReservation(t, w, context.Background())
	if _, err := alias.Hash("password"); !errors.Is(err, ErrPasswordReservationClosed) {
		t.Errorf("copied alias hash returned %v after original closed", err)
	}
	if _, err := alias.Compare("password", "hash"); !errors.Is(err, ErrPasswordReservationClosed) {
		t.Errorf("copied alias comparison returned %v after original closed", err)
	}
	if calls != 0 {
		t.Errorf("copied closed alias ran %d workers", calls)
	}
	if t.Failed() {
		return // Do not let a broken alias drain another reservation's permit.
	}
	alias.Close()
	if next, err := w.Acquire(context.Background()); next != nil || !errors.Is(err, ErrPasswordCapacity) {
		// Keep an unexpected admission occupied so sibling cleanup retains its two slots.
		t.Errorf("copied alias freed sibling capacity: reservation=%v, error=%v", next, err)
	}
}

func TestPasswordReservationWithoutAdmissionRefusesWork(t *testing.T) {
	for _, r := range []*PasswordReservation{nil, {}} {
		if _, err := r.Hash("password"); !errors.Is(err, ErrPasswordReservationClosed) {
			t.Fatal(err)
		}
		if _, err := r.Compare("password", "hash"); !errors.Is(err, ErrPasswordReservationClosed) {
			t.Fatal(err)
		}
		r.Close()
		r.Close()
	}
}

func TestPasswordReservationErrorsAndPanicsReleaseOnUnwind(t *testing.T) {
	failure := errors.New("worker failed")
	for _, operation := range []string{"hash", "compare"} {
		for _, panics := range []bool{false, true} {
			name := operation + "/error"
			if panics {
				name = operation + "/panic"
			}
			t.Run(name, func(t *testing.T) {
				worker := func() {
					if panics {
						panic(failure)
					}
				}
				w := passwordWork(t, 1, func(string) (string, error) { worker(); return "", failure }, func(string, string) (bool, error) { worker(); return false, failure })
				var result error
				var recovered any
				func() {
					defer func() { recovered = recover() }()
					r := passwordReservation(t, w, context.Background())
					defer r.Close()
					if operation == "hash" {
						_, result = r.Hash("password")
					} else {
						_, result = r.Compare("password", "hash")
					}
				}()
				if panics && recovered != failure || !panics && !errors.Is(result, failure) {
					t.Fatalf("error=%v, panic=%v", result, recovered)
				}
				passwordReservation(t, w, context.Background())
			})
		}
	}
}

func TestDefaultPasswordWorkSharesReservationCapacity(t *testing.T) {
	w := DefaultPasswordWork()
	if w != DefaultPasswordWork() || DefaultPasswordConcurrency != 2 {
		t.Fatal("production service is not one shared two-slot instance")
	}
	first := passwordReservation(t, w, context.Background())
	passwordReservation(t, DefaultPasswordWork(), context.Background())
	for range 2 {
		if reservation, err := DefaultPasswordWork().Acquire(context.Background()); reservation != nil || !errors.Is(err, ErrPasswordCapacity) {
			t.Fatalf("full default service: reservation=%v, error=%v", reservation, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if reservation, err := DefaultPasswordWork().Acquire(ctx); reservation != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled admission to full service: reservation=%v, error=%v", reservation, err)
	}
	first.Close()
	passwordReservation(t, DefaultPasswordWork(), context.Background())
	first.Close()
	if reservation, err := DefaultPasswordWork().Acquire(context.Background()); reservation != nil || !errors.Is(err, ErrPasswordCapacity) {
		t.Fatalf("closing an old reservation released active capacity: reservation=%v, error=%v", reservation, err)
	}
}

func TestPasswordArgon2RoundTripAndStoredParameters(t *testing.T) {
	w := passwordWork(t, 1, nil, nil)
	r := passwordReservation(t, w, context.Background())
	hash, err := r.Hash("round-trip password")
	if err != nil {
		t.Fatal(err)
	}
	actual, salt, key, err := argon2id.DecodeHash(hash)
	expected := argon2id.Params{Memory: 64 * 1024, Iterations: 1, Parallelism: uint8(runtime.NumCPU()), SaltLength: 16, KeyLength: 32}
	if err != nil || actual == nil || *actual != expected || len(salt) != 16 || len(key) != 32 {
		t.Fatalf("hash parameters=%+v, salt=%d, key=%d, error=%v", actual, len(salt), len(key), err)
	}
	if match, err := r.Compare("round-trip password", hash); !match || err != nil {
		t.Fatalf("round trip: match=%v, error=%v", match, err)
	}
	if match, err := r.Compare("different password", hash); match || err != nil {
		t.Fatalf("wrong password: match=%v, error=%v", match, err)
	}
	stored, err := argon2id.CreateHash("legacy password", &argon2id.Params{Memory: 8 * 1024, Iterations: 2, Parallelism: 1, SaltLength: 8, KeyLength: 16})
	if err != nil {
		t.Fatal(err)
	}
	if match, err := r.Compare("legacy password", stored); !match || err != nil {
		t.Fatalf("stored parameter compatibility: match=%v, error=%v", match, err)
	}
	if _, err := r.Compare("password", "malformed"); !errors.Is(err, argon2id.ErrInvalidHash) {
		t.Fatalf("malformed stored hash error=%v", err)
	}
}
