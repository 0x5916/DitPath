package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvironment(t *testing.T) {
	const key = "DITPATH_ENV_LOAD_TEST"
	for _, tc := range []struct {
		name      string
		mode      string
		file      string
		injected  bool
		directory bool
		wantError bool
		wantValue string
	}{
		{name: "missing dotenv accepts injected environment", mode: "debug", injected: true, wantValue: "injected"},
		{name: "dotenv supplies development values", mode: "debug", file: key + "=from-file\n", wantValue: "from-file"},
		{name: "dotenv preserves injected values", mode: "debug", file: key + "=from-file\n", injected: true, wantValue: "injected"},
		{name: "malformed dotenv is fatal", mode: "debug", file: key + "=\"unterminated\n", injected: true, wantError: true, wantValue: "injected"},
		{name: "unreadable dotenv is fatal", mode: "debug", directory: true, injected: true, wantError: true, wantValue: "injected"},
		{name: "release ignores dotenv", mode: "release", file: key + "=\"unterminated\n", injected: true, wantValue: "injected"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(key, "injected")
			if !tc.injected {
				if err := os.Unsetenv(key); err != nil {
					t.Fatal(err)
				}
			}
			filename := filepath.Join(t.TempDir(), ".env")
			if tc.directory {
				if err := os.Mkdir(filename, 0700); err != nil {
					t.Fatal(err)
				}
			} else if tc.file != "" {
				if err := os.WriteFile(filename, []byte(tc.file), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := loadEnvironment(tc.mode, filename); (err != nil) != tc.wantError {
				t.Fatalf("loadEnvironment error = %v, want error %v", err, tc.wantError)
			}
			if got := os.Getenv(key); got != tc.wantValue {
				t.Fatalf("environment value = %q, want %q", got, tc.wantValue)
			}
		})
	}
}
