package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"path/filepath"
	"strconv"
	"strings"

	"tester/internal/cache"
	"tester/internal/dto"
	"tester/internal/messagecrypto"
	"tester/internal/models"
	"tester/internal/repository"
	"tester/internal/storage"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrMessageContentRequired             = errors.New("message content or attachment is required")
	ErrMessageContentTooLong              = errors.New("message content is too long")
	ErrMessageForbidden                   = errors.New("message forbidden")
	ErrMessageNotFriends                  = errors.New("message requires accepted friendship")
	ErrMessageInvalidReply                = errors.New("reply message is outside this conversation")
	ErrMessageInvalidPin                  = errors.New("pin message is outside this conversation or deleted")
	ErrMessageInvalidEncryption           = errors.New("message encryption payload is invalid")
	ErrMessageEncryptedForwardUnsupported = errors.New("encrypted messages must be forwarded by the client")
	ErrMessageEncryptionUnavailable       = errors.New("message encryption is not configured")
	ErrMessageInvalidReaction             = errors.New("invalid message reaction")
)

const (
	MaxMessageContentLength    = 1000
	MaxMessageCiphertextLength = 256 * 1024
	MaxMessageNonceLength      = 256
	MessageDecryptFailureText  = "Не удалось расшифровать сообщение"
	e2eeMessageAlgorithm       = "AES-256-GCM"
	e2eeMessageKeyAlgorithm    = "RSA-OAEP-SHA-256"
)

var allowedMessageReactions = map[string]struct{}{
	"👍":  {},
	"❤️": {},
	"😂":  {},
	"😮":  {},
	"😢":  {},
	"🔥":  {},
}

type MessageDeleteMode string

const (
	MessageDeleteForMe       MessageDeleteMode = "for_me"
	MessageDeleteForEveryone MessageDeleteMode = "for_everyone"
)

type MessageEncryptionInput struct {
	Version    int
	Ciphertext string
	Nonce      string
}

type clientE2EEMessageEnvelope struct {
	Version int               `json:"version"`
	Alg     string            `json:"alg"`
	KeyAlg  string            `json:"keyAlg"`
	Data    string            `json:"data"`
	Keys    map[string]string `json:"keys"`
}

type EncryptedForwardInput struct {
	ToUserID    uint
	Encryption  MessageEncryptionInput
	Attachments []models.MessageAttachment
}

type ConversationE2EEPolicy struct {
	SenderEnabled    bool
	RecipientEnabled bool
	Required         bool
	Ready            bool
}

func (input MessageEncryptionInput) Enabled() bool {
	return input.Version > 0 || strings.TrimSpace(input.Ciphertext) != "" || strings.TrimSpace(input.Nonce) != ""
}

func ParseMessageDeleteMode(raw string) (MessageDeleteMode, bool) {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "", "for_me", "delete_for_me", "me":
		return MessageDeleteForMe, true
	case "for_everyone", "delete_for_everyone", "everyone":
		return MessageDeleteForEveryone, true
	default:
		return "", false
	}
}

func E2EEPolicyForConversation(db *gorm.DB, senderID uint, recipientID uint) (ConversationE2EEPolicy, error) {
	senderStatus, err := E2EEPublicStatusForUser(db, senderID)
	if err != nil {
		return ConversationE2EEPolicy{}, err
	}
	recipientStatus, err := E2EEPublicStatusForUser(db, recipientID)
	if err != nil {
		return ConversationE2EEPolicy{}, err
	}

	// Product policy: E2EE is conversation-wide for 1:1 chats.
	// If either participant has enabled E2EE, the backend must not accept new
	// plaintext message bodies or plaintext attachments for that pair. A new
	// encrypted payload is accepted only when both participants are E2EE-enabled.
	// TODO: multi-device/prekey support should replace this backup/public-key
	// readiness check with per-device recipient key availability.
	required := senderStatus.Enabled || recipientStatus.Enabled
	ready := senderStatus.Enabled && recipientStatus.Enabled
	return ConversationE2EEPolicy{
		SenderEnabled:    senderStatus.Enabled,
		RecipientEnabled: recipientStatus.Enabled,
		Required:         required,
		Ready:            ready,
	}, nil
}

func SendMessage(db *gorm.DB, fromID, toID uint, content string, attachments []models.MessageAttachment, replyToMessageID *uint, encryption MessageEncryptionInput) (models.Message, error) {
	normalizedContent, err := normalizeMessageContent(content, len(attachments), encryption)
	if err != nil {
		return models.Message{}, err
	}

	status, err := repository.GetFriendshipStatus(db, fromID, toID)
	if err != nil {
		return models.Message{}, err
	}
	if status != "accepted" {
		return models.Message{}, ErrMessageNotFriends
	}

	e2eePolicy, err := E2EEPolicyForConversation(db, fromID, toID)
	if err != nil {
		return models.Message{}, err
	}
	normalizedEncryption, err := normalizeClientMessageEncryption(encryption)
	if err != nil {
		return models.Message{}, err
	}
	if err := validateMessageEncryptionPolicy(e2eePolicy, normalizedContent, normalizedEncryption, attachments); err != nil {
		return models.Message{}, err
	}
	if err := validateEncryptedAttachmentKeysForParticipants(attachments, fromID, toID); err != nil {
		return models.Message{}, err
	}

	storedContent, storedEncryption, err := messageContentForStorage(normalizedContent, normalizedEncryption)
	if err != nil {
		return models.Message{}, err
	}

	if replyToMessageID != nil {
		if _, err := repository.GetMessageInConversation(db, *replyToMessageID, fromID, toID); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return models.Message{}, ErrMessageInvalidReply
			}
			return models.Message{}, err
		}
	}

	message := models.Message{
		FromID:            fromID,
		ToID:              toID,
		Content:           storedContent,
		EncryptionVersion: storedEncryption.Version,
		Ciphertext:        storedEncryption.Ciphertext,
		Nonce:             storedEncryption.Nonce,
		ReplyToMessageID:  replyToMessageID,
	}

	err = db.Transaction(func(tx *gorm.DB) error {
		if err := repository.CreateMessage(tx, &message); err != nil {
			return err
		}

		for i := range attachments {
			attachments[i].MessageID = message.ID
		}

		if err := repository.CreateMessageAttachments(tx, attachments); err != nil {
			return err
		}

		if !encryption.Enabled() {
			if preview, ok := FirstSupportedVideoLinkPreview(normalizedContent); ok {
				preview.MessageID = message.ID
				if err := tx.Create(preview).Error; err != nil {
					return err
				}
			}
		}

		fullMessage, err := LoadMessage(tx, message.ID)
		if err != nil {
			return err
		}
		message = fullMessage

		if err := EnqueueNotificationOutbox(tx, dto.CreateNotificationReq{
			Action:         "create",
			RecipientID:    toID,
			ActorID:        fromID,
			Type:           dto.NotificationTypeMessage,
			EntityID:       message.ID,
			ConversationID: fromID,
		}); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return models.Message{}, err
	}
	if _, err := ForceUserActivity(db, fromID); err != nil {
		log.Printf("failed to update sender activity: %v", err)
	}
	if message.LinkPreview != nil {
		EnrichMessageLinkPreviewAsync(db, message.ID, message.LinkPreview.ID)
	}
	InvalidateMessageCaches()
	return message, nil
}

func ForwardMessage(db *gorm.DB, userID uint, sourceMessageID uint, toIDs []uint) ([]models.Message, error) {
	if len(toIDs) == 0 {
		return nil, ErrMessageContentRequired
	}

	source, err := repository.GetMessageByIDForUser(db, sourceMessageID, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMessageForbidden
		}
		return nil, err
	}
	if messageHasEncryptedAttachments(source) {
		return nil, ErrMessageEncryptedForwardUnsupported
	}
	source = decryptMessageForService(source)

	messages := make([]models.Message, 0, len(toIDs))
	err = db.Transaction(func(tx *gorm.DB) error {
		for _, toID := range toIDs {
			if toID == 0 || toID == userID {
				return ErrMessageForbidden
			}

			status, err := repository.GetFriendshipStatus(tx, userID, toID)
			if err != nil {
				return err
			}
			if status != "accepted" {
				return ErrMessageNotFriends
			}

			var replyToMessageID *uint
			if source.ReplyToMessageID != nil {
				if _, err := repository.GetMessageInConversation(tx, *source.ReplyToMessageID, userID, toID); err == nil {
					id := *source.ReplyToMessageID
					replyToMessageID = &id
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			}

			sourceID := source.ID
			sourceUserID := source.FromID
			storedContent, storedEncryption, err := encryptedContentForStorage(decryptedMessageContent(source))
			if err != nil {
				return err
			}
			message := models.Message{
				FromID:                 userID,
				ToID:                   toID,
				Content:                storedContent,
				EncryptionVersion:      storedEncryption.Version,
				Ciphertext:             storedEncryption.Ciphertext,
				Nonce:                  storedEncryption.Nonce,
				ReplyToMessageID:       replyToMessageID,
				ForwardedFromMessageID: &sourceID,
				ForwardedFromUserID:    &sourceUserID,
			}

			if err := repository.CreateMessage(tx, &message); err != nil {
				return err
			}

			attachments := make([]models.MessageAttachment, 0, len(source.Attachments))
			for _, attachment := range source.Attachments {
				attachments = append(attachments, models.MessageAttachment{
					MessageID:         message.ID,
					FileURL:           attachment.FileURL,
					FileType:          attachment.FileType,
					OriginalFilename:  attachment.OriginalFilename,
					ContentType:       attachment.ContentType,
					Width:             attachment.Width,
					Height:            attachment.Height,
					DurationSeconds:   attachment.DurationSeconds,
					Size:              attachment.Size,
					EncryptionVersion: attachment.EncryptionVersion,
					EncryptedFileKey:  attachment.EncryptedFileKey,
					FileNonce:         attachment.FileNonce,
					EncryptedMetadata: attachment.EncryptedMetadata,
				})
			}
			if err := repository.CreateMessageAttachments(tx, attachments); err != nil {
				return err
			}

			fullMessage, err := LoadMessage(tx, message.ID)
			if err != nil {
				return err
			}
			if err := EnqueueNotificationOutbox(tx, dto.CreateNotificationReq{
				Action:         "create",
				RecipientID:    toID,
				ActorID:        userID,
				Type:           dto.NotificationTypeMessage,
				EntityID:       fullMessage.ID,
				ConversationID: userID,
			}); err != nil {
				return err
			}
			messages = append(messages, fullMessage)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	InvalidateMessageCaches()
	return messages, nil
}

func ForwardEncryptedMessage(db *gorm.DB, userID uint, sourceMessageID uint, inputs []EncryptedForwardInput) ([]models.Message, error) {
	if len(inputs) == 0 {
		return nil, ErrMessageContentRequired
	}

	source, err := repository.GetMessageByIDForUser(db, sourceMessageID, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMessageForbidden
		}
		return nil, err
	}
	sourceHasEncryptedContent := source.EncryptionVersion > 0
	sourceHasEncryptedAttachments := messageHasEncryptedAttachments(source)
	if !sourceHasEncryptedContent && !sourceHasEncryptedAttachments {
		return nil, ErrMessageInvalidEncryption
	}

	messages := make([]models.Message, 0, len(inputs))
	err = db.Transaction(func(tx *gorm.DB) error {
		for _, input := range inputs {
			toID := input.ToUserID
			if toID == 0 || toID == userID {
				return ErrMessageForbidden
			}
			if sourceHasEncryptedContent && !input.Encryption.Enabled() {
				return ErrMessageInvalidEncryption
			}
			if sourceHasEncryptedAttachments && len(input.Attachments) != len(source.Attachments) {
				return ErrMessageInvalidEncryption
			}
			normalizedEncryption, err := normalizeClientMessageEncryption(input.Encryption)
			if err != nil {
				return err
			}

			status, err := repository.GetFriendshipStatus(tx, userID, toID)
			if err != nil {
				return err
			}
			if status != "accepted" {
				return ErrMessageNotFriends
			}
			e2eePolicy, err := E2EEPolicyForConversation(tx, userID, toID)
			if err != nil {
				return err
			}
			if err := validateMessageEncryptionPolicy(e2eePolicy, "", normalizedEncryption, input.Attachments); err != nil {
				return err
			}
			if err := validateEncryptedAttachmentKeysForParticipants(input.Attachments, userID, toID); err != nil {
				return err
			}

			sourceID := source.ID
			sourceUserID := source.FromID
			message := models.Message{
				FromID:                 userID,
				ToID:                   toID,
				Content:                "",
				EncryptionVersion:      normalizedEncryption.Version,
				Ciphertext:             normalizedEncryption.Ciphertext,
				Nonce:                  normalizedEncryption.Nonce,
				ForwardedFromMessageID: &sourceID,
				ForwardedFromUserID:    &sourceUserID,
			}

			if err := repository.CreateMessage(tx, &message); err != nil {
				return err
			}

			attachments := make([]models.MessageAttachment, 0, len(input.Attachments))
			for _, attachment := range input.Attachments {
				fileURL := attachment.FileURL
				filename := filepath.Base(fileURL)
				// For E2EE attachments the client sends the temporary /api/messages/uploads/ URL from the upload step.
				// Convert to the canonical internal storage key (e.g. "encrypted/...") so that
				// KeyFromStoredValue + looksLikeObjectKey + serving via /attachments/:id works.
				if strings.HasPrefix(fileURL, chatUploadURLPrefix) || strings.HasPrefix(fileURL, legacyChatUploadPrefix) {
					if chatEncryptedExtensionFromFilename(filename) != "" {
						fileURL = EncryptedChatUploadKey(filename, userID)
					} else if attachment.FileType == "voice" {
						fileURL = ChatUploadKey(filename, userID)
					} else if attachment.FileType == "video_note" {
						fileURL = VideoNoteUploadKey(filename, userID)
					} else {
						fileURL = ChatUploadKey(filename, userID)
					}
				}
				attachments = append(attachments, models.MessageAttachment{
					MessageID:         message.ID,
					FileURL:           fileURL,
					FileType:          attachment.FileType,
					OriginalFilename:  attachment.OriginalFilename,
					ContentType:       attachment.ContentType,
					Width:             attachment.Width,
					Height:            attachment.Height,
					DurationSeconds:   attachment.DurationSeconds,
					Size:              attachment.Size,
					EncryptionVersion: attachment.EncryptionVersion,
					EncryptedFileKey:  attachment.EncryptedFileKey,
					FileNonce:         attachment.FileNonce,
					EncryptedMetadata: attachment.EncryptedMetadata,
				})
			}
			if err := repository.CreateMessageAttachments(tx, attachments); err != nil {
				return err
			}

			fullMessage, err := LoadMessage(tx, message.ID)
			if err != nil {
				return err
			}
			if err := EnqueueNotificationOutbox(tx, dto.CreateNotificationReq{
				Action:         "create",
				RecipientID:    toID,
				ActorID:        userID,
				Type:           dto.NotificationTypeMessage,
				EntityID:       fullMessage.ID,
				ConversationID: userID,
			}); err != nil {
				return err
			}
			messages = append(messages, fullMessage)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	InvalidateMessageCaches()
	return messages, nil
}

func LoadMessage(db *gorm.DB, messageID uint) (models.Message, error) {
	message, err := repository.GetMessageByID(db, messageID)
	if err != nil {
		return models.Message{}, err
	}
	return *message, nil
}

func GetConversations(db *gorm.DB, userID uint) ([]map[string]interface{}, error) {
	return GetConversationsPage(db, userID, 0, 0)
}

func GetConversationsPage(db *gorm.DB, userID uint, limit int, offset int) ([]map[string]interface{}, error) {
	conversations, err := repository.GetConversationsPage(db, userID, limit, offset)
	if err != nil {
		return nil, err
	}

	for i := range conversations {
		preview := decryptedConversationPreview(conversations[i])
		if preview != "" {
			conversations[i]["last_message"] = preview
		}
		delete(conversations[i], "last_message_id")
		delete(conversations[i], "last_message_content")
		delete(conversations[i], "last_encryption_version")
		delete(conversations[i], "last_ciphertext")
		delete(conversations[i], "last_nonce")
	}

	return conversations, nil
}

func decryptedConversationPreview(conversation map[string]interface{}) string {
	if intFromMap(conversation, "last_encryption_version") <= 0 {
		if content := stringFromMap(conversation, "last_message_content"); strings.TrimSpace(content) != "" {
			return content
		}
		return ""
	}

	message := models.Message{
		ID:                uint(intFromMap(conversation, "last_message_id")),
		EncryptionVersion: intFromMap(conversation, "last_encryption_version"),
		Ciphertext:        stringFromMap(conversation, "last_ciphertext"),
		Nonce:             stringFromMap(conversation, "last_nonce"),
	}
	return DecryptMessageForClient(message).Content
}

func intFromMap(values map[string]interface{}, key string) int {
	switch value := values[key].(type) {
	case int:
		return value
	case int64:
		return int(value)
	case int32:
		return int(value)
	case uint:
		return int(value)
	case uint64:
		return int(value)
	case uint32:
		return int(value)
	case float64:
		return int(value)
	case []byte:
		parsed, _ := strconv.Atoi(string(value))
		return parsed
	case string:
		parsed, _ := strconv.Atoi(value)
		return parsed
	default:
		return 0
	}
}

func stringFromMap(values map[string]interface{}, key string) string {
	switch value := values[key].(type) {
	case string:
		return value
	case []byte:
		return string(value)
	default:
		return ""
	}
}

func ToggleMessageReaction(db *gorm.DB, userID, messageID uint, emoji string) (models.Message, []models.ReactionSummary, uint64, error) {
	emoji = strings.TrimSpace(emoji)
	if _, ok := allowedMessageReactions[emoji]; !ok {
		return models.Message{}, nil, 0, ErrMessageInvalidReaction
	}

	message, err := repository.GetMessageByIDForUser(db, messageID, userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Message{}, nil, 0, ErrMessageForbidden
	}
	if err != nil {
		return models.Message{}, nil, 0, err
	}

	var reactionVersion uint64
	var summaries []models.ReactionSummary
	if err := db.Transaction(func(tx *gorm.DB) error {
		var lockedMessage models.Message
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&lockedMessage, messageID).Error; err != nil {
			return err
		}
		if err := repository.ToggleMessageReaction(tx, messageID, userID, emoji); err != nil {
			return err
		}
		if err := tx.Model(&models.Message{}).
			Where("id = ?", messageID).
			UpdateColumn("reaction_version", gorm.Expr("reaction_version + 1")).Error; err != nil {
			return err
		}
		reactionVersion = lockedMessage.ReactionVersion + 1
		summaries, err = repository.GetReactionSummaries(tx, messageID, userID)
		return err
	}); err != nil {
		return models.Message{}, nil, 0, err
	}

	message.ReactionVersion = reactionVersion
	InvalidateMessageCaches()
	return *message, summaries, reactionVersion, nil
}

func GetPinnedMessage(db *gorm.DB, userID, conversationUserID uint) (*models.PinnedMessage, error) {
	conversationID, err := canonicalConversationForUser(db, userID, conversationUserID)
	if err != nil {
		return nil, err
	}

	pin, err := repository.GetPinnedMessageForUser(db, conversationID, userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return pin, nil
}

func PinMessage(db *gorm.DB, userID, conversationUserID, messageID uint) (*models.PinnedMessage, error) {
	conversationID, err := canonicalConversationForUser(db, userID, conversationUserID)
	if err != nil {
		return nil, err
	}

	message, err := repository.GetMessageInConversation(db, messageID, userID, conversationUserID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrMessageInvalidPin
	}
	if err != nil {
		return nil, err
	}

	pin, err := repository.ReplacePinnedMessage(db, conversationID, message.ID, userID)
	if err != nil {
		return nil, err
	}

	InvalidateMessageCaches()
	return pin, nil
}

func UnpinMessage(db *gorm.DB, userID, conversationUserID uint) (*models.PinnedMessage, error) {
	conversationID, err := canonicalConversationForUser(db, userID, conversationUserID)
	if err != nil {
		return nil, err
	}

	pin, err := repository.GetPinnedMessage(db, conversationID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err := repository.DeletePinnedMessage(db, conversationID); err != nil {
			return nil, err
		}
		InvalidateMessageCaches()
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if err := repository.DeletePinnedMessage(db, conversationID); err != nil {
		return nil, err
	}

	InvalidateMessageCaches()
	return pin, nil
}

func canonicalConversationForUser(db *gorm.DB, userID, conversationUserID uint) (uint, error) {
	participant, err := repository.ConversationExistsForUser(db, userID, conversationUserID)
	if err != nil {
		return 0, err
	}
	if !participant {
		return 0, ErrMessageForbidden
	}

	conversationID, err := repository.CanonicalConversationID(db, userID, conversationUserID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, ErrMessageForbidden
	}
	if err != nil {
		return 0, err
	}
	return conversationID, nil
}

func UpdateMessage(db *gorm.DB, userID, messageID uint, content string, encryption MessageEncryptionInput) (models.Message, error) {
	message, err := repository.GetMessageByID(db, messageID)
	if err != nil {
		return models.Message{}, err
	}

	if message.FromID != userID {
		return models.Message{}, ErrMessageForbidden
	}

	normalizedContent, err := normalizeMessageContent(content, 0, encryption)
	if err != nil {
		return models.Message{}, err
	}

	e2eePolicy, err := E2EEPolicyForConversation(db, message.FromID, message.ToID)
	if err != nil {
		return models.Message{}, err
	}
	normalizedEncryption, err := normalizeClientMessageEncryption(encryption)
	if err != nil {
		return models.Message{}, err
	}
	if err := validateMessageEncryptionPolicy(e2eePolicy, normalizedContent, normalizedEncryption, nil); err != nil {
		return models.Message{}, err
	}
	storedContent, storedEncryption, err := messageContentForStorage(normalizedContent, normalizedEncryption)
	if err != nil {
		return models.Message{}, err
	}

	message.Content = storedContent
	message.EncryptionVersion = storedEncryption.Version
	message.Ciphertext = storedEncryption.Ciphertext
	message.Nonce = storedEncryption.Nonce
	if err := repository.UpdateMessage(db, message); err != nil {
		return models.Message{}, err
	}

	updated, err := LoadMessage(db, messageID)
	if err != nil {
		return models.Message{}, err
	}
	InvalidateMessageCaches()
	return updated, nil
}

func normalizeMessageContent(content string, attachmentCount int, encryption MessageEncryptionInput) (string, error) {
	if encryption.Enabled() {
		if strings.TrimSpace(content) != "" {
			return "", ErrMessageInvalidEncryption
		}
		return "", nil
	}

	content = strings.TrimSpace(content)
	if content == "" && attachmentCount == 0 {
		return "", ErrMessageContentRequired
	}
	if len([]rune(content)) > MaxMessageContentLength {
		return "", ErrMessageContentTooLong
	}
	return content, nil
}

func normalizeClientMessageEncryption(encryption MessageEncryptionInput) (MessageEncryptionInput, error) {
	if !encryption.Enabled() {
		return MessageEncryptionInput{}, nil
	}

	normalized := MessageEncryptionInput{
		Version:    encryption.Version,
		Ciphertext: strings.TrimSpace(encryption.Ciphertext),
		Nonce:      strings.TrimSpace(encryption.Nonce),
	}
	if normalized.Version != 1 ||
		normalized.Ciphertext == "" ||
		normalized.Nonce == "" ||
		len(normalized.Ciphertext) > MaxMessageCiphertextLength ||
		len(normalized.Nonce) > MaxMessageNonceLength {
		return MessageEncryptionInput{}, ErrMessageInvalidEncryption
	}
	if _, err := decodeBase64Strict(normalized.Nonce); err != nil {
		return MessageEncryptionInput{}, ErrMessageInvalidEncryption
	}
	if err := validateClientE2EEMessageEnvelope(normalized.Ciphertext); err != nil {
		return MessageEncryptionInput{}, ErrMessageInvalidEncryption
	}
	return normalized, nil
}

func validateClientE2EEMessageEnvelope(value string) error {
	var envelope clientE2EEMessageEnvelope
	if err := json.Unmarshal([]byte(value), &envelope); err != nil {
		return err
	}
	if envelope.Version != 1 ||
		envelope.Alg != e2eeMessageAlgorithm ||
		envelope.KeyAlg != e2eeMessageKeyAlgorithm ||
		envelope.Data == "" ||
		len(envelope.Keys) == 0 {
		return ErrMessageInvalidEncryption
	}
	if _, err := decodeBase64Strict(envelope.Data); err != nil {
		return err
	}
	for userID, wrappedKey := range envelope.Keys {
		if strings.TrimSpace(userID) == "" || strings.TrimSpace(wrappedKey) == "" {
			return ErrMessageInvalidEncryption
		}
		if _, err := decodeBase64Strict(wrappedKey); err != nil {
			return err
		}
	}
	return nil
}

func isClientE2EEMessageCiphertext(value string) bool {
	return validateClientE2EEMessageEnvelope(strings.TrimSpace(value)) == nil
}

func decodeBase64Strict(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err == nil {
		return decoded, nil
	}
	return base64.RawStdEncoding.DecodeString(value)
}

func validateMessageEncryptionPolicy(policy ConversationE2EEPolicy, plaintextContent string, encryption MessageEncryptionInput, attachments []models.MessageAttachment) error {
	hasEncryptedAttachments := messageAttachmentsHaveEncryption(attachments)
	hasPlaintextAttachments := attachmentsHavePlaintext(attachments)
	hasEncryptedPayload := encryption.Enabled() || hasEncryptedAttachments

	if hasEncryptedPayload && !policy.Ready {
		return ErrMessageInvalidEncryption
	}
	if !policy.Required {
		return nil
	}
	if !policy.Ready {
		return ErrMessageInvalidEncryption
	}
	if strings.TrimSpace(plaintextContent) != "" || hasPlaintextAttachments {
		return ErrMessageInvalidEncryption
	}
	return nil
}

func validateEncryptedAttachmentKeysForParticipants(attachments []models.MessageAttachment, fromID uint, toID uint) error {
	if len(attachments) == 0 {
		return nil
	}
	fromKey := strconv.FormatUint(uint64(fromID), 10)
	toKey := strconv.FormatUint(uint64(toID), 10)
	for _, attachment := range attachments {
		if attachment.EncryptionVersion <= 0 {
			continue
		}
		envelope, err := parseEncryptedAttachmentKeyEnvelope(attachment.EncryptedFileKey)
		if err != nil {
			return ErrMessageInvalidEncryption
		}
		if strings.TrimSpace(envelope.Keys[fromKey]) == "" || strings.TrimSpace(envelope.Keys[toKey]) == "" {
			return ErrMessageInvalidEncryption
		}
	}
	return nil
}

func messageContentForStorage(content string, encryption MessageEncryptionInput) (string, MessageEncryptionInput, error) {
	if encryption.Enabled() {
		return "", encryption, nil
	}
	return encryptedContentForStorage(content)
}

func encryptedContentForStorage(content string) (string, MessageEncryptionInput, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", MessageEncryptionInput{}, nil
	}

	cipher, err := messagecrypto.NewFromEnv()
	if err != nil {
		return "", MessageEncryptionInput{}, ErrMessageEncryptionUnavailable
	}
	ciphertext, nonce, err := cipher.Encrypt(content)
	if err != nil {
		return "", MessageEncryptionInput{}, err
	}
	return "", MessageEncryptionInput{
		Version:    1,
		Ciphertext: ciphertext,
		Nonce:      nonce,
	}, nil
}

func decryptMessageForService(message *models.Message) *models.Message {
	if message == nil {
		return nil
	}
	decrypted := DecryptMessageForClient(*message)
	return &decrypted
}

func decryptedMessageContent(message *models.Message) string {
	if message == nil {
		return ""
	}
	decrypted := DecryptMessageForClient(*message)
	return decrypted.Content
}

func DecryptMessageForClient(message models.Message) models.Message {
	message = decryptSingleMessageForClient(message)

	if message.ReplyToMessage != nil {
		reply := DecryptMessageForClient(*message.ReplyToMessage)
		message.ReplyToMessage = &reply
	}
	if message.ForwardedFromMessage != nil {
		forwarded := DecryptMessageForClient(*message.ForwardedFromMessage)
		message.ForwardedFromMessage = &forwarded
	}

	return message
}

func DecryptMessagesForClient(messages []models.Message) []models.Message {
	for i := range messages {
		messages[i] = DecryptMessageForClient(messages[i])
	}
	return messages
}

func decryptSingleMessageForClient(message models.Message) models.Message {
	if message.EncryptionVersion <= 0 {
		return message
	}
	if isClientE2EEMessageCiphertext(message.Ciphertext) {
		return message
	}

	cipher, err := messagecrypto.NewFromEnv()
	if err != nil {
		log.Printf("message decrypt failed: message_id=%d error=%v", message.ID, err)
		message.Content = MessageDecryptFailureText
	} else if plaintext, err := cipher.Decrypt(message.Ciphertext, message.Nonce); err != nil {
		log.Printf("message decrypt failed: message_id=%d error=%v", message.ID, err)
		message.Content = MessageDecryptFailureText
	} else {
		message.Content = plaintext
	}

	message.EncryptionVersion = 0
	message.Ciphertext = ""
	message.Nonce = ""
	return message
}

func DeleteMessageForUser(db *gorm.DB, userID, messageID uint, mode MessageDeleteMode) (models.Message, error) {
	message, err := repository.GetMessageByIDForDelete(db, messageID, mode == MessageDeleteForEveryone)
	if err != nil {
		return models.Message{}, err
	}

	if message.FromID != userID && message.ToID != userID {
		return models.Message{}, ErrMessageForbidden
	}

	switch mode {
	case MessageDeleteForEveryone:
		if message.FromID != userID {
			return models.Message{}, ErrMessageForbidden
		}
		if message.DeletedAt.Valid {
			return *message, nil
		}

		keys := attachmentKeys(message.Attachments)
		err = db.Transaction(func(tx *gorm.DB) error {
			if err := repository.DeleteMessageForEveryone(tx, messageID, userID); err != nil {
				return err
			}
			if err := repository.DeletePinnedMessagesByMessageIDs(tx, []uint{messageID}); err != nil {
				return err
			}
			return deleteMessageAttachmentRows(tx, []uint{messageID})
		})
		if err != nil {
			return models.Message{}, err
		}

		deleteUnreferencedStorageObjects(context.Background(), db, keys)

	case MessageDeleteForMe:
		err = db.Transaction(func(tx *gorm.DB) error {
			return repository.MarkMessageDeletedForUser(tx, messageID, userID)
		})
		if err != nil {
			return models.Message{}, err
		}

	default:
		return models.Message{}, ErrMessageForbidden
	}

	InvalidateMessageCaches()
	return *message, nil
}

func DeleteMessagesBatchForUser(db *gorm.DB, ids []uint, userID uint, mode MessageDeleteMode) ([]models.Message, error) {
	ids = uniqueMessageIDs(ids)
	if len(ids) == 0 {
		return nil, nil
	}

	var messages []models.Message
	query := db.Preload("Attachments")
	if mode == MessageDeleteForEveryone {
		query = query.Unscoped()
	}
	if err := query.
		Where("id IN ? AND (from_id = ? OR to_id = ?)", ids, userID, userID).
		Find(&messages).Error; err != nil {
		return nil, err
	}
	if len(messages) != len(ids) {
		return nil, ErrMessageForbidden
	}

	switch mode {
	case MessageDeleteForEveryone:
		activeIDs := make([]uint, 0, len(messages))
		keys := make([]string, 0)
		for _, message := range messages {
			if message.FromID != userID {
				return nil, ErrMessageForbidden
			}
			if message.DeletedAt.Valid {
				continue
			}
			activeIDs = append(activeIDs, message.ID)
			keys = append(keys, attachmentKeys(message.Attachments)...)
		}

		err := db.Transaction(func(tx *gorm.DB) error {
			if err := repository.DeleteMessagesForEveryone(tx, activeIDs, userID); err != nil {
				return err
			}
			if err := repository.DeletePinnedMessagesByMessageIDs(tx, activeIDs); err != nil {
				return err
			}
			return deleteMessageAttachmentRows(tx, activeIDs)
		})
		if err != nil {
			return nil, err
		}
		deleteUnreferencedStorageObjects(context.Background(), db, keys)

	case MessageDeleteForMe:
		err := db.Transaction(func(tx *gorm.DB) error {
			return repository.MarkMessagesDeletedForUser(tx, ids, userID)
		})
		if err != nil {
			return nil, err
		}

	default:
		return nil, ErrMessageForbidden
	}

	InvalidateMessageCaches()
	return messages, nil
}

func uniqueMessageIDs(ids []uint) []uint {
	seen := make(map[uint]struct{}, len(ids))
	unique := make([]uint, 0, len(ids))
	for _, id := range ids {
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique
}

func MarkConversationRead(db *gorm.DB, fromID, toID uint) error {
	_, err := MarkConversationReadWithResult(db, fromID, toID)
	return err
}

func MarkConversationReadWithResult(db *gorm.DB, fromID, toID uint) (int64, error) {
	affected, err := repository.MarkMessagesAsRead(db, fromID, toID)
	if err != nil {
		return 0, err
	}
	if affected == 0 {
		return 0, nil
	}
	if _, err := ForceUserActivity(db, toID); err != nil {
		log.Printf("failed to update reader activity: %v", err)
	}
	InvalidateMessageCaches()
	return affected, nil
}

func InvalidateMessageCaches() {
	if cache.Redis == nil {
		return
	}

	_ = cache.Redis.DeletePattern("cache:/messages*")
	_ = cache.Redis.DeletePattern("cache:/conversations*")
}

func deleteMessageAttachmentRows(db *gorm.DB, messageIDs []uint) error {
	if len(messageIDs) == 0 {
		return nil
	}
	return db.Where("message_id IN ?", messageIDs).Delete(&models.MessageAttachment{}).Error
}

func attachmentKeys(attachments []models.MessageAttachment) []string {
	keys := make([]string, 0, len(attachments))
	for _, attachment := range attachments {
		key, ok := storage.KeyFromStoredValue(attachment.FileURL)
		if ok {
			keys = append(keys, key)
		}
	}
	return keys
}

func messageHasEncryptedAttachments(message *models.Message) bool {
	if message == nil {
		return false
	}
	return messageAttachmentsHaveEncryption(message.Attachments)
}

func messageAttachmentsHaveEncryption(attachments []models.MessageAttachment) bool {
	for _, attachment := range attachments {
		if attachment.EncryptionVersion > 0 {
			return true
		}
	}
	return false
}

func attachmentsHavePlaintext(attachments []models.MessageAttachment) bool {
	for _, attachment := range attachments {
		if attachment.EncryptionVersion == 0 {
			return true
		}
	}
	return false
}

func deleteUnreferencedStorageObjects(ctx context.Context, db *gorm.DB, keys []string) {
	if len(keys) == 0 {
		return
	}

	store, err := storage.Default()
	if err != nil {
		log.Printf("failed to load storage for attachment cleanup: %v", err)
		return
	}

	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}

		referenced, err := attachmentObjectStillReferenced(ctx, db, store, key)
		if err != nil {
			log.Printf("failed to check attachment references for %s: %v", key, err)
			continue
		}
		if referenced {
			continue
		}

		if err := store.Delete(ctx, key); err != nil {
			log.Printf("failed to delete message attachment %s: %v", key, err)
		}
	}
}

func attachmentObjectStillReferenced(ctx context.Context, db *gorm.DB, store storage.Storage, key string) (bool, error) {
	variants := storedValueVariants(ctx, store, key)
	var count int64
	err := db.Table("message_attachments").
		Joins("JOIN messages ON messages.id = message_attachments.message_id").
		Where("message_attachments.file_url IN ? AND messages.deleted_at IS NULL", variants).
		Count(&count).Error
	return count > 0, err
}

func storedValueVariants(ctx context.Context, store storage.Storage, key string) []string {
	variants := []string{key}
	if strings.HasPrefix(key, "chat/") {
		filename := filepath.Base(key)
		variants = append(variants, "/uploads/chat/"+filename, "uploads/chat/"+filename)
	}
	if objectURL, err := store.URL(ctx, key); err == nil && objectURL != "" {
		variants = append(variants, objectURL)
	}
	return variants
}
