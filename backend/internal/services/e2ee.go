package services

import (
	"encoding/json"
	"errors"
	"strings"

	"tester/internal/models"
	"tester/internal/repository"

	"gorm.io/gorm"
)

const MaxEncryptedKeyBackupLength = 256 * 1024

var ErrEncryptedKeyBackupInvalid = errors.New("encrypted key backup is invalid")

type E2EEPublicStatus struct {
	Enabled   bool
	PublicKey string
}

func NormalizeEncryptedKeyBackup(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > MaxEncryptedKeyBackupLength {
		return "", ErrEncryptedKeyBackupInvalid
	}
	if publicKeyFromBackupBundle(value) == "" {
		return "", ErrEncryptedKeyBackupInvalid
	}
	return value, nil
}

func SaveEncryptedKeyBackup(db *gorm.DB, userID uint, encryptedMasterKey string) error {
	normalized, err := NormalizeEncryptedKeyBackup(encryptedMasterKey)
	if err != nil {
		return err
	}

	return repository.UpsertEncryptedKeyBackup(db, &models.EncryptedKeyBackup{
		UserID:             userID,
		EncryptedMasterKey: normalized,
	})
}

func DeleteEncryptedKeyBackup(db *gorm.DB, userID uint) error {
	return repository.DeleteEncryptedKeyBackupByUserID(db, userID)
}

func E2EEPublicStatusForUser(db *gorm.DB, userID uint) (E2EEPublicStatus, error) {
	backup, err := repository.GetEncryptedKeyBackupByUserID(db, userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return E2EEPublicStatus{Enabled: false}, nil
	}
	if err != nil {
		return E2EEPublicStatus{}, err
	}

	publicKey := publicKeyFromBackupBundle(backup.EncryptedMasterKey)
	if publicKey == "" {
		return E2EEPublicStatus{Enabled: false}, nil
	}
	return E2EEPublicStatus{Enabled: true, PublicKey: publicKey}, nil
}

func publicKeyFromBackupBundle(value string) string {
	var payload struct {
		PublicKey      string `json:"publicKey"`
		PublicKeySnake string `json:"public_key"`
	}
	if err := json.Unmarshal([]byte(value), &payload); err != nil {
		return ""
	}
	if strings.TrimSpace(payload.PublicKey) != "" {
		return strings.TrimSpace(payload.PublicKey)
	}
	return strings.TrimSpace(payload.PublicKeySnake)
}
