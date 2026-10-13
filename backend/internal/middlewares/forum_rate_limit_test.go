package middlewares

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"opencw/internal/common"
	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestForumCreateRateLimitSharesQuotaAcrossRoutes(t *testing.T) {
	limiter := newForumCreateRateLimiter(defaultForumCreateLimit, defaultForumCreateWindow)
	now := time.Date(2026, time.September, 26, 12, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }
	router := newForumRateLimitTestRouter(limiter)
	userID := "0198c9d2-7f5e-7b1a-9c3e-1f2a3b4c5d6e"
	paths := []string{
		"/forum/threads",
		"/forum/threads/thread-id/replies",
		"/forum/threads",
		"/forum/threads/thread-id/replies",
		"/forum/threads",
	}

	for _, path := range paths {
		response := performForumCreateRequest(router, path, userID)
		if response.Code != http.StatusCreated {
			t.Fatalf("request to %s returned %d, want %d", path, response.Code, http.StatusCreated)
		}
	}

	response := performForumCreateRequest(router, "/forum/threads/thread-id/replies", userID)
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("sixth create request returned %d, want %d", response.Code, http.StatusTooManyRequests)
	}
	if retryAfter, err := strconv.Atoi(response.Header().Get("Retry-After")); err != nil || retryAfter < 1 {
		t.Fatalf("Retry-After = %q, want a positive integer", response.Header().Get("Retry-After"))
	}

	var body common.ErrorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode rate limit response: %v", err)
	}
	if body.Code != common.ErrorCodeForumRateLimited {
		t.Fatalf("error code = %q, want %q", body.Code, common.ErrorCodeForumRateLimited)
	}

	otherUserResponse := performForumCreateRequest(router, "/forum/threads", "0198c9d2-7f5e-7b1a-9c3e-1f2a3b4c5d6f")
	if otherUserResponse.Code != http.StatusCreated {
		t.Fatalf("new user's request returned %d, want %d", otherUserResponse.Code, http.StatusCreated)
	}
}

func TestForumCreateRateLimiterExpiresAttempts(t *testing.T) {
	limiter := newForumCreateRateLimiter(2, time.Minute)
	now := time.Date(2026, time.September, 26, 12, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }

	for range limiter.limit {
		if _, allowed := limiter.allow("user"); !allowed {
			t.Fatal("request within quota was rejected")
		}
	}

	now = now.Add(limiter.window)
	if _, allowed := limiter.allow("user"); !allowed {
		t.Fatal("request at the end of the window was rejected")
	}
}

func TestForumCreateRateLimiterAllowsConcurrentRequestsWithinQuota(t *testing.T) {
	limiter := newForumCreateRateLimiter(5, time.Minute)
	limiter.now = func() time.Time { return time.Date(2026, time.September, 26, 12, 0, 0, 0, time.UTC) }

	const requestCount = 50
	var allowedCount atomic.Int32
	var waitGroup sync.WaitGroup
	waitGroup.Add(requestCount)
	for range requestCount {
		go func() {
			defer waitGroup.Done()
			if _, allowed := limiter.allow("user"); allowed {
				allowedCount.Add(1)
			}
		}()
	}
	waitGroup.Wait()

	if got := allowedCount.Load(); got != int32(limiter.limit) {
		t.Fatalf("allowed %d concurrent requests, want %d", got, limiter.limit)
	}
}

func newForumRateLimitTestRouter(limiter *forumCreateRateLimiter) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	setUser := func(c *gin.Context) {
		userID, err := uuid.Parse(c.GetHeader("X-Test-User-ID"))
		if err != nil {
			c.AbortWithStatus(http.StatusBadRequest)
			return
		}
		c.Set("user", &models.User{Base: models.Base{ID: userID}})
		c.Next()
	}
	rateLimit := limiter.middleware()
	create := func(c *gin.Context) { c.Status(http.StatusCreated) }
	router.POST("/forum/threads", setUser, rateLimit, create)
	router.POST("/forum/threads/:id/replies", setUser, rateLimit, create)
	return router
}

func performForumCreateRequest(router *gin.Engine, path string, userID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, path, nil)
	request.Header.Set("X-Test-User-ID", userID)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
