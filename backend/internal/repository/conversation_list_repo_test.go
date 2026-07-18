package repository

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"tester/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestConversationHeadListBatchHydrationUsesHeadValues(t *testing.T) {
	database := newConversationHeadTestDB(t)
	peerIDs := []uint{2, 3, 4, 5, 6}
	seedConversationHeadUsers(t, database, append([]uint{1}, peerIDs...)...)
	base := time.Date(2026, time.July, 15, 10, 0, 0, 0, time.UTC)

	latestByPeer := make(map[uint]models.Message, len(peerIDs))
	for index, peerID := range peerIDs {
		latestByPeer[peerID] = createConversationHeadMessage(t, database, peerID, 1, base.Add(time.Duration(index)*time.Minute), false)
	}
	voiceMessage := latestByPeer[6]
	if err := database.Model(&models.Message{}).Where("id = ?", voiceMessage.ID).Update("content", "").Error; err != nil {
		t.Fatalf("clear voice message content: %v", err)
	}
	if err := database.Create(&models.MessageAttachment{
		MessageID: voiceMessage.ID,
		FileURL:   "messages/user_6/voice.ogg",
		FileType:  "voice",
		Size:      128,
	}).Error; err != nil {
		t.Fatalf("create voice attachment: %v", err)
	}
	if err := database.Model(&models.ConversationHead{}).
		Where("user_id = ? AND peer_user_id = ?", 1, 2).
		Update("unread_count", 17).Error; err != nil {
		t.Fatalf("override head unread: %v", err)
	}

	counter := &conversationQueryCounter{Interface: logger.Discard}
	page, err := GetConversationsFromHeadsPage(
		database.Session(&gorm.Session{Logger: counter}),
		1,
		100,
		nil,
	)
	if err != nil {
		t.Fatalf("get conversations from heads: %v", err)
	}
	if got := counter.Count(); got != 4 {
		t.Fatalf("heads list SQL statements = %d, want 4 fixed batch queries", got)
	}
	headSQL := strings.ToLower(counter.Statements()[0])
	for _, fragment := range []string{
		"from `conversation_heads`", "last_message_id is not null", "user_id =", "order by is_pinned desc", "last_message_at desc", "conversation_id desc",
	} {
		if !strings.Contains(headSQL, fragment) {
			t.Fatalf("heads SQL missing %q: %s", fragment, headSQL)
		}
	}
	for _, forbidden := range []string{"row_number", "select distinct", " union ", "from `messages`"} {
		if strings.Contains(headSQL, forbidden) {
			t.Fatalf("heads SQL contains %q: %s", forbidden, headSQL)
		}
	}
	if len(page.Rows) != len(peerIDs) {
		t.Fatalf("heads list rows = %d, want %d", len(page.Rows), len(peerIDs))
	}
	if page.NextCursor != nil {
		t.Fatal("complete heads list unexpectedly returned next cursor")
	}

	peerTwo := conversationRowByPeer(t, page.Rows, 2)
	if got := conversationMapInt64(peerTwo, "unread_count"); got != 17 {
		t.Fatalf("unread_count = %d, want head value 17", got)
	}
	if got := conversationMapUint(peerTwo, "last_message_id"); got != latestByPeer[2].ID {
		t.Fatalf("last_message_id = %d, want head message %d", got, latestByPeer[2].ID)
	}
	if got := conversationMapUint(peerTwo, "user_id"); got != 2 {
		t.Fatalf("user_id = %d, want peer_user_id 2", got)
	}
	if got := peerTwo["last_sender_name"]; got != "User 2" {
		t.Fatalf("last_sender_name = %v, want User 2", got)
	}
	peerSix := conversationRowByPeer(t, page.Rows, 6)
	if got := peerSix["last_message"]; got != "Голосовое сообщение" {
		t.Fatalf("last_message = %v, want voice preview", got)
	}
}

func TestConversationHeadPostgresSQLShape(t *testing.T) {
	counter := &conversationQueryCounter{Interface: logger.Discard}
	database, err := gorm.Open(
		postgres.New(postgres.Config{
			DSN: "host=localhost user=test dbname=test sslmode=disable",
		}),
		&gorm.Config{
			DryRun:               true,
			DisableAutomaticPing: true,
			Logger:               counter,
		},
	)
	if err != nil {
		t.Fatalf("open PostgreSQL dry-run database: %v", err)
	}
	if _, err := findConversationHeadsPage(database, 7, 50, nil); err != nil {
		t.Fatalf("build PostgreSQL heads query: %v", err)
	}
	statements := counter.Statements()
	if len(statements) != 1 {
		t.Fatalf("PostgreSQL dry-run statements = %d, want 1", len(statements))
	}
	sql := strings.ToLower(statements[0])
	for _, fragment := range []string{
		`from "conversation_heads"`,
		"where user_id = 7",
		"order by is_pinned desc, last_message_at desc nulls last, conversation_id desc",
		"limit 50",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("PostgreSQL heads SQL missing %q: %s", fragment, sql)
		}
	}
	for _, forbidden := range []string{"row_number", "select distinct", " union ", `from "messages"`} {
		if strings.Contains(sql, forbidden) {
			t.Fatalf("PostgreSQL heads SQL contains %q: %s", forbidden, sql)
		}
	}
}

func TestConversationHeadListOrderingCursorDeleteAndPin(t *testing.T) {
	database := newConversationHeadTestDB(t)
	seedConversationHeadUsers(t, database, 1, 2, 3, 4, 5)
	base := time.Date(2026, time.July, 15, 11, 0, 0, 0, time.UTC)

	peerTwo := createConversationHeadMessage(t, database, 2, 1, base, true)
	peerThree := createConversationHeadMessage(t, database, 3, 1, base.Add(2*time.Minute), true)
	peerFourPrevious := createConversationHeadMessage(t, database, 4, 1, base.Add(time.Minute), true)
	peerFourLatest := createConversationHeadMessage(t, database, 4, 1, base.Add(2*time.Minute), true)
	peerFiveOnly := createConversationHeadMessage(t, database, 5, 1, base.Add(3*time.Minute), true)
	if err := PinConversation(database, 1, 2); err != nil {
		t.Fatalf("pin peer 2: %v", err)
	}
	if err := database.Transaction(func(tx *gorm.DB) error {
		return DeleteMessageForEveryone(tx, peerFiveOnly.ID, peerFiveOnly.FromID)
	}); err != nil {
		t.Fatalf("delete peer 5 only message: %v", err)
	}

	first, err := GetConversationsFromHeadsPage(database, 1, 2, nil)
	if err != nil {
		t.Fatalf("get first heads page: %v", err)
	}
	assertConversationPeerOrder(t, first.Rows, []uint{2, 4})
	if first.NextCursor == nil {
		t.Fatal("first heads page has no next cursor")
	}
	second, err := GetConversationsFromHeadsPage(database, 1, 2, first.NextCursor)
	if err != nil {
		t.Fatalf("get second heads page: %v", err)
	}
	assertConversationPeerOrder(t, second.Rows, []uint{3})
	if second.NextCursor != nil {
		t.Fatal("last heads page unexpectedly has next cursor")
	}
	seen := map[uint]bool{}
	for _, row := range append(first.Rows, second.Rows...) {
		peerID := conversationMapUint(row, "user_id")
		if seen[peerID] {
			t.Fatalf("duplicate peer %d between cursor pages", peerID)
		}
		seen[peerID] = true
	}
	if err := UnpinConversation(database, 1, 2); err != nil {
		t.Fatalf("unpin peer 2: %v", err)
	}
	page, err := GetConversationsFromHeadsPage(database, 1, 100, nil)
	if err != nil {
		t.Fatalf("get unpinned heads list: %v", err)
	}
	assertConversationPeerOrder(t, page.Rows, []uint{4, 3, 2})
	if err := PinConversation(database, 1, 3); err != nil {
		t.Fatalf("pin peer 3: %v", err)
	}
	page, err = GetConversationsFromHeadsPage(database, 1, 100, nil)
	if err != nil {
		t.Fatalf("get repinned heads list: %v", err)
	}
	assertConversationPeerOrder(t, page.Rows, []uint{3, 4, 2})

	if err := database.Transaction(func(tx *gorm.DB) error {
		return DeleteMessageForEveryone(tx, peerFourLatest.ID, peerFourLatest.FromID)
	}); err != nil {
		t.Fatalf("delete peer 4 last message: %v", err)
	}
	page, err = GetConversationsFromHeadsPage(database, 1, 100, nil)
	if err != nil {
		t.Fatalf("get list after deleting last message: %v", err)
	}
	peerFourRow := conversationRowByPeer(t, page.Rows, 4)
	if got := conversationMapUint(peerFourRow, "last_message_id"); got != peerFourPrevious.ID {
		t.Fatalf("peer 4 last message = %d, want previous %d", got, peerFourPrevious.ID)
	}
	if conversationMapUint(conversationRowByPeer(t, page.Rows, 2), "last_message_id") != peerTwo.ID {
		t.Fatal("unrelated peer 2 last message changed")
	}
	if conversationMapUint(conversationRowByPeer(t, page.Rows, 3), "last_message_id") != peerThree.ID {
		t.Fatal("unrelated peer 3 last message changed")
	}
}

type conversationQueryCounter struct {
	logger.Interface
	count      atomic.Int64
	statements []string
	mu         sync.Mutex
}

func (counter *conversationQueryCounter) Trace(_ context.Context, _ time.Time, statement func() (string, int64), _ error) {
	counter.count.Add(1)
	sql, _ := statement()
	counter.mu.Lock()
	counter.statements = append(counter.statements, sql)
	counter.mu.Unlock()
}

func (counter *conversationQueryCounter) Count() int64 {
	return counter.count.Load()
}

func (counter *conversationQueryCounter) Statements() []string {
	counter.mu.Lock()
	defer counter.mu.Unlock()
	return append([]string(nil), counter.statements...)
}

func conversationRowByPeer(t *testing.T, rows []map[string]interface{}, peerID uint) map[string]interface{} {
	t.Helper()
	for _, row := range rows {
		if conversationMapUint(row, "user_id") == peerID {
			return row
		}
	}
	t.Fatalf("conversation peer %d not found in %+v", peerID, rows)
	return nil
}

func assertConversationPeerOrder(t *testing.T, rows []map[string]interface{}, want []uint) {
	t.Helper()
	if len(rows) != len(want) {
		t.Fatalf("conversation rows = %d, want %d", len(rows), len(want))
	}
	for index, peerID := range want {
		if got := conversationMapUint(rows[index], "user_id"); got != peerID {
			t.Fatalf("conversation peer at %d = %d, want %d", index, got, peerID)
		}
	}
}

func conversationMapUint(row map[string]interface{}, key string) uint {
	value := conversationMapInt64(row, key)
	if value <= 0 {
		return 0
	}
	return uint(value)
}

func conversationMapInt64(row map[string]interface{}, key string) int64 {
	switch value := row[key].(type) {
	case int:
		return int64(value)
	case int64:
		return value
	case int32:
		return int64(value)
	case uint:
		return int64(value)
	case uint64:
		return int64(value)
	case uint32:
		return int64(value)
	case float64:
		return int64(value)
	case []byte:
		parsed, _ := strconv.ParseInt(string(value), 10, 64)
		return parsed
	case string:
		parsed, _ := strconv.ParseInt(value, 10, 64)
		return parsed
	default:
		return 0
	}
}
