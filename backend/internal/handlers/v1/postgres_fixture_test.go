package handlers

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"opencw/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestPostgresFixtureIndependentRoots(t *testing.T) {
	first, second := postgresTestDB(t), postgresTestDB(t)
	firstPool, err := first.DB()
	if err != nil {
		t.Fatal(err)
	}
	secondPool, err := second.DB()
	if err != nil {
		t.Fatal(err)
	}
	if first == second || firstPool == secondPool || first.Callback() == second.Callback() {
		t.Fatal("fixtures share a GORM root, connection pool, or callback registry")
	}
	if !first.TranslateError || !second.TranslateError || firstPool.Stats().MaxOpenConnections != 12 || secondPool.Stats().MaxOpenConnections != 12 {
		t.Fatal("fixtures must translate database errors and allow twelve connections")
	}
	failure := errors.New("injected fixture query failure")
	if err := first.Callback().Query().Before("gorm:query").Register("test:fixture-query", func(tx *gorm.DB) { tx.AddError(failure) }); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = first.Callback().Query().Remove("test:fixture-query") })
	var users []models.User
	if err := first.Where("1 = 0").Find(&users).Error; !errors.Is(err, failure) {
		t.Fatalf("first root lost its callback: %v", err)
	}
	if err := firstPool.Close(); err != nil {
		t.Fatal(err)
	}
	if err := second.Where("1 = 0").Find(&users).Error; err != nil {
		t.Fatalf("second root inherited the callback or closed pool: %v", err)
	}
}

func TestPostgresFixtureUserDefaultsAndCleanup(t *testing.T) {
	db := postgresTestDB(t)
	var deleted []string
	if err := db.Callback().Delete().Before("gorm:delete").Register("test:fixture-delete", func(tx *gorm.DB) {
		deleted = append(deleted, tx.Statement.Table)
		if !tx.Statement.Unscoped {
			t.Error("fixture cleanup must delete rows permanently")
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Delete().Remove("test:fixture-delete") })
	var ids []uuid.UUID
	t.Run("users", func(t *testing.T) {
		generated := postgresTestUser(t, db, "")
		const address = "Provided.Address+tag@Example.invalid"
		provided := postgresTestUser(t, db, address)
		ids = []uuid.UUID{generated.ID, provided.ID}
		if provided.Email != address || !strings.HasSuffix(generated.Email, "@example.invalid") {
			t.Fatalf("fixture email behavior changed: %q %q", generated.Email, provided.Email)
		}
		if _, err := uuid.Parse(strings.TrimSuffix(generated.Email, "@example.invalid")); err != nil {
			t.Fatalf("generated email lacks its UUID: %q", generated.Email)
		}
		for _, user := range []models.User{generated, provided} {
			if !strings.HasPrefix(user.Username, "email_") || user.ID == uuid.Nil || user.Password != "unused" || user.EmailVerified || user.CallSign != nil || user.CWSettings != nil || user.PageSettings != nil {
				t.Fatalf("fixture user defaults changed: %+v", user)
			}
			if _, err := uuid.Parse(strings.TrimPrefix(user.Username, "email_")); err != nil {
				t.Fatalf("generated username lacks its UUID: %q", user.Username)
			}
			otp := models.EmailOTP{UserID: &user.ID, Email: user.Email, Code: "123456", ExpiredAt: time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)}
			if err := db.Create(&otp).Error; err != nil {
				t.Fatal(err)
			}
		}
	})
	if want := []string{"email_otp", "users", "email_otp", "users"}; !reflect.DeepEqual(deleted, want) {
		t.Fatalf("cleanup order = %v; want %v", deleted, want)
	}
	for _, table := range []struct {
		model  any
		filter string
	}{{&models.EmailOTP{}, "user_id IN ?"}, {&models.User{}, "id IN ?"}} {
		var count int64
		if err := db.Unscoped().Model(table.model).Where(table.filter, ids).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("fixture cleanup left %T rows: count=%d err=%v", table.model, count, err)
		}
	}
}
