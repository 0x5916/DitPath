package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"opencw/internal/models"
	"opencw/internal/utils"

	"github.com/gin-gonic/gin"
)

type authBindingResponseBody struct {
	source   io.Reader
	failure  error
	cancel   context.CancelFunc
	cancelAt int
	read     int
}

func (body *authBindingResponseBody) Read(buffer []byte) (int, error) {
	if body.failure != nil {
		if body.cancel != nil {
			body.cancel()
		}
		return 0, body.failure
	}
	count, err := body.source.Read(buffer)
	body.read += count
	if body.cancel != nil && body.read >= body.cancelAt {
		body.cancel()
	}
	return count, err
}

func (*authBindingResponseBody) Close() error { return nil }

func TestAuthBindingResponseSnapshots(t *testing.T) {
	const invalidBody = `{"code":"INVALID_REQUEST_BODY","error":"Invalid request body"}`
	const oversizedBody = `{"code":"REQUEST_BODY_TOO_LARGE","error":"The request body is too large."}`
	for _, endpoint := range []struct {
		name, method, path string
		handler            func(*utils.PasswordWork) gin.HandlerFunc
	}{
		{"register", http.MethodPost, "/v1/auth/register", func(work *utils.PasswordWork) gin.HandlerFunc {
			return (&AuthHandler{Passwords: work}).Register
		}},
		{"login", http.MethodPost, "/v1/auth/login", func(work *utils.PasswordWork) gin.HandlerFunc {
			return (&AuthHandler{Passwords: work}).Login
		}},
		{"password", http.MethodPut, "/v1/user/password", func(work *utils.PasswordWork) gin.HandlerFunc {
			return (UserHandler{Passwords: work}).UpdatePassword
		}},
	} {
		t.Run(endpoint.name, func(t *testing.T) {
			for _, saturated := range []bool{false, true} {
				t.Run(fmt.Sprintf("saturated=%v", saturated), func(t *testing.T) {
					for _, test := range []struct {
						name, payload, snapshot string
						failure                 error
						length                  int64
						cancelAt, status        int
					}{
						{"malformed", "{", invalidBody, nil, -1, -1, 400},
						{"read failure", "", invalidBody, errors.New("injected body read failure"), -1, -1, 400},
						{"declared oversized", "{", oversizedBody, nil, AuthJSONMaxBytes + 1, -1, 413},
						{"streamed oversized", strings.Repeat("x", int(AuthJSONMaxBytes)+1), oversizedBody, nil, -1, -1, 413},
						{"cancel during read failure", "", "", errors.New("injected body read failure"), -1, 0, 200},
						{"cancel at body cap", strings.Repeat("x", int(AuthJSONMaxBytes)+1), "", nil, -1, int(AuthJSONMaxBytes) + 1, 200},
						{"wrapped canceled with live context", "", "", fmt.Errorf("body read: %w", context.Canceled), -1, -1, 200},
						{"wrapped deadline with live context", "", "", fmt.Errorf("body read: %w", context.DeadlineExceeded), -1, -1, 200},
					} {
						t.Run(test.name, func(t *testing.T) {
							workerCalls := 0
							work, err := utils.NewPasswordWork(1, func(string) (string, error) {
								workerCalls++
								return "unused", nil
							}, func(string, string) (bool, error) {
								workerCalls++
								return true, nil
							})
							if err != nil {
								t.Fatal(err)
							}
							var held *utils.PasswordReservation
							if saturated {
								held, err = work.Acquire(context.Background())
								if err != nil {
									t.Fatal(err)
								}
								t.Cleanup(held.Close)
							}
							ctx, cancel := context.WithCancel(context.Background())
							t.Cleanup(cancel)
							body := &authBindingResponseBody{source: strings.NewReader(test.payload), failure: test.failure, cancelAt: test.cancelAt}
							if test.cancelAt >= 0 {
								body.cancel = cancel
							}
							response := httptest.NewRecorder()
							c, _ := gin.CreateTestContext(response)
							c.Request = httptest.NewRequest(endpoint.method, endpoint.path, body).WithContext(ctx)
							c.Request.ContentLength = test.length
							c.Request.Header.Set("Content-Type", "application/json")
							c.Set("user", &models.User{})
							// A binding failure must return before touching the nil database.
							endpoint.handler(work)(c)

							if response.Code != test.status || response.Body.String() != test.snapshot {
								t.Fatalf("response = %d %s; want %d %s", response.Code, response.Body, test.status, test.snapshot)
							}
							headers := http.Header{}
							if test.snapshot != "" {
								headers.Set("Content-Type", "application/json; charset=utf-8")
							}
							if test.status == http.StatusRequestEntityTooLarge {
								headers.Set("Cache-Control", "no-store")
							}
							if !reflect.DeepEqual(response.Header(), headers) {
								t.Fatalf("headers = %v; want %v", response.Header(), headers)
							}
							aborted := test.snapshot == ""
							if c.IsAborted() != aborted || (aborted && c.Writer.Written()) {
								t.Fatalf("aborted=%v written=%v; want aborted=%v", c.IsAborted(), c.Writer.Written(), aborted)
							}
							if (ctx.Err() != nil) != (test.cancelAt >= 0) {
								t.Fatalf("request context error = %v; cancelAt=%d", ctx.Err(), test.cancelAt)
							}
							if test.name == "cancel at body cap" && body.read != int(AuthJSONMaxBytes)+1 {
								t.Fatalf("read %d bytes; want exactly the body cap plus one", body.read)
							}
							if workerCalls != 0 {
								t.Fatalf("binding failure ran %d password workers", workerCalls)
							}
							if held != nil {
								if reservation, err := work.Acquire(context.Background()); reservation != nil || !errors.Is(err, utils.ErrPasswordCapacity) {
									t.Fatalf("binding failure released occupied capacity: reservation=%v error=%v", reservation, err)
								}
								held.Close()
							}
							reservation, err := work.Acquire(context.Background())
							if err != nil {
								t.Fatalf("binding failure retained password capacity: %v", err)
							}
							reservation.Close()
						})
					}
				})
			}
		})
	}
}
