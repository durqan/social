package db

import (
	"log"
	"time"

	"tester/internal/models"
	"tester/internal/storage"

	"gorm.io/gorm"
)

func Migrate(database *gorm.DB) error {
	if err := cleanupOrphanLinkPreviewVideoAttachments(database); err != nil {
		return err
	}
	if err := prepareNotificationMigrations(database); err != nil {
		return err
	}

	if err := database.AutoMigrate(
		&models.User{},
		&models.Post{},
		&models.PostLike{},
		&models.CommentLike{},
		&models.Comment{},
		&models.Message{},
		&models.MessageReaction{},
		&models.MessageUserDeletion{},
		&models.MessageAttachment{},
		&models.MessageLinkPreview{},
		&models.ConversationPin{},
		&models.ConversationHead{},
		&models.PinnedMessage{},
		&models.CallLog{},
		&models.Friendship{},
		&models.EmailVerification{},
		&models.PasswordResetToken{},
		&models.NotificationOutbox{},
		&models.Notification{},
		&models.MobilePushToken{},
	); err != nil {
		return err
	}
	if err := finishNotificationMigrations(database); err != nil {
		return err
	}
	if err := migrateCallsToLiveKit(database); err != nil {
		return err
	}

	if err := migrateEncryptedKeyBackups(database); err != nil {
		return err
	}

	if err := ensurePerformanceIndexes(database); err != nil {
		return err
	}
	if err := migrateConversationHeads(database); err != nil {
		return err
	}

	return normalizeStoredUploadKeys(database)
}

func migrateCallsToLiveKit(database *gorm.DB) error {
	migrator := database.Migrator()
	if !migrator.HasTable(&models.CallLog{}) {
		return nil
	}
	hasAnsweredAt := migrator.HasColumn(&models.CallLog{}, "answered_at")

	if err := database.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.CallLog{}).
			Where("status = ?", "answered").
			Update("status", models.CallStatusAccepted).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.CallLog{}).
			Where("status = ?", "declined").
			Update("status", models.CallStatusRejected).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.CallLog{}).
			Where("status = ?", "missed").
			Update("status", models.CallStatusTimeout).Error; err != nil {
			return err
		}
		if hasAnsweredAt {
			if err := tx.Exec(
				"UPDATE call_logs SET accepted_at = answered_at WHERE accepted_at IS NULL AND answered_at IS NOT NULL",
			).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}

	for _, legacyColumn := range []string{
		"offer_payload",
		"answer_payload",
		"ice_candidates",
		"answered_at",
	} {
		if migrator.HasColumn(&models.CallLog{}, legacyColumn) {
			if err := migrator.DropColumn(&models.CallLog{}, legacyColumn); err != nil {
				return err
			}
		}
	}
	return nil
}

func cleanupOrphanLinkPreviewVideoAttachments(database *gorm.DB) error {
	migrator := database.Migrator()
	if !migrator.HasTable("message_link_previews") ||
		!migrator.HasTable("message_attachments") ||
		!migrator.HasColumn("message_link_previews", "video_attachment_id") {
		return nil
	}

	result := database.Exec(`
		UPDATE message_link_previews AS mlp
		SET video_attachment_id = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE mlp.video_attachment_id IS NOT NULL
			AND NOT EXISTS (
				SELECT 1
				FROM message_attachments AS ma
				WHERE ma.id = mlp.video_attachment_id
			)
	`)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		log.Printf(
			"cleaned orphan message_link_previews video_attachment_id before migration: count=%d",
			result.RowsAffected,
		)
	}
	return nil
}

func ensurePerformanceIndexes(database *gorm.DB) error {
	indexes := []string{
		"idx_posts_user_created_id ON posts (user_id, created_at DESC, id DESC)",
		"idx_comments_post_created_id ON comments (post_id, created_at ASC, id ASC)",
		"idx_message_user_deletions_user_message ON message_user_deletions (user_id, message_id)",
		"idx_messages_from_created_id_active ON messages (from_id, created_at DESC, id DESC) WHERE deleted_at IS NULL",
		"idx_messages_to_created_id_active ON messages (to_id, created_at DESC, id DESC) WHERE deleted_at IS NULL",
		"idx_messages_to_unread_from_active ON messages (to_id, is_read, from_id) WHERE deleted_at IS NULL",
		"idx_message_attachments_message_type_encryption ON message_attachments (message_id, file_type, encryption_version)",
		"idx_message_reactions_message_created_id ON message_reactions (message_id, created_at ASC, id ASC)",
		"idx_notification_outboxes_status_next_attempt_id ON notification_outboxes (status, next_attempt_at ASC, id ASC) WHERE status IN ('pending', 'failed')",
		"idx_notification_outboxes_claim_v2 ON notification_outboxes (status, next_attempt_at ASC, lease_until ASC, id ASC) WHERE status IN ('pending', 'failed', 'publishing')",
		"idx_call_logs_status_expires_id ON call_logs (status, expires_at ASC, id ASC) WHERE expires_at IS NOT NULL",
		"idx_call_logs_status_updated_id ON call_logs (status, updated_at ASC, id ASC)",
	}
	for _, index := range indexes {
		if err := createIndexIfMissing(database, index); err != nil {
			return err
		}
	}

	conversationHeadOrderIndex := "idx_conversation_heads_user_order ON conversation_heads (user_id, is_pinned DESC, last_message_at DESC, conversation_id DESC)"
	if database.Dialector.Name() == "postgres" {
		conversationHeadOrderIndex = "idx_conversation_heads_user_order ON conversation_heads (user_id, is_pinned DESC, last_message_at DESC NULLS LAST, conversation_id DESC)"
	}
	return createIndexIfMissing(database, conversationHeadOrderIndex)
}

func createIndexIfMissing(database *gorm.DB, definition string) error {
	concurrently := ""
	if database.Dialector.Name() == "postgres" {
		concurrently = "CONCURRENTLY "
	}
	return database.Exec("CREATE INDEX " + concurrently + "IF NOT EXISTS " + definition).Error
}

const (
	conversationHeadsMigrationVersion = "20260714_conversation_heads_v1"
	conversationHeadsMigrationLockID  = int64(2026071401)
)

type appSchemaMigration struct {
	Version   string    `gorm:"primaryKey;type:varchar(128)"`
	AppliedAt time.Time `gorm:"not null"`
}

func (appSchemaMigration) TableName() string {
	return "app_schema_migrations"
}

func migrateConversationHeads(database *gorm.DB) error {
	if err := database.AutoMigrate(&appSchemaMigration{}); err != nil {
		return err
	}

	return database.Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", conversationHeadsMigrationLockID).Error; err != nil {
				return err
			}
		}

		var applied int64
		if err := tx.Model(&appSchemaMigration{}).
			Where("version = ?", conversationHeadsMigrationVersion).
			Count(&applied).Error; err != nil {
			return err
		}
		if applied > 0 {
			return nil
		}

		if err := backfillConversationHeads(tx); err != nil {
			return err
		}
		return tx.Create(&appSchemaMigration{
			Version:   conversationHeadsMigrationVersion,
			AppliedAt: time.Now().UTC(),
		}).Error
	})
}

func backfillConversationHeads(database *gorm.DB) error {
	return database.Exec(`
		WITH paired_messages AS (
			SELECT
				m.id,
				m.from_id,
				m.to_id,
				m.is_read,
				m.created_at,
				m.deleted_at,
				CASE WHEN m.from_id < m.to_id THEN m.from_id ELSE m.to_id END AS low_user_id,
				CASE WHEN m.from_id < m.to_id THEN m.to_id ELSE m.from_id END AS high_user_id
			FROM messages m
			WHERE m.from_id <> m.to_id
		),
		ranked_anchors AS (
			SELECT
				pm.*,
				ROW_NUMBER() OVER (
					PARTITION BY pm.low_user_id, pm.high_user_id
					ORDER BY pm.created_at ASC, pm.id ASC
				) AS anchor_rank
			FROM paired_messages pm
		),
		conversation_pairs AS (
			SELECT
				ra.id AS conversation_id,
				ra.low_user_id,
				ra.high_user_id,
				ra.created_at AS first_message_at
			FROM ranked_anchors ra
			WHERE ra.anchor_rank = 1
		),
		participants AS (
			SELECT
				cp.conversation_id,
				cp.low_user_id AS user_id,
				cp.high_user_id AS peer_user_id,
				cp.first_message_at AS created_at
			FROM conversation_pairs cp
			UNION ALL
			SELECT
				cp.conversation_id,
				cp.high_user_id AS user_id,
				cp.low_user_id AS peer_user_id,
				cp.first_message_at AS created_at
			FROM conversation_pairs cp
		),
		visible_messages AS (
			SELECT
				cp.conversation_id,
				pm.from_id AS user_id,
				pm.to_id AS peer_user_id,
				pm.id,
				pm.created_at,
				pm.is_read,
				false AS is_incoming
			FROM paired_messages pm
			JOIN conversation_pairs cp
				ON cp.low_user_id = pm.low_user_id
				AND cp.high_user_id = pm.high_user_id
			WHERE pm.deleted_at IS NULL
				AND NOT EXISTS (
					SELECT 1
					FROM message_user_deletions mud
					WHERE mud.message_id = pm.id AND mud.user_id = pm.from_id
				)
			UNION ALL
			SELECT
				cp.conversation_id,
				pm.to_id AS user_id,
				pm.from_id AS peer_user_id,
				pm.id,
				pm.created_at,
				pm.is_read,
				true AS is_incoming
			FROM paired_messages pm
			JOIN conversation_pairs cp
				ON cp.low_user_id = pm.low_user_id
				AND cp.high_user_id = pm.high_user_id
			WHERE pm.deleted_at IS NULL
				AND NOT EXISTS (
					SELECT 1
					FROM message_user_deletions mud
					WHERE mud.message_id = pm.id AND mud.user_id = pm.to_id
				)
		),
		ranked_visible_messages AS (
			SELECT
				vm.*,
				ROW_NUMBER() OVER (
					PARTITION BY vm.conversation_id, vm.user_id
					ORDER BY vm.created_at DESC, vm.id DESC
				) AS message_rank
			FROM visible_messages vm
		),
		last_messages AS (
			SELECT
				rvm.conversation_id,
				rvm.user_id,
				rvm.id AS last_message_id,
				rvm.created_at AS last_message_at
			FROM ranked_visible_messages rvm
			WHERE rvm.message_rank = 1
		),
		unread_counts AS (
			SELECT
				vm.conversation_id,
				vm.user_id,
				SUM(CASE WHEN vm.is_incoming = true AND vm.is_read = false THEN 1 ELSE 0 END) AS unread_count
			FROM visible_messages vm
			GROUP BY vm.conversation_id, vm.user_id
		)
		INSERT INTO conversation_heads (
			conversation_id,
			user_id,
			peer_user_id,
			last_message_id,
			last_message_at,
			unread_count,
			is_pinned,
			created_at,
			updated_at
		)
		SELECT
			p.conversation_id,
			p.user_id,
			p.peer_user_id,
			lm.last_message_id,
			lm.last_message_at,
			COALESCE(uc.unread_count, 0),
			CASE WHEN pin.id IS NULL THEN false ELSE true END,
			p.created_at,
			CURRENT_TIMESTAMP
		FROM participants p
		LEFT JOIN last_messages lm
			ON lm.conversation_id = p.conversation_id AND lm.user_id = p.user_id
		LEFT JOIN unread_counts uc
			ON uc.conversation_id = p.conversation_id AND uc.user_id = p.user_id
		LEFT JOIN conversation_pins pin
			ON pin.user_id = p.user_id AND pin.conversation_id = p.peer_user_id
		WHERE 1 = 1
		ON CONFLICT (user_id, peer_user_id) DO UPDATE SET
			conversation_id = excluded.conversation_id,
			last_message_id = excluded.last_message_id,
			last_message_at = excluded.last_message_at,
			unread_count = excluded.unread_count,
			is_pinned = excluded.is_pinned,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at
	`).Error
}

func migrateEncryptedKeyBackups(database *gorm.DB) error {
	if !database.Migrator().HasTable(&models.EncryptedKeyBackup{}) {
		return database.AutoMigrate(&models.EncryptedKeyBackup{})
	}

	var backups []models.EncryptedKeyBackup
	if err := database.Select("id", "user_id").Order("user_id, id desc").Find(&backups).Error; err != nil {
		return err
	}

	seenUsers := make(map[uint]struct{}, len(backups))
	duplicateIDs := make([]uint, 0)
	for _, backup := range backups {
		if _, exists := seenUsers[backup.UserID]; exists {
			duplicateIDs = append(duplicateIDs, backup.ID)
			continue
		}
		seenUsers[backup.UserID] = struct{}{}
	}
	if len(duplicateIDs) > 0 {
		if err := database.Where("id IN ?", duplicateIDs).Delete(&models.EncryptedKeyBackup{}).Error; err != nil {
			return err
		}
	}

	if database.Migrator().HasIndex(&models.EncryptedKeyBackup{}, "ux_e2ee_backup_user") {
		return nil
	}
	return database.Migrator().CreateIndex(&models.EncryptedKeyBackup{}, "ux_e2ee_backup_user")
}

func normalizeStoredUploadKeys(database *gorm.DB) error {
	if err := normalizeUserAvatarKeys(database); err != nil {
		return err
	}
	return normalizeMessageAttachmentKeys(database)
}

func normalizeUserAvatarKeys(database *gorm.DB) error {
	var users []models.User
	if err := database.Select("id", "avatar").Where("avatar <> ''").Find(&users).Error; err != nil {
		return err
	}

	for _, user := range users {
		key, ok := storage.KeyFromStoredValue(user.Avatar)
		if !ok || key == user.Avatar {
			continue
		}
		if err := database.Model(&models.User{}).
			Where("id = ?", user.ID).
			Update("avatar", key).Error; err != nil {
			return err
		}
	}
	return nil
}

func normalizeMessageAttachmentKeys(database *gorm.DB) error {
	var attachments []models.MessageAttachment
	if err := database.Select("id", "file_url").Where("file_url <> ''").Find(&attachments).Error; err != nil {
		return err
	}

	for _, attachment := range attachments {
		key, ok := storage.KeyFromStoredValue(attachment.FileURL)
		if !ok || key == attachment.FileURL {
			continue
		}
		if err := database.Model(&models.MessageAttachment{}).
			Where("id = ?", attachment.ID).
			Update("file_url", key).Error; err != nil {
			return err
		}
	}
	return nil
}
