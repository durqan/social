package messagecrypto

import (
	"errors"
	"testing"
)

func TestValidateProductionKeyRejectsMissingKey(t *testing.T) {
	t.Setenv(EnvKey, "")

	err := ValidateProductionKey()
	if !errors.Is(err, ErrMissingKey) {
		t.Fatalf("ValidateProductionKey error = %v, want %v", err, ErrMissingKey)
	}
}

func TestValidateProductionKeyRejectsWrongKeyLength(t *testing.T) {
	t.Setenv(EnvKey, "c2hvcnQ=")

	err := ValidateProductionKey()
	if !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("ValidateProductionKey error = %v, want %v", err, ErrInvalidKey)
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	t.Setenv(EnvKey, "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")

	cipher, err := NewFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, nonce, err := cipher.Encrypt("hello")
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext == "hello" || ciphertext == "" || nonce == "" {
		t.Fatalf("unexpected encrypted values: ciphertext=%q nonce=%q", ciphertext, nonce)
	}
	plaintext, err := cipher.Decrypt(ciphertext, nonce)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "hello" {
		t.Fatalf("plaintext = %q, want hello", plaintext)
	}
}
