package configs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"os/exec"
	"reflect"
	"testing"
	"time"
)

func TestLoadProcessCharacterization(t *testing.T) {
	if os.Getenv("DITPATH_CONFIG_CHILD") == "1" {
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
			ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
				if attr.Key == slog.TimeKey {
					return slog.Attr{}
				}
				return attr
			},
		})))
		Load()
		if err := json.NewEncoder(os.Stdout).Encode(App); err != nil {
			panic(err)
		}
		os.Exit(0)
	}

	const secret = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="
	base := map[string]string{
		"DITPATH_CONFIG_CHILD": "1", "PORT": "8080", "DB_HOST": "db.invalid", "DB_PORT": "5432",
		"DB_USER": "fixture", "DB_PASSWORD": "synthetic-password", "DB_NAME": "fixture",
		"JWT_SECRET": secret, "RESEND_API_KEY": "synthetic-key", "RESEND_FROM_EMAIL": "test@example.invalid", "GIN_MODE": "debug",
	}
	defaults := Config{
		Port: "8080", DBHost: "db.invalid", DBPort: "5432", DBUser: "fixture", DBPassword: "synthetic-password", DBName: "fixture",
		JWTSecret: []byte("01234567890123456789012345678901"), ResendAPIKey: "synthetic-key", ResendFromEmail: "test@example.invalid", GinMode: "debug",
		ReadTimeout: 15 * time.Second, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second,
		IdleTimeout: 120 * time.Second, ShutdownTimeout: 20 * time.Second,
		DBMaxOpenConns: 25, DBMaxIdleConns: 5, DBConnMaxLifetime: 30 * time.Minute, DBConnMaxIdleTime: 5 * time.Minute,
	}
	custom := Config{
		Port: " 9090 ", DBHost: "custom.invalid", DBPort: "6543", DBUser: "reader", DBPassword: "custom-password", DBName: "custom",
		JWTSecret: []byte("01234567890123456789012345678901"), ResendAPIKey: "custom-key", ResendFromEmail: "custom@example.invalid", GinMode: "release",
		CORSOrigins:           []string{"https://one.invalid", "https://two.invalid", "https://one.invalid"},
		AuthTrustedProxyCIDRs: []netip.Prefix{netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("198.51.100.0/24")},
		ReadTimeout:           2 * time.Second, ReadHeaderTimeout: 3 * time.Second, WriteTimeout: 4 * time.Second,
		IdleTimeout: 5 * time.Second, ShutdownTimeout: 6 * time.Second,
		DBMaxOpenConns: 12, DBMaxIdleConns: 3, DBConnMaxLifetime: 7 * time.Minute, DBConnMaxIdleTime: 8 * time.Minute,
	}
	short := defaults
	short.JWTSecret = []byte("short")
	const warning = "{\"level\":\"WARN\",\"msg\":\"JWT_SECRET length is lower than 32 bytes. For security, consider a longer secret.\",\"length\":5}\n"
	type loadCase struct {
		name string
		env  map[string]string
		want *Config
		log  string
	}
	cases := []loadCase{
		{name: "defaults", want: &defaults},
		{name: "custom values", env: map[string]string{
			"PORT": " 9090 ", "DB_HOST": "custom.invalid", "DB_PORT": "6543", "DB_USER": "reader", "DB_PASSWORD": "custom-password", "DB_NAME": "custom",
			"RESEND_API_KEY": "custom-key", "RESEND_FROM_EMAIL": "custom@example.invalid", "GIN_MODE": "release",
			"CORS_ORIGINS":             " https://one.invalid, ,https://two.invalid,https://one.invalid, ",
			"AUTH_TRUSTED_PROXY_CIDRS": "192.0.2.63/24, ::ffff:198.51.100.1/120",
			"READ_TIMEOUT":             " 2s ", "READ_HEADER_TIMEOUT": "3s", "WRITE_TIMEOUT": "4s", "IDLE_TIMEOUT": "5s", "SHUTDOWN_TIMEOUT": "6s",
			"DB_MAX_OPEN_CONNS": " +12 ", "DB_MAX_IDLE_CONNS": "3", "DB_CONN_MAX_LIFETIME": "7m", "DB_CONN_MAX_IDLE_TIME": "8m",
		}, want: &custom},
		{name: "empty optional lists", env: map[string]string{"CORS_ORIGINS": "", "AUTH_TRUSTED_PROXY_CIDRS": ""}, want: &defaults},
		{name: "whitespace optional lists", env: map[string]string{"CORS_ORIGINS": " \t ", "AUTH_TRUSTED_PROXY_CIDRS": " \t "}, want: &defaults},
		{name: "comma only CORS", env: map[string]string{"CORS_ORIGINS": " , , "}, want: &defaults},
		{name: "short secret warns", env: map[string]string{"JWT_SECRET": "c2hvcnQ="}, want: &short, log: warning},
		{name: "empty secret precedes required fields", env: map[string]string{"JWT_SECRET": "", "PORT": ""},
			log: "{\"level\":\"ERROR\",\"msg\":\"JWT_SECRET is empty\"}\n"},
		{name: "malformed secret", env: map[string]string{"JWT_SECRET": "!!!!"},
			log: "{\"level\":\"ERROR\",\"msg\":\"Cannot decode JWT_SECRET. Is it in base64 format?\",\"err\":\"illegal base64 data at input byte 0\"}\n"},
		{name: "newline secret decodes empty", env: map[string]string{"JWT_SECRET": "\n"},
			log: "{\"level\":\"WARN\",\"msg\":\"JWT_SECRET length is lower than 32 bytes. For security, consider a longer secret.\",\"length\":0}\n" +
				"{\"level\":\"ERROR\",\"msg\":\"Error validating config\",\"err\":\"config field \\\"JWTSecret\\\" is required but empty\"}\n"},
		{name: "required declaration order", env: map[string]string{"PORT": "", "DB_HOST": ""},
			log: "{\"level\":\"ERROR\",\"msg\":\"Error validating config\",\"err\":\"config field \\\"Port\\\" is required but empty\"}\n"},
		{name: "proxy errors precede numeric errors", env: map[string]string{"AUTH_TRUSTED_PROXY_CIDRS": "0.0.0.0/0", "READ_TIMEOUT": "bad"},
			log: "{\"level\":\"ERROR\",\"msg\":\"Invalid authentication proxy configuration\",\"err\":\"AUTH_TRUSTED_PROXY_CIDRS cannot contain a /0 prefix\"}\n"},
	}

	fields := []string{"READ_TIMEOUT", "READ_HEADER_TIMEOUT", "WRITE_TIMEOUT", "IDLE_TIMEOUT", "SHUTDOWN_TIMEOUT", "DB_MAX_OPEN_CONNS", "DB_MAX_IDLE_CONNS", "DB_CONN_MAX_LIFETIME", "DB_CONN_MAX_IDLE_TIME"}
	for i, field := range fields {
		kind, badValues := "duration", []string{"bad", "0s", "-1s"}
		if i == 5 || i == 6 {
			kind, badValues = "integer", []string{"bad", "0", "-1"}
		}
		for j, value := range badValues {
			message, detail := "Duration config must be greater than zero", ""
			if kind == "integer" {
				message = "Integer config must be greater than zero"
			}
			if j == 0 {
				message = "Invalid " + kind + " config"
				detail = `,"err":"time: invalid duration \"bad\""`
				if kind == "integer" {
					detail = `,"err":"strconv.Atoi: parsing \"bad\": invalid syntax"`
				}
			}
			cases = append(cases, loadCase{name: field + " " + value, env: map[string]string{field: value},
				log: fmt.Sprintf("{\"level\":\"ERROR\",\"msg\":%q,\"name\":%q,\"value\":%q%s}\n", message, field, value, detail)})
		}
		env := map[string]string{"JWT_SECRET": "", "PORT": ""}
		for _, later := range fields[i:] {
			env[later] = "bad"
		}
		cases = append(cases, loadCase{name: field + " error precedence", env: env,
			log: fmt.Sprintf("{\"level\":\"ERROR\",\"msg\":%q,\"name\":%q,\"value\":\"bad\"%s}\n", "Invalid "+kind+" config", field,
				map[string]string{"duration": `,"err":"time: invalid duration \"bad\""`, "integer": `,"err":"strconv.Atoi: parsing \"bad\": invalid syntax"`}[kind])})
	}
	blankNumbers := map[string]string{}
	for _, field := range fields {
		blankNumbers[field] = " \t "
	}
	cases = append(cases, loadCase{name: "blank numeric values use defaults", env: blankNumbers, want: &defaults})

	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := make(map[string]string, len(base)+len(tc.env))
			for key, value := range base {
				env[key] = value
			}
			for key, value := range tc.env {
				env[key] = value
			}
			cmd := exec.Command(executable, "-test.run=^TestLoadProcessCharacterization$")
			cmd.Env = []string{"GOCOVERDIR=" + t.TempDir()}
			for key, value := range env {
				cmd.Env = append(cmd.Env, key+"="+value)
			}
			var stdout, stderr bytes.Buffer
			cmd.Stdout, cmd.Stderr = &stdout, &stderr
			code := 0
			if err := cmd.Run(); err != nil {
				var exitError *exec.ExitError
				if !errors.As(err, &exitError) {
					t.Fatal(err)
				}
				code = exitError.ExitCode()
			}
			wantCode := 0
			if tc.want == nil {
				wantCode = 1
			}
			if code != wantCode || stderr.String() != tc.log {
				t.Fatalf("exit/log = %d, %s; want %d, %s", code, stderr.String(), wantCode, tc.log)
			}
			if tc.want == nil {
				if stdout.Len() != 0 {
					t.Fatalf("failed Load wrote a config: %s", stdout.String())
				}
				return
			}
			var got Config
			if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, *tc.want) {
				t.Fatalf("config = %#v, want %#v", got, *tc.want)
			}
		})
	}
}
