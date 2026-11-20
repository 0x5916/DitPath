package handlers

import (
	"bytes"
	"errors"
	"io"
	"net/http"

	"morsewell/internal/common"

	"github.com/gin-gonic/gin"
)

// AuthJSONMaxBytes bounds complete encoded authentication/account JSON bodies.
const AuthJSONMaxBytes int64 = 16 * 1024

var errAuthBodyTooLarge = errors.New("authentication request body exceeds limit")

func bindAuthJSON(c *gin.Context, input any) error {
	body, err := readAuthBody(c)
	if err != nil {
		return err
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	return c.ShouldBindJSON(input)
}

func readAuthBody(c *gin.Context) ([]byte, error) {
	if c.Request.ContentLength > AuthJSONMaxBytes {
		return nil, errAuthBodyTooLarge
	}
	if c.Request.Body == nil {
		return nil, io.EOF
	}
	// Bound the complete body, including any suffix after the first JSON value.
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, AuthJSONMaxBytes))
	var limitErr *http.MaxBytesError
	if errors.As(err, &limitErr) {
		return nil, errAuthBodyTooLarge
	}
	return body, err
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
