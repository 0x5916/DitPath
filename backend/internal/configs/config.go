package configs

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"reflect"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port            string   `required:"true"`
	DBHost          string   `required:"true"`
	DBPort          string   `required:"true"`
	DBUser          string   `required:"true"`
	DBPassword      string   `required:"true"`
	DBName          string   `required:"true"`
	JWTSecret       []byte   `required:"true"`
	ResendAPIKey    string   `required:"true"`
	ResendFromEmail string   `required:"true"`
	GinMode         string   `required:"true"`
	CORSOrigins     []string // optional — no tag

	ReadTimeout       time.Duration `required:"true"`
	ReadHeaderTimeout time.Duration `required:"true"`
	WriteTimeout      time.Duration `required:"true"`
	IdleTimeout       time.Duration `required:"true"`
	ShutdownTimeout   time.Duration `required:"true"`

	DBMaxOpenConns    int           `required:"true"`
	DBMaxIdleConns    int           `required:"true"`
	DBConnMaxLifetime time.Duration `required:"true"`
	DBConnMaxIdleTime time.Duration `required:"true"`
}

var App Config

func Load() {
	readTimeout := getDurationEnv("READ_TIMEOUT", 15*time.Second)
	readHeaderTimeout := getDurationEnv("READ_HEADER_TIMEOUT", 5*time.Second)
	writeTimeout := getDurationEnv("WRITE_TIMEOUT", 30*time.Second)
	idleTimeout := getDurationEnv("IDLE_TIMEOUT", 120*time.Second)
	shutdownTimeout := getDurationEnv("SHUTDOWN_TIMEOUT", 20*time.Second)

	dbMaxOpenConns := getIntEnv("DB_MAX_OPEN_CONNS", 25)
	dbMaxIdleConns := getIntEnv("DB_MAX_IDLE_CONNS", 5)
	dbConnMaxLifetime := getDurationEnv("DB_CONN_MAX_LIFETIME", 30*time.Minute)
	dbConnMaxIdleTime := getDurationEnv("DB_CONN_MAX_IDLE_TIME", 5*time.Minute)

	var corsOrigins []string
	if raw := os.Getenv("CORS_ORIGINS"); raw != "" {
		for _, o := range strings.Split(raw, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				corsOrigins = append(corsOrigins, trimmed)
			}
		}
	}

	App = Config{
		Port:              os.Getenv("PORT"),
		DBHost:            os.Getenv("DB_HOST"),
		DBPort:            os.Getenv("DB_PORT"),
		DBUser:            os.Getenv("DB_USER"),
		DBPassword:        os.Getenv("DB_PASSWORD"),
		DBName:            os.Getenv("DB_NAME"),
		ResendAPIKey:      os.Getenv("RESEND_API_KEY"),
		ResendFromEmail:   os.Getenv("RESEND_FROM_EMAIL"),
		GinMode:           os.Getenv("GIN_MODE"),
		CORSOrigins:       corsOrigins,
		ReadTimeout:       readTimeout,
		ReadHeaderTimeout: readHeaderTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		ShutdownTimeout:   shutdownTimeout,
		DBMaxOpenConns:    dbMaxOpenConns,
		DBMaxIdleConns:    dbMaxIdleConns,
		DBConnMaxLifetime: dbConnMaxLifetime,
		DBConnMaxIdleTime: dbConnMaxIdleTime,
	}

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		slog.Error("JWT_SECRET is empty")
		os.Exit(1)
	}
	decoded, err := base64.StdEncoding.DecodeString(secret)
	if err != nil {
		slog.Error("Cannot decode JWT_SECRET. Is it in base64 format?", "err", err)
		os.Exit(1)
	}
	if len(decoded) < 32 {
		slog.Warn("JWT_SECRET length is lower than 32 bytes. For security, consider a longer secret.", "length", len(decoded))
	}
	App.JWTSecret = decoded
	if err := App.Validate(); err != nil {
		slog.Error("Error validating config", "err", err)
		os.Exit(1)
	}
}

func getDurationEnv(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	v, err := time.ParseDuration(raw)
	if err != nil {
		slog.Error("Invalid duration config", "name", name, "value", raw, "err", err)
		os.Exit(1)
	}
	if v <= 0 {
		slog.Error("Duration config must be greater than zero", "name", name, "value", raw)
		os.Exit(1)
	}
	return v
}

func getIntEnv(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		slog.Error("Invalid integer config", "name", name, "value", raw, "err", err)
		os.Exit(1)
	}
	if v <= 0 {
		slog.Error("Integer config must be greater than zero", "name", name, "value", raw)
		os.Exit(1)
	}
	return v
}

func (c Config) Validate() error {
	v := reflect.ValueOf(c)
	t := reflect.TypeOf(c)

	for i := 0; i < v.NumField(); i++ {
		field := v.Field(i)
		fieldType := t.Field(i)

		if fieldType.Tag.Get("required") != "true" {
			continue
		}

		if isZero(field) {
			return fmt.Errorf("config field %q is required but empty", fieldType.Name)
		}
	}
	return nil
}

func isZero(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.String:
		return v.String() == ""
	case reflect.Slice, reflect.Map, reflect.Array:
		return v.Len() == 0
	case reflect.Ptr, reflect.Interface:
		return v.IsNil()
	default:
		return reflect.DeepEqual(v.Interface(), reflect.Zero(v.Type()).Interface())
	}
}

func GetGinMode() string {
	return os.Getenv("GIN_MODE")
}

func (c Config) IsRelease() bool {
	return c.GinMode == "release"
}
