package messagecrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
)

const EnvKey = "MESSAGE_ENCRYPTION_KEY"

var (
	ErrMissingKey = errors.New("MESSAGE_ENCRYPTION_KEY is required")
	ErrInvalidKey = errors.New("MESSAGE_ENCRYPTION_KEY must be base64 encoded 32 bytes")
)

type Cipher struct {
	aead cipher.AEAD
}

func NewFromEnv() (*Cipher, error) {
	raw := strings.TrimSpace(os.Getenv(EnvKey))
	if raw == "" {
		return nil, ErrMissingKey
	}

	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		key, err = base64.RawStdEncoding.DecodeString(raw)
	}
	if err != nil || len(key) != 32 {
		return nil, ErrInvalidKey
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{aead: aead}, nil
}

func ValidateProductionKey() error {
	if _, err := NewFromEnv(); err != nil {
		return fmt.Errorf("message encryption is not configured: %w", err)
	}
	return nil
}

func (c *Cipher) Decrypt(ciphertextValue string, nonceValue string) (string, error) {
	ciphertextValue = strings.TrimSpace(ciphertextValue)
	nonceValue = strings.TrimSpace(nonceValue)
	if ciphertextValue == "" || nonceValue == "" {
		return "", errors.New("encrypted message fields are empty")
	}

	ciphertextBytes, err := base64.StdEncoding.DecodeString(ciphertextValue)
	if err != nil {
		ciphertextBytes, err = base64.RawStdEncoding.DecodeString(ciphertextValue)
	}
	if err != nil {
		return "", err
	}

	nonce, err := base64.StdEncoding.DecodeString(nonceValue)
	if err != nil {
		nonce, err = base64.RawStdEncoding.DecodeString(nonceValue)
	}
	if err != nil {
		return "", err
	}
	if len(nonce) != c.aead.NonceSize() {
		return "", errors.New("encrypted message nonce has invalid size")
	}

	plaintext, err := c.aead.Open(nil, nonce, ciphertextBytes, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
