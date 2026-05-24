package utils

import (
	"crypto/rand"
	"encoding/hex"
)

func GenerateSecureToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func GenerateVerificationToken() (string, error) {
	return GenerateSecureToken()
}
