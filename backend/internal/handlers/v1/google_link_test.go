package handlers

import (
	"errors"
	"testing"
	"time"

	"morsewell/internal/googleauth"
	"morsewell/internal/models"
	"morsewell/internal/utils"

	"github.com/google/uuid"
)

func TestGoogleLinkOwnershipRaces(t *testing.T) {
	db := postgresTestDB(t)
	for _, sameSubject := range []bool{false, true} {
		first, second := postgresTestUser(t, db, ""), postgresTestUser(t, db, "")
		users := []models.User{first, first}
		subjects := []string{uuid.NewString(), uuid.NewString()}
		if sameSubject {
			users[1], subjects[1] = second, subjects[0]
		}
		start := make(chan struct{})
		result := make(chan error, 2)
		for i := range users {
			go func() {
				<-start
				result <- linkGoogleIdentity(t.Context(), db, &users[i], subjects[i], time.Now().Add(time.Minute))
			}()
		}
		close(start)
		a, b := <-result, <-result
		if !((a == nil && errors.Is(b, errGoogleAccountConflict)) || (b == nil && errors.Is(a, errGoogleAccountConflict))) {
			t.Fatalf("sameSubject=%t: want one link and one conflict, got %v, %v", sameSubject, a, b)
		}
	}
}

func TestGoogleLinkRechecksOwnerProofAndHonorsTombstone(t *testing.T) {
	db := postgresTestDB(t)
	user := postgresTestUser(t, db, "")
	subject := uuid.NewString()
	expires := time.Now().Add(time.Minute)
	stale := user
	stale.Password = "old-hash"
	if err := linkGoogleIdentity(t.Context(), db, &stale, subject, expires); !errors.Is(err, utils.ErrCredentialsChanged) {
		t.Fatalf("stale password: %v", err)
	}
	if err := linkGoogleIdentity(t.Context(), db, &user, subject, time.Now().Add(-time.Minute)); !errors.Is(err, googleauth.ErrInvalidCredential) {
		t.Fatalf("expired under lock: %v", err)
	}
	if err := linkGoogleIdentity(t.Context(), db, &user, subject, expires); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("user_id = ? AND subject = ?", user.ID, subject).Delete(&models.UserIdentity{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := linkGoogleIdentity(t.Context(), db, &user, subject, expires); !errors.Is(err, errGoogleAccountConflict) {
		t.Fatalf("reserved identity: %v", err)
	}
}
