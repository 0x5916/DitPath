package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"opencw/internal/configs"
	"opencw/internal/models"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func IssueTokenPair(DB *gorm.DB, userID uuid.UUID, now time.Time) (rawToken, accessToken string, err error) {
	rawToken, hashedToken, err := GenerateRefreshToken()
	if err != nil {
		return
	}

	refreshToken := models.RefreshToken{
		UserID:    userID,
		Token:     hashedToken,
		ExpiresAt: now.Add(time.Hour * 24 * 30),
	}
	err = DB.Create(&refreshToken).Error
	if err != nil {
		return
	}

	accessToken, err = GenerateAccessToken(userID, now)
	return
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
