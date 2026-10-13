package utils

import (
	"regexp"

	"github.com/gin-gonic/gin/binding"
	"github.com/go-playground/validator/v10"
)

var usernameRegexp = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{1,14}[a-zA-Z0-9]$`)

// RegisterCustomValidators wires project-specific validator tags into Gin's validator engine.
func RegisterCustomValidators() error {
	engine, ok := binding.Validator.Engine().(*validator.Validate)
	if !ok {
		return nil
	}

	return engine.RegisterValidation("username", func(fl validator.FieldLevel) bool {
		return usernameRegexp.MatchString(fl.Field().String())
	})
}
