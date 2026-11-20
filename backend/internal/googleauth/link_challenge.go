package googleauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const linkPurpose = "morsewell/google-link"
const deletePurpose = "morsewell/delete-account"

// Each challenge purpose has a different signing key from access JWTs and from
// other challenges. Proof for one account operation cannot authorize another.
func challengeKey(secret []byte, purpose string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(purpose))
	return mac.Sum(nil)
}

func LinkNonce(challenge string) string {
	digest := sha256.Sum256([]byte(challenge))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func NewLinkChallenge(secret []byte, userID uuid.UUID, now time.Time) (string, error) {
	return newChallenge(secret, userID, now, linkPurpose)
}

func NewDeletionChallenge(secret []byte, userID uuid.UUID, now time.Time) (string, error) {
	return newChallenge(secret, userID, now, deletePurpose)
}

func newChallenge(secret []byte, userID uuid.UUID, now time.Time, purpose string) (string, error) {
	id, err := uuid.NewRandom()
	if err != nil {
		return "", err
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Issuer: purpose, Subject: userID.String(), ID: id.String(),
		ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
	}).SignedString(challengeKey(secret, purpose))
}

func ValidateLinkChallenge(secret []byte, challenge string, userID uuid.UUID, now time.Time) (time.Time, error) {
	return validateChallenge(secret, challenge, userID, now, linkPurpose)
}

func ValidateDeletionChallenge(secret []byte, challenge string, userID uuid.UUID, now time.Time) (time.Time, error) {
	return validateChallenge(secret, challenge, userID, now, deletePurpose)
}

func validateChallenge(secret []byte, challenge string, userID uuid.UUID, now time.Time, purpose string) (time.Time, error) {
	claims := &jwt.RegisteredClaims{}
	_, err := jwt.ParseWithClaims(challenge, claims, func(*jwt.Token) (any, error) {
		return challengeKey(secret, purpose), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(purpose), jwt.WithSubject(userID.String()),
		jwt.WithExpirationRequired(), jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil || claims.ID == "" {
		return time.Time{}, ErrInvalidCredential
	}
	return claims.ExpiresAt.Time, nil
}
