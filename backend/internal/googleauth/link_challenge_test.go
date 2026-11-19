package googleauth

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestLinkChallengeScopeAndLifetime(t *testing.T) {
	secret := []byte("challenge-test-key")
	owner := uuid.New()
	now := time.Now().Truncate(time.Second)
	proof, err := NewLinkChallenge(secret, owner, now)
	if err != nil {
		t.Fatal(err)
	}
	again, err := NewLinkChallenge(secret, owner, now)
	if err != nil || again == proof {
		t.Fatal("each intent requires a fresh proof")
	}
	if raw, err := base64.RawURLEncoding.DecodeString(LinkNonce(proof)); err != nil || len(raw) != 32 {
		t.Fatal("Google nonce must be 32 base64url-encoded bytes")
	}
	expires, err := ValidateLinkChallenge(secret, proof, owner, now)
	if err != nil || !expires.Equal(now.Add(5*time.Minute)) {
		t.Fatalf("unexpected expiry: %v %v", expires, err)
	}
	if _, err := ValidateLinkChallenge(secret, proof, owner, expires); err == nil {
		t.Fatal("accepted expired proof")
	}
	if _, err := ValidateLinkChallenge(secret, proof, uuid.New(), now); err == nil {
		t.Fatal("accepted another account's proof")
	}
	// A bearer signed with the app key must fail even with matching purpose/claims.
	bearer, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject: owner.String(), Issuer: linkPurpose, ExpiresAt: jwt.NewNumericDate(expires), ID: uuid.NewString(),
	}).SignedString(secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateLinkChallenge(secret, bearer, owner, now); err == nil {
		t.Fatal("accepted a bearer as a link proof")
	}
}
