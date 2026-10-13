package utils

import (
	"runtime"

	"github.com/alexedwards/argon2id"
)

var params = &argon2id.Params{
	Memory:      64 * 1024, // 64 MB
	Iterations:  1,
	Parallelism: uint8(runtime.NumCPU()),
	SaltLength:  16,
	KeyLength:   32,
}

func HashPassword(password string) (string, error) {
	return argon2id.CreateHash(password, params)
}

func ComparePasswordAndHash(password, hash string) (bool, error) {
	return argon2id.ComparePasswordAndHash(password, hash)
}
