package utils

import (
	"context"
	"errors"
	"runtime"
	"sync"

	"github.com/alexedwards/argon2id"
)

const DefaultPasswordConcurrency = 2

var (
	ErrPasswordCapacity          = errors.New("password work capacity exceeded")
	ErrPasswordReservationClosed = errors.New("password work reservation is closed")
)

var params = &argon2id.Params{
	Memory:      64 * 1024, // 64 MB
	Iterations:  1,
	Parallelism: uint8(runtime.NumCPU()),
	SaltLength:  16,
	KeyLength:   32,
}

// PasswordWork bounds synchronous password work without a waiting queue.
type PasswordWork struct {
	slots   chan struct{}
	hash    func(string) (string, error)
	compare func(string, string) (bool, error)
}

// PasswordReservation retains capacity until Close, including during cancellation.
// Copies share the same worker lock and lifecycle.
type PasswordReservation struct {
	state *passwordReservationState
}

type passwordReservationState struct {
	work   *PasswordWork
	ctx    context.Context
	mu     sync.Mutex
	closed bool
}

var defaultPasswordWork, _ = NewPasswordWork(DefaultPasswordConcurrency, nil, nil)

func DefaultPasswordWork() *PasswordWork { return defaultPasswordWork }

// NewPasswordWork permits isolated worker injection; nil workers use Argon2id.
func NewPasswordWork(limit int, hash func(string) (string, error), compare func(string, string) (bool, error)) (*PasswordWork, error) {
	if limit <= 0 {
		return nil, errors.New("password work capacity must be positive")
	}
	if hash == nil {
		hash = hashPassword
	}
	if compare == nil {
		compare = comparePasswordAndHash
	}
	return &PasswordWork{slots: make(chan struct{}, limit), hash: hash, compare: compare}, nil
}

func (w *PasswordWork) Acquire(ctx context.Context) (*PasswordReservation, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case w.slots <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-w.slots
			return nil, err
		}
		return &PasswordReservation{state: &passwordReservationState{work: w, ctx: ctx}}, nil
	default:
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return nil, ErrPasswordCapacity
	}
}

func (r *PasswordReservation) Hash(password string) (string, error) {
	if r == nil || r.state == nil {
		return "", ErrPasswordReservationClosed
	}
	s := r.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return "", ErrPasswordReservationClosed
	}
	if err := s.ctx.Err(); err != nil {
		return "", err
	}
	hash, err := s.work.hash(password)
	if canceled := s.ctx.Err(); canceled != nil {
		return "", canceled
	}
	return hash, err
}

func (r *PasswordReservation) Compare(password, hash string) (bool, error) {
	if r == nil || r.state == nil {
		return false, ErrPasswordReservationClosed
	}
	s := r.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false, ErrPasswordReservationClosed
	}
	if err := s.ctx.Err(); err != nil {
		return false, err
	}
	match, err := s.work.compare(password, hash)
	if canceled := s.ctx.Err(); canceled != nil {
		return false, canceled
	}
	return match, err
}

// Close waits for any synchronous worker to return before releasing capacity.
func (r *PasswordReservation) Close() {
	if r == nil || r.state == nil {
		return
	}
	s := r.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closed = true
		<-s.work.slots
	}
}

func HashPassword(ctx context.Context, password string) (string, error) {
	r, err := DefaultPasswordWork().Acquire(ctx)
	if err != nil {
		return "", err
	}
	defer r.Close()
	return r.Hash(password)
}

func ComparePasswordAndHash(ctx context.Context, password, hash string) (bool, error) {
	r, err := DefaultPasswordWork().Acquire(ctx)
	if err != nil {
		return false, err
	}
	defer r.Close()
	return r.Compare(password, hash)
}

func hashPassword(password string) (string, error) {
	return argon2id.CreateHash(password, params)
}

func comparePasswordAndHash(password, hash string) (bool, error) {
	return argon2id.ComparePasswordAndHash(password, hash)
}
