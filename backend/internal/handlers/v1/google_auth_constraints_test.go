package handlers

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"opencw/internal/googleauth"
	"opencw/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestGoogleIdentityDatabaseConstraints(t *testing.T) {
	db, _, _, prefix := googleFixture(t)
	first := models.User{Username: prefix + "a", Email: prefix + "a@example.invalid"}
	second := models.User{Username: prefix + "b", Email: prefix + "b@example.invalid"}
	if err := db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	original := models.UserIdentity{UserID: first.ID, Provider: "google", Issuer: googleauth.Issuer, Subject: prefix}
	if err := db.Create(&original).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name     string
		identity models.UserIdentity
	}{
		{"issuer subject across accounts", models.UserIdentity{UserID: second.ID, Provider: "google", Issuer: googleauth.Issuer, Subject: prefix}},
		{"issuer subject across provider labels", models.UserIdentity{UserID: second.ID, Provider: "future", Issuer: googleauth.Issuer, Subject: prefix}},
		{"one active provider", models.UserIdentity{UserID: first.ID, Provider: "google", Issuer: "https://future.example.invalid", Subject: prefix}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := db.Create(&tc.identity).Error; !errors.Is(err, gorm.ErrDuplicatedKey) {
				t.Fatalf("identity uniqueness not enforced: %v", err)
			}
		})
	}
	if err := db.Delete(&original).Error; err != nil {
		t.Fatal(err)
	}
	reserved := models.UserIdentity{UserID: second.ID, Provider: "google", Issuer: googleauth.Issuer, Subject: prefix}
	if err := db.Create(&reserved).Error; !errors.Is(err, gorm.ErrDuplicatedKey) {
		t.Fatalf("deleted identity was reassigned: %v", err)
	}
	replacement := models.UserIdentity{UserID: first.ID, Provider: "google", Issuer: googleauth.Issuer, Subject: prefix + "new"}
	if err := db.Create(&replacement).Error; err != nil {
		t.Fatalf("inactive provider prevents future replacement: %v", err)
	}
	otherProvider := models.UserIdentity{UserID: first.ID, Provider: "future", Issuer: "https://future.example.invalid", Subject: prefix}
	if err := db.Create(&otherProvider).Error; err != nil {
		t.Fatalf("provider namespace cannot coexist: %v", err)
	}
	if err := db.Unscoped().Delete(&first).Error; err != nil {
		t.Fatal(err)
	}
	var remaining int64
	if err := db.Unscoped().Model(&models.UserIdentity{}).Where("user_id = ?", first.ID).Count(&remaining).Error; err != nil || remaining != 0 {
		t.Fatalf("account deletion left identities: %d %v", remaining, err)
	}
}

func TestGoogleIdentityRequiredBoundedStrings(t *testing.T) {
	db, _, _, prefix := googleFixture(t)
	user := models.User{Username: prefix, Email: prefix + "@example.invalid"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ field, value string }{
		{"provider", ""}, {"provider", strings.Repeat("p", 33)}, {"provider", "googlé"},
		{"issuer", ""}, {"issuer", strings.Repeat("i", 2049)},
		{"subject", ""}, {"subject", strings.Repeat("s", 256)},
	} {
		t.Run(fmt.Sprintf("%s/%d", tc.field, len(tc.value)), func(t *testing.T) {
			values := map[string]any{"id": uuid.New(), "user_id": user.ID, "provider": "google", "issuer": googleauth.Issuer, "subject": prefix}
			values[tc.field] = tc.value
			if err := db.Model(&models.UserIdentity{}).Create(values).Error; err == nil {
				t.Fatal("invalid identity string was accepted")
			}
		})
	}
	for _, field := range []string{"user_id", "provider", "issuer", "subject"} {
		t.Run(field+"/null", func(t *testing.T) {
			values := map[string]any{"id": uuid.New(), "user_id": user.ID, "provider": "google", "issuer": googleauth.Issuer, "subject": prefix}
			values[field] = nil
			if err := db.Model(&models.UserIdentity{}).Create(values).Error; err == nil {
				t.Fatal("null identity field was accepted")
			}
		})
	}
}
