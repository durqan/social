package repository

import (
	"fmt"
	"testing"
	"time"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestConversationHeadsFollowMessageReadAndPinWrites(t *testing.T) {
	database := newConversationHeadTestDB(t)
	seedConversationHeadUsers(t, database, 1, 2)
	base := time.Date(2026, time.July, 14, 10, 0, 0, 0, time.UTC)
	if affected, err := MarkMessagesAsRead(database, 1, 2); err != nil || affected != 0 {
		t.Fatalf("empty conversation read = affected:%d error:%v, want 0/nil", affected, err)
	}

	first := createConversationHeadMessage(t, database, 1, 2, base, false)
	senderHead := requireConversationHead(t, database, 1, 2)
	recipientHead := requireConversationHead(t, database, 2, 1)
	if senderHead.ConversationID != first.ID || recipientHead.ConversationID != first.ID {
		t.Fatalf("conversation ids = sender:%d recipient:%d, want %d", senderHead.ConversationID, recipientHead.ConversationID, first.ID)
	}
	assertConversationHeadLastMessage(t, senderHead, first.ID)
	assertConversationHeadLastMessage(t, recipientHead, first.ID)
	if senderHead.UnreadCount != 0 || recipientHead.UnreadCount != 1 {
		t.Fatalf("first unread counts = sender:%d recipient:%d, want 0/1", senderHead.UnreadCount, recipientHead.UnreadCount)
	}

	second := createConversationHeadMessage(t, database, 1, 2, base.Add(time.Minute), false)
	senderHead = requireConversationHead(t, database, 1, 2)
	recipientHead = requireConversationHead(t, database, 2, 1)
	assertConversationHeadLastMessage(t, senderHead, second.ID)
	assertConversationHeadLastMessage(t, recipientHead, second.ID)
	if senderHead.UnreadCount != 0 || recipientHead.UnreadCount != 2 {
		t.Fatalf("second unread counts = sender:%d recipient:%d, want 0/2", senderHead.UnreadCount, recipientHead.UnreadCount)
	}

	affected, err := MarkMessagesAsRead(database, 1, 2)
	if err != nil {
		t.Fatalf("mark messages as read: %v", err)
	}
	if affected != 2 {
		t.Fatalf("marked messages = %d, want 2", affected)
	}
	recipientHead = requireConversationHead(t, database, 2, 1)
	if recipientHead.UnreadCount != 0 {
		t.Fatalf("recipient unread after read = %d, want 0", recipientHead.UnreadCount)
	}

	if err := PinConversation(database, 2, 1); err != nil {
		t.Fatalf("pin conversation: %v", err)
	}
	if !requireConversationHead(t, database, 2, 1).IsPinned {
		t.Fatal("recipient head was not pinned")
	}
	if requireConversationHead(t, database, 1, 2).IsPinned {
		t.Fatal("pin leaked to the other participant")
	}

	if err := UnpinConversation(database, 2, 1); err != nil {
		t.Fatalf("unpin conversation: %v", err)
	}
	if requireConversationHead(t, database, 2, 1).IsPinned {
		t.Fatal("recipient head remained pinned")
	}
}

func TestConversationHeadsRecalculateOnlyDeletedLastMessage(t *testing.T) {
	database := newConversationHeadTestDB(t)
	seedConversationHeadUsers(t, database, 1, 2)
	base := time.Date(2026, time.July, 14, 11, 0, 0, 0, time.UTC)

	first := createConversationHeadMessage(t, database, 1, 2, base, true)
	middle := createConversationHeadMessage(t, database, 2, 1, base.Add(time.Minute), true)
	last := createConversationHeadMessage(t, database, 1, 2, base.Add(2*time.Minute), true)

	if err := database.Transaction(func(tx *gorm.DB) error {
		return DeleteMessageForEveryone(tx, middle.ID, middle.FromID)
	}); err != nil {
		t.Fatalf("delete non-last message: %v", err)
	}
	assertConversationHeadLastMessage(t, requireConversationHead(t, database, 1, 2), last.ID)
	assertConversationHeadLastMessage(t, requireConversationHead(t, database, 2, 1), last.ID)

	if err := database.Transaction(func(tx *gorm.DB) error {
		return DeleteMessageForEveryone(tx, last.ID, last.FromID)
	}); err != nil {
		t.Fatalf("delete last message: %v", err)
	}
	assertConversationHeadLastMessage(t, requireConversationHead(t, database, 1, 2), first.ID)
	assertConversationHeadLastMessage(t, requireConversationHead(t, database, 2, 1), first.ID)
}

func TestConversationHeadDeleteForUserRecalculatesOnlyThatParticipant(t *testing.T) {
	database := newConversationHeadTestDB(t)
	seedConversationHeadUsers(t, database, 1, 2)
	base := time.Date(2026, time.July, 14, 12, 0, 0, 0, time.UTC)

	first := createConversationHeadMessage(t, database, 1, 2, base, true)
	last := createConversationHeadMessage(t, database, 2, 1, base.Add(time.Minute), false)

	if err := database.Transaction(func(tx *gorm.DB) error {
		return MarkMessageDeletedForUser(tx, last.ID, 1)
	}); err != nil {
		t.Fatalf("delete last message for user: %v", err)
	}
	userHead := requireConversationHead(t, database, 1, 2)
	peerHead := requireConversationHead(t, database, 2, 1)
	assertConversationHeadLastMessage(t, userHead, first.ID)
	assertConversationHeadLastMessage(t, peerHead, last.ID)
	if userHead.UnreadCount != 0 {
		t.Fatalf("user unread after delete = %d, want 0", userHead.UnreadCount)
	}
}

func TestGetConversationHeadsPageCursorHasNoDuplicatesOrGaps(t *testing.T) {
	database := newConversationHeadTestDB(t)
	peerIDs := []uint{2, 3, 4, 5, 6, 7, 8}
	seedConversationHeadUsers(t, database, append([]uint{1}, peerIDs...)...)
	base := time.Date(2026, time.July, 14, 13, 0, 0, 0, time.UTC)

	var nullLastMessage models.Message
	for index, peerID := range peerIDs {
		createdAt := base.Add(time.Duration(index/2) * time.Minute)
		message := createConversationHeadMessage(t, database, peerID, 1, createdAt, true)
		if peerID == 8 {
			nullLastMessage = message
		}
	}
	if err := PinConversation(database, 1, 2); err != nil {
		t.Fatalf("pin peer 2: %v", err)
	}
	if err := PinConversation(database, 1, 4); err != nil {
		t.Fatalf("pin peer 4: %v", err)
	}
	if err := database.Transaction(func(tx *gorm.DB) error {
		return DeleteMessageForEveryone(tx, nullLastMessage.ID, nullLastMessage.FromID)
	}); err != nil {
		t.Fatalf("delete only message for null-last head: %v", err)
	}

	want, err := findConversationHeadsPage(database, 1, 100, nil)
	if err != nil {
		t.Fatalf("load complete ordered heads: %v", err)
	}
	if len(want) != len(peerIDs) {
		t.Fatalf("complete heads = %d, want %d", len(want), len(peerIDs))
	}
	if want[len(want)-1].LastMessageAt != nil {
		t.Fatal("NULL last_message_at head was not ordered last among unpinned heads")
	}

	var got []models.ConversationHead
	var cursor *ConversationHeadCursor
	for pageNumber := 0; pageNumber < 20; pageNumber++ {
		page, pageErr := findConversationHeadsPage(database, 1, 2, cursor)
		if pageErr != nil {
			t.Fatalf("load page %d: %v", pageNumber, pageErr)
		}
		if len(page) == 0 {
			break
		}
		got = append(got, page...)
		next := ConversationHeadCursorFrom(page[len(page)-1])
		cursor = &next
	}

	if len(got) != len(want) {
		t.Fatalf("paginated heads = %d, want %d", len(got), len(want))
	}
	seen := make(map[uint]struct{}, len(got))
	for index := range want {
		if got[index].ConversationID != want[index].ConversationID {
			t.Fatalf("paginated head[%d] = %d, want %d", index, got[index].ConversationID, want[index].ConversationID)
		}
		if _, exists := seen[got[index].ConversationID]; exists {
			t.Fatalf("duplicate conversation id %d", got[index].ConversationID)
		}
		seen[got[index].ConversationID] = struct{}{}
	}
}

func TestConversationHeadConstraints(t *testing.T) {
	database := newConversationHeadTestDB(t)
	seedConversationHeadUsers(t, database, 1, 2)

	if err := database.Create(&models.ConversationHead{
		ConversationID: 100,
		UserID:         1,
		PeerUserID:     2,
	}).Error; err != nil {
		t.Fatalf("create valid head: %v", err)
	}
	if err := database.Create(&models.ConversationHead{
		ConversationID: 101,
		UserID:         1,
		PeerUserID:     2,
	}).Error; err == nil {
		t.Fatal("duplicate user/peer head was accepted")
	}
	if err := database.Create(&models.ConversationHead{
		ConversationID: 102,
		UserID:         1,
		PeerUserID:     1,
	}).Error; err == nil {
		t.Fatal("self-conversation head was accepted")
	}
	if err := database.Create(&models.ConversationHead{
		ConversationID: 103,
		UserID:         2,
		PeerUserID:     1,
		UnreadCount:    -1,
	}).Error; err == nil {
		t.Fatal("negative unread_count was accepted")
	}
}

func newConversationHeadTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared&_foreign_keys=1", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := database.AutoMigrate(
		&models.User{},
		&models.Message{},
		&models.MessageUserDeletion{},
		&models.MessageAttachment{},
		&models.ConversationPin{},
		&models.ConversationHead{},
	); err != nil {
		t.Fatalf("migrate conversation head test schema: %v", err)
	}
	return database
}

func seedConversationHeadUsers(t *testing.T, database *gorm.DB, userIDs ...uint) {
	t.Helper()
	for _, userID := range userIDs {
		user := models.User{
			ID:       userID,
			Name:     fmt.Sprintf("User %d", userID),
			Email:    fmt.Sprintf("conversation-head-%d@example.com", userID),
			Password: "hash",
		}
		if err := database.Create(&user).Error; err != nil {
			t.Fatalf("seed user %d: %v", userID, err)
		}
	}
}

func createConversationHeadMessage(t *testing.T, database *gorm.DB, fromID, toID uint, createdAt time.Time, isRead bool) models.Message {
	t.Helper()
	message := models.Message{
		FromID:    fromID,
		ToID:      toID,
		Content:   fmt.Sprintf("message %d to %d", fromID, toID),
		IsRead:    isRead,
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}
	if err := database.Transaction(func(tx *gorm.DB) error {
		return CreateMessage(tx, &message)
	}); err != nil {
		t.Fatalf("create message %d to %d: %v", fromID, toID, err)
	}
	return message
}

func requireConversationHead(t *testing.T, database *gorm.DB, userID, peerUserID uint) *models.ConversationHead {
	t.Helper()
	var head models.ConversationHead
	err := database.Where("user_id = ? AND peer_user_id = ?", userID, peerUserID).First(&head).Error
	if err != nil {
		t.Fatalf("load head %d/%d: %v", userID, peerUserID, err)
	}
	return &head
}

func assertConversationHeadLastMessage(t *testing.T, head *models.ConversationHead, messageID uint) {
	t.Helper()
	if head.LastMessageID == nil || *head.LastMessageID != messageID {
		t.Fatalf("head %d/%d last message = %v, want %d", head.UserID, head.PeerUserID, head.LastMessageID, messageID)
	}
	if head.LastMessageAt == nil {
		t.Fatalf("head %d/%d has nil last_message_at", head.UserID, head.PeerUserID)
	}
}
