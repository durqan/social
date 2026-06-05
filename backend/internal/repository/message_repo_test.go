package repository

import (
	"fmt"
	"testing"
	"time"

	"tester/internal/models"
)

func TestGetConversationsSortsPersonalPinsFirst(t *testing.T) {
	db := testRepositoryDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	users := []models.User{
		{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash", CreatedAt: now},
		{ID: 2, Name: "Bob", Email: "bob@example.com", Password: "hash", CreatedAt: now},
		{ID: 3, Name: "Carol", Email: "carol@example.com", Password: "hash", CreatedAt: now},
		{ID: 4, Name: "Dave", Email: "dave@example.com", Password: "hash", CreatedAt: now},
	}
	mustCreate(t, db, &users)

	messages := []models.Message{
		{FromID: 2, ToID: 1, Content: "bob older", CreatedAt: now.Add(-30 * time.Minute)},
		{FromID: 3, ToID: 1, Content: "carol newer pinned", CreatedAt: now.Add(-20 * time.Minute)},
		{FromID: 4, ToID: 1, Content: "dave newest unpinned for alice", CreatedAt: now.Add(-10 * time.Minute)},
	}
	mustCreate(t, db, &messages)

	pins := []models.ConversationPin{
		{UserID: 1, ConversationID: 2, CreatedAt: now},
		{UserID: 1, ConversationID: 3, CreatedAt: now},
		{UserID: 4, ConversationID: 1, CreatedAt: now},
	}
	mustCreate(t, db, &pins)

	conversations, err := GetConversations(db, 1)
	if err != nil {
		t.Fatalf("get conversations: %v", err)
	}
	if len(conversations) != 3 {
		t.Fatalf("expected 3 conversations, got %d", len(conversations))
	}

	wantUserIDs := []uint{3, 2, 4}
	wantPinned := []bool{true, true, false}
	for index, conversation := range conversations {
		if got := conversationUint(t, conversation["user_id"]); got != wantUserIDs[index] {
			t.Fatalf("conversation %d expected user_id %d, got %d", index, wantUserIDs[index], got)
		}
		if got := conversationBool(t, conversation["is_pinned"]); got != wantPinned[index] {
			t.Fatalf("conversation %d expected is_pinned %t, got %t", index, wantPinned[index], got)
		}
	}
}

func TestReplacePinnedMessageKeepsOnePinPerConversation(t *testing.T) {
	db := testRepositoryDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	users := []models.User{
		{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash", CreatedAt: now},
		{ID: 2, Name: "Bob", Email: "bob@example.com", Password: "hash", CreatedAt: now},
	}
	mustCreate(t, db, &users)

	messages := []models.Message{
		{FromID: 1, ToID: 2, Content: "first", CreatedAt: now.Add(-2 * time.Minute)},
		{FromID: 2, ToID: 1, Content: "second", CreatedAt: now.Add(-time.Minute)},
	}
	mustCreate(t, db, &messages)

	conversationID, err := CanonicalConversationID(db, 1, 2)
	if err != nil {
		t.Fatalf("canonical conversation id: %v", err)
	}

	if _, err := ReplacePinnedMessage(db, conversationID, messages[0].ID, 1); err != nil {
		t.Fatalf("pin first message: %v", err)
	}
	if _, err := ReplacePinnedMessage(db, conversationID, messages[1].ID, 2); err != nil {
		t.Fatalf("replace pinned message: %v", err)
	}

	var count int64
	if err := db.Model(&models.PinnedMessage{}).
		Where("conversation_id = ?", conversationID).
		Count(&count).Error; err != nil {
		t.Fatalf("count pinned messages: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one pinned message, got %d", count)
	}

	pin, err := GetPinnedMessage(db, conversationID)
	if err != nil {
		t.Fatalf("get pinned message: %v", err)
	}
	if pin.MessageID != messages[1].ID {
		t.Fatalf("expected message_id %d, got %d", messages[1].ID, pin.MessageID)
	}
	if pin.PinnedByID != 2 {
		t.Fatalf("expected pinned_by_id 2, got %d", pin.PinnedByID)
	}
}

func conversationUint(t *testing.T, value any) uint {
	t.Helper()

	switch typed := value.(type) {
	case *interface{}:
		if typed == nil {
			t.Fatal("nil uint value")
		}
		return conversationUint(t, *typed)
	case uint:
		return typed
	case uint64:
		return uint(typed)
	case uint32:
		return uint(typed)
	case int:
		return uint(typed)
	case int64:
		return uint(typed)
	case int32:
		return uint(typed)
	case float64:
		return uint(typed)
	case []byte:
		var id uint
		if _, err := fmt.Sscan(string(typed), &id); err != nil {
			t.Fatalf("scan uint from %q: %v", string(typed), err)
		}
		return id
	case string:
		var id uint
		if _, err := fmt.Sscan(typed, &id); err != nil {
			t.Fatalf("scan uint from %q: %v", typed, err)
		}
		return id
	default:
		t.Fatalf("unsupported uint value %T", value)
		return 0
	}
}

func conversationBool(t *testing.T, value any) bool {
	t.Helper()

	switch typed := value.(type) {
	case *interface{}:
		if typed == nil {
			t.Fatal("nil bool value")
		}
		return conversationBool(t, *typed)
	case bool:
		return typed
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case int32:
		return typed != 0
	case uint:
		return typed != 0
	case uint64:
		return typed != 0
	case uint32:
		return typed != 0
	case []byte:
		return string(typed) == "1" || string(typed) == "true"
	case string:
		return typed == "1" || typed == "true"
	default:
		t.Fatalf("unsupported bool value %T", value)
		return false
	}
}
