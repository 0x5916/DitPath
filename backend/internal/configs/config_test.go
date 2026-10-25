package configs

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

func validDirectConfig() Config {
	return Config{
		Port: "8080", DBHost: "localhost", DBPort: "5432", DBUser: "test-user",
		DBPassword: "test-password", DBName: "test-database", JWTSecret: make([]byte, 32),
		ResendAPIKey: "test-key", ResendFromEmail: "test@example.invalid", GinMode: "debug",
		ReadTimeout: 15 * time.Second, ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second, ShutdownTimeout: 20 * time.Second,
		DBMaxOpenConns: 25, DBMaxIdleConns: 5,
		DBConnMaxLifetime: 30 * time.Minute, DBConnMaxIdleTime: 5 * time.Minute,
	}
}

func TestConfigValidateRequiredFieldsAndOrder(t *testing.T) {
	if err := validDirectConfig().Validate(); err != nil {
		t.Fatalf("valid config with nil optional slices: %v", err)
	}
	required := []string{
		"Port", "DBHost", "DBPort", "DBUser", "DBPassword", "DBName", "JWTSecret",
		"ResendAPIKey", "ResendFromEmail", "GinMode", "ReadTimeout", "ReadHeaderTimeout",
		"WriteTimeout", "IdleTimeout", "ShutdownTimeout", "DBMaxOpenConns", "DBMaxIdleConns",
		"DBConnMaxLifetime", "DBConnMaxIdleTime",
	}
	for index, name := range required {
		t.Run(name, func(t *testing.T) {
			for _, missing := range [][]string{{name}, required[index:]} {
				config := validDirectConfig()
				fields := reflect.ValueOf(&config).Elem()
				for _, field := range missing {
					fields.FieldByName(field).SetZero()
				}
				want := fmt.Sprintf("config field %q is required but empty", name)
				if err := config.Validate(); err == nil || err.Error() != want {
					t.Fatalf("missing %v: error = %v, want %q", missing, err, want)
				}
			}
		})
	}
}

func TestConfigValidateCurrentNonzeroValues(t *testing.T) {
	config := validDirectConfig()
	config.JWTSecret = []byte{}
	if err := config.Validate(); err == nil || err.Error() != `config field "JWTSecret" is required but empty` {
		t.Fatalf("allocated empty secret: %v", err)
	}
	config = validDirectConfig()
	fields := reflect.ValueOf(&config).Elem()
	for index := range fields.NumField() {
		field := fields.Field(index)
		switch field.Kind() {
		case reflect.String:
			if fields.Type().Field(index).Name == "GoogleClientID" {
				continue // Google has a separate opt-in syntax contract.
			}
			field.SetString(" \t")
		case reflect.Int, reflect.Int64:
			field.SetInt(-1)
		}
	}
	if err := config.Validate(); err != nil {
		t.Fatalf("nonempty whitespace and negative numeric values: %v", err)
	}
}

func TestConfigIsReleaseExactMatch(t *testing.T) {
	for _, test := range []struct {
		mode string
		want bool
	}{
		{"release", true}, {"", false}, {"debug", false}, {"test", false},
		{"Release", false}, {"RELEASE", false}, {" release", false}, {"release ", false},
	} {
		t.Run(test.mode, func(t *testing.T) {
			if got := (Config{GinMode: test.mode}).IsRelease(); got != test.want {
				t.Fatalf("IsRelease(%q) = %v, want %v", test.mode, got, test.want)
			}
		})
	}
}

func TestIsZeroCurrentSemantics(t *testing.T) {
	for _, test := range []struct {
		name  string
		value any
		want  bool
	}{
		{"empty string", "", true}, {"whitespace string", " ", false},
		{"nil slice", []byte(nil), true}, {"empty slice", []byte{}, true}, {"nonempty slice", []byte{0}, false},
		{"nil map", map[string]int(nil), true}, {"empty map", map[string]int{}, true}, {"nonempty map", map[string]int{"": 0}, false},
		{"empty array", [0]int{}, true}, {"nonempty zero array", [1]int{}, false},
		{"nil pointer", (*int)(nil), true}, {"pointer to zero", new(int), false},
		{"zero integer", 0, true}, {"negative integer", -1, false},
		{"zero duration", time.Duration(0), true}, {"positive duration", time.Second, false},
		{"zero bool", false, true}, {"true bool", true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := isZero(reflect.ValueOf(test.value)); got != test.want {
				t.Fatalf("isZero(%#v) = %v, want %v", test.value, got, test.want)
			}
		})
	}
}
