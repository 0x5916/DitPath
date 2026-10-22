package handlers

import (
	"os"
	"testing"

	"opencw/internal/models"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// These tests require a migrated disposable PostgreSQL database. They never
// migrate schemas or call the email provider; callbacks belong to each test's
// independent GORM root, rather than a shared session clone.
func postgresTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("OPENCW_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("set OPENCW_TEST_DATABASE_DSN to a migrated disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{TranslateError: true, Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("cannot connect to disposable PostgreSQL database")
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(12)
	t.Cleanup(func() { _ = pool.Close() })
	var present bool
	if err := db.Raw(`SELECT EXISTS (SELECT FROM pg_indexes WHERE schemaname = current_schema()
		AND tablename = 'users' AND indexname = 'idx_users_verified_email'
		AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%email_verified%'
		AND indexdef LIKE '%deleted_at IS NULL%')`).Scan(&present).Error; err != nil || !present {
		t.Fatalf("migrated verified-email unique index missing: %v", err)
	}
	return db
}

func postgresTestUser(t *testing.T, db *gorm.DB, address string) models.User {
	t.Helper()
	if address == "" {
		address = uuid.NewString() + "@example.invalid"
	}
	user := models.User{Username: "email_" + uuid.NewString(), Email: address, Password: "unused"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Unscoped().Where("user_id = ?", user.ID).Delete(&models.EmailOTP{}).Error; err != nil {
			t.Error(err)
		}
		if err := db.Unscoped().Delete(&user).Error; err != nil {
			t.Error(err)
		}
	})
	return user
}
