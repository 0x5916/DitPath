package common

import "github.com/golang-jwt/jwt/v5"

type AccessClaims struct {
	UserID string `json:"sub"`
	jwt.RegisteredClaims
}
