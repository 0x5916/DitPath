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

// The link proof is signed in a separate key domain from access JWTs. It can
// only authorize a Google linking ceremony for this particular account.
func linkKey(secret []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(linkPurpose))
	return mac.Sum(nil)
}

func LinkNonce(challenge string) string {
	digest := sha256.Sum256([]byte(challenge))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func NewLinkChallenge(secret []byte, userID uuid.UUID, now time.Time) (string, error) {
	id, err := uuid.NewRandom()
	if err != nil {
		return "", err
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Issuer: linkPurpose, Subject: userID.String(), ID: id.String(),
		ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
	}).SignedString(linkKey(secret))
}

func ValidateLinkChallenge(secret []byte, challenge string, userID uuid.UUID, now time.Time) (time.Time, error) {
	claims := &jwt.RegisteredClaims{}
	_, err := jwt.ParseWithClaims(challenge, claims, func(*jwt.Token) (any, error) {
		return linkKey(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(linkPurpose), jwt.WithSubject(userID.String()),
		jwt.WithExpirationRequired(), jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil || claims.ID == "" {
		return time.Time{}, ErrInvalidCredential
	}
	return claims.ExpiresAt.Time, nil
}
