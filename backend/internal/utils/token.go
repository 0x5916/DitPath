package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"opencw/internal/configs"
	"opencw/internal/models"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var ErrCredentialsChanged = errors.New("account credentials changed")

// IssueTokenPair fences the password snapshot checked before acquiring the
// account lock, so an old login cannot recreate sessions after password change.
func IssueTokenPair(db *gorm.DB, userID uuid.UUID, expectedHash string, now time.Time) (string, string, error) {
	var raw, access string
	err := WithLockedUser(db.Statement.Context, db, userID, func(tx *gorm.DB, user *models.User) error {
		if user.Password != expectedHash {
			return ErrCredentialsChanged
		}
		var hashed string
		var err error
		raw, hashed, err = GenerateRefreshToken()
		if err != nil {
			return err
		}
		access, err = GenerateAccessToken(userID, now)
		if err != nil {
			return err
		}
		return tx.Create(&models.RefreshToken{UserID: userID, Token: hashed,
			ExpiresAt: now.Add(time.Hour * 24 * 30)}).Error
	})
	if err != nil {
		return "", "", err
	}
	return raw, access, nil
}

func GenerateRefreshToken() (raw, hashed string, err error) {
	b, err := GenerateRandomSalt(32)
	if err != nil {
		return
	}

	raw = hex.EncodeToString(b)
	hashed = HashByteRefreshToken(b)
	return
}

func HashStringRefreshToken(token string) (hashed string, err error) {
	b, err := hex.DecodeString(token)
	if err != nil {
		return
	}

	hashed = HashByteRefreshToken(b)
	return
}

func HashByteRefreshToken(token []byte) string {
	h := sha256.Sum256(token)
	return hex.EncodeToString(h[:])
}

func GenerateRandomSalt(n int) (result []byte, err error) {
	result = make([]byte, n)
	_, err = rand.Read(result)
	return
}

func GenerateAccessToken(userID uuid.UUID, now time.Time) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   userID.String(),
		Issuer:    "opencw/.net",
		ID:        uuid.NewString(),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute * 15)),
	}).SignedString(configs.App.JWTSecret)
}
