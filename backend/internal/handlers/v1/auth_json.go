package handlers

import (
	"bytes"
	"errors"
	"io"
	"net/http"

	"opencw/internal/common"

	"github.com/gin-gonic/gin"
)

// AuthJSONMaxBytes bounds complete encoded authentication/account JSON bodies.
const AuthJSONMaxBytes int64 = 16 * 1024

var errAuthBodyTooLarge = errors.New("authentication request body exceeds limit")

func bindAuthJSON(c *gin.Context, input any) error {
	if c.Request.ContentLength > AuthJSONMaxBytes {
		return errAuthBodyTooLarge
	}
	if c.Request.Body != nil {
		// Gin decodes just the first value. Read the complete bounded body so an
		// oversized suffix cannot bypass the limit before account side effects.
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, AuthJSONMaxBytes))
		if err != nil {
			var limitErr *http.MaxBytesError
			if errors.As(err, &limitErr) {
				return errAuthBodyTooLarge
			}
			return err
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
	}
	return c.ShouldBindJSON(input)
}

func respondAuthBindingError(c *gin.Context, err error) {
	if authCanceled(c, err) {
		return
	}
	if errors.Is(err, errAuthBodyTooLarge) {
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusRequestEntityTooLarge, common.NewErrorResponse(common.ErrorCodeRequestBodyTooLarge,
			"The request body is too large."))
		return
	}
	c.JSON(http.StatusBadRequest, common.NewErrorResponse(common.ErrorCodeInvalidRequestBody, "Invalid request body"))
}
