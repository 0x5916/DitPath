package middlewares

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"opencw/internal/common"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
)

const (
	defaultForumCreateLimit  = 5
	defaultForumCreateWindow = time.Minute
)

type forumCreateRateLimiter struct {
	mu        sync.Mutex
	attempts  map[string][]time.Time
	limit     int
	window    time.Duration
	now       func() time.Time
	cleanupAt time.Time
}

func ForumCreateRateLimit() gin.HandlerFunc {
	return newForumCreateRateLimiter(defaultForumCreateLimit, defaultForumCreateWindow).middleware()
}

func newForumCreateRateLimiter(limit int, window time.Duration) *forumCreateRateLimiter {
	return &forumCreateRateLimiter{
		attempts: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
		now:      time.Now,
	}
}

func (limiter *forumCreateRateLimiter) middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := utils.MustGetUser(c).ID.String()
		retryAfter, allowed := limiter.allow(userID)
		if !allowed {
			retryAfterSeconds := int(retryAfter / time.Second)
			if retryAfter%time.Second != 0 {
				retryAfterSeconds++
			}
			if retryAfterSeconds < 1 {
				retryAfterSeconds = 1
			}

			c.Header("Retry-After", strconv.Itoa(retryAfterSeconds))
			c.JSON(http.StatusTooManyRequests, common.NewErrorResponse(common.ErrorCodeForumRateLimited, "Please wait before creating another forum post"))
			c.Abort()
			return
		}

		c.Next()
	}
}

func (limiter *forumCreateRateLimiter) allow(userID string) (time.Duration, bool) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	now := limiter.now()
	if limiter.cleanupAt.IsZero() || !now.Before(limiter.cleanupAt) {
		limiter.cleanupExpired(now)
		limiter.cleanupAt = now.Add(limiter.window)
	}

	cutoff := now.Add(-limiter.window)
	attempts := activeForumAttempts(limiter.attempts[userID], cutoff)
	if len(attempts) >= limiter.limit {
		limiter.attempts[userID] = attempts
		return attempts[0].Add(limiter.window).Sub(now), false
	}

	limiter.attempts[userID] = append(attempts, now)
	return 0, true
}

func (limiter *forumCreateRateLimiter) cleanupExpired(now time.Time) {
	cutoff := now.Add(-limiter.window)
	for userID, attempts := range limiter.attempts {
		attempts = activeForumAttempts(attempts, cutoff)
		if len(attempts) == 0 {
			delete(limiter.attempts, userID)
		} else {
			limiter.attempts[userID] = attempts
		}
	}
}

func activeForumAttempts(attempts []time.Time, cutoff time.Time) []time.Time {
	firstActive := 0
	for firstActive < len(attempts) && !attempts[firstActive].After(cutoff) {
		firstActive++
	}
	return attempts[firstActive:]
}
