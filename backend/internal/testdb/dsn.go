// Package testdb provides the explicit disposable-database opt-in for integration tests.
package testdb

import (
	"os"
	"testing"
)

func DSN(t *testing.T) string {
	t.Helper()
	dsn, configured := os.LookupEnv("MORSEWELL_TEST_DATABASE_DSN")
	if !configured {
		dsn = os.Getenv("OPENCW_TEST_DATABASE_DSN")
	}
	if dsn == "" {
		t.Skip("set MORSEWELL_TEST_DATABASE_DSN to a disposable PostgreSQL database")
	}
	return dsn
}
