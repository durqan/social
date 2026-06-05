package repository

import (
	"slices"
	"testing"
	"time"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func testRepositoryDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	if err := db.AutoMigrate(
		&models.User{},
		&models.Post{},
		&models.PostLike{},
		&models.CommentLike{},
		&models.Comment{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.ConversationPin{},
		&models.PinnedMessage{},
		&models.Friendship{},
		&models.EmailVerification{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if err := db.Exec(`CREATE TABLE notifications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipient_id INTEGER,
		actor_id INTEGER
	)`).Error; err != nil {
		t.Fatalf("create notifications table: %v", err)
	}
	if err := db.Exec(`CREATE TABLE push_subscriptions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER
	)`).Error; err != nil {
		t.Fatalf("create push_subscriptions table: %v", err)
	}

	return db
}

func TestDeleteUserRemovesAssociations(t *testing.T) {
	db := testRepositoryDB(t)
	now := time.Now()

	users := []models.User{
		{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash", Avatar: "/uploads/avatars/1_avatar.png", CreatedAt: now},
		{ID: 2, Name: "Bob", Email: "bob@example.com", Password: "hash", IsEmailVerified: true, CreatedAt: now},
		{ID: 3, Name: "Eve", Email: "eve@example.com", Password: "hash", IsEmailVerified: true, CreatedAt: now},
	}
	mustCreate(t, db, &users)

	deletedPost := models.Post{UserID: 1, Content: "deleted user's post"}
	otherPost := models.Post{UserID: 2, Content: "other user's post"}
	mustCreate(t, db, &deletedPost)
	mustCreate(t, db, &otherPost)

	commentOnDeletedPost := models.Comment{PostID: deletedPost.ID, UserID: 2, Content: "comment on deleted post"}
	commentByDeletedUser := models.Comment{PostID: otherPost.ID, UserID: 1, Content: "deleted user's comment"}
	remainingComment := models.Comment{PostID: otherPost.ID, UserID: 2, Content: "remaining comment"}
	mustCreate(t, db, &commentOnDeletedPost)
	mustCreate(t, db, &commentByDeletedUser)
	mustCreate(t, db, &remainingComment)

	mustCreate(t, db, &models.PostLike{PostID: deletedPost.ID, UserID: 2})
	mustCreate(t, db, &models.PostLike{PostID: otherPost.ID, UserID: 1})
	mustCreate(t, db, &models.PostLike{PostID: otherPost.ID, UserID: 2})

	mustCreate(t, db, &models.CommentLike{CommentID: commentByDeletedUser.ID, UserID: 2})
	mustCreate(t, db, &models.CommentLike{CommentID: remainingComment.ID, UserID: 1})
	mustCreate(t, db, &models.CommentLike{CommentID: remainingComment.ID, UserID: 2})

	deletedMessage := models.Message{FromID: 1, ToID: 2, Content: "deleted message"}
	deletedIncomingMessage := models.Message{FromID: 2, ToID: 1, Content: "deleted incoming message"}
	remainingMessage := models.Message{FromID: 2, ToID: 3, Content: "remaining message"}
	mustCreate(t, db, &deletedMessage)
	mustCreate(t, db, &deletedIncomingMessage)
	mustCreate(t, db, &remainingMessage)

	mustCreate(t, db, &models.MessageAttachment{MessageID: deletedMessage.ID, FileURL: "/uploads/chat/1_deleted.png", FileType: "image"})
	mustCreate(t, db, &models.MessageAttachment{MessageID: remainingMessage.ID, FileURL: "/uploads/chat/2_remaining.png", FileType: "image"})

	mustCreate(t, db, &models.Friendship{UserID: 1, FriendID: 2, Status: "accepted"})
	mustCreate(t, db, &models.Friendship{UserID: 2, FriendID: 3, Status: "accepted"})

	mustCreate(t, db, &models.EmailVerification{UserID: 1, Token: "alice-token", ExpiresAt: now.Add(time.Hour)})
	mustCreate(t, db, &models.EmailVerification{UserID: 2, Token: "bob-token", ExpiresAt: now.Add(time.Hour)})

	mustExec(t, db, "INSERT INTO notifications (recipient_id, actor_id) VALUES (?, ?), (?, ?), (?, ?)", 1, 2, 2, 1, 2, 3)
	mustExec(t, db, "INSERT INTO push_subscriptions (user_id) VALUES (?), (?)", 1, 2)

	artifacts, err := DeleteUser(db, 1)
	if err != nil {
		t.Fatalf("delete user: %v", err)
	}

	wantArtifacts := []string{"/uploads/avatars/1_avatar.png", "/uploads/chat/1_deleted.png"}
	for _, want := range wantArtifacts {
		if !slices.Contains(artifacts.UploadPaths, want) {
			t.Fatalf("expected deletion artifacts to contain %q, got %#v", want, artifacts.UploadPaths)
		}
	}

	assertModelCount[models.User](t, db, 0, "id = ?", 1)
	assertModelCount[models.User](t, db, 2, "")
	assertModelCount[models.Post](t, db, 0, "id = ?", deletedPost.ID)
	assertModelCount[models.Post](t, db, 1, "id = ?", otherPost.ID)
	assertModelCount[models.Comment](t, db, 0, "id IN ?", []uint{commentOnDeletedPost.ID, commentByDeletedUser.ID})
	assertModelCount[models.Comment](t, db, 1, "id = ?", remainingComment.ID)
	assertModelCount[models.PostLike](t, db, 0, "user_id = ? OR post_id = ?", 1, deletedPost.ID)
	assertModelCount[models.PostLike](t, db, 1, "post_id = ? AND user_id = ?", otherPost.ID, 2)
	assertModelCount[models.CommentLike](t, db, 0, "user_id = ? OR comment_id IN ?", 1, []uint{commentOnDeletedPost.ID, commentByDeletedUser.ID})
	assertModelCount[models.CommentLike](t, db, 1, "comment_id = ? AND user_id = ?", remainingComment.ID, 2)
	assertModelCount[models.Message](t, db, 0, "from_id = ? OR to_id = ?", 1, 1)
	assertModelCount[models.Message](t, db, 1, "id = ?", remainingMessage.ID)
	assertModelCount[models.MessageAttachment](t, db, 0, "message_id IN ?", []uint{deletedMessage.ID, deletedIncomingMessage.ID})
	assertModelCount[models.MessageAttachment](t, db, 1, "message_id = ?", remainingMessage.ID)
	assertModelCount[models.Friendship](t, db, 0, "user_id = ? OR friend_id = ?", 1, 1)
	assertModelCount[models.Friendship](t, db, 1, "user_id = ? AND friend_id = ?", 2, 3)
	assertModelCount[models.EmailVerification](t, db, 0, "user_id = ?", 1)
	assertModelCount[models.EmailVerification](t, db, 1, "user_id = ?", 2)
	assertTableCount(t, db, "notifications", 0, "recipient_id = ? OR actor_id = ?", 1, 1)
	assertTableCount(t, db, "notifications", 1, "recipient_id = ? AND actor_id = ?", 2, 3)
	assertTableCount(t, db, "push_subscriptions", 0, "user_id = ?", 1)
	assertTableCount(t, db, "push_subscriptions", 1, "user_id = ?", 2)
}

func TestGetExpiredUnverifiedUserIDs(t *testing.T) {
	db := testRepositoryDB(t)
	now := time.Now()
	cutoff := now.Add(-models.EmailVerificationTTL)

	users := []models.User{
		{ID: 1, Name: "Expired", Email: "expired@example.com", Password: "hash", CreatedAt: cutoff},
		{ID: 2, Name: "Fresh", Email: "fresh@example.com", Password: "hash", CreatedAt: cutoff.Add(time.Second)},
		{ID: 3, Name: "Verified", Email: "verified@example.com", Password: "hash", IsEmailVerified: true, CreatedAt: cutoff.Add(-time.Hour)},
	}
	mustCreate(t, db, &users)

	userIDs, err := GetExpiredUnverifiedUserIDs(db, cutoff)
	if err != nil {
		t.Fatalf("get expired unverified users: %v", err)
	}

	if !slices.Equal(userIDs, []uint{1}) {
		t.Fatalf("expected only expired unverified user ID, got %#v", userIDs)
	}
}

func TestDeleteExpiredUnverifiedUserSkipsVerifiedUser(t *testing.T) {
	db := testRepositoryDB(t)
	cutoff := time.Now().Add(-models.EmailVerificationTTL)

	user := models.User{
		ID:              1,
		Name:            "Verified",
		Email:           "verified@example.com",
		Password:        "hash",
		IsEmailVerified: true,
		CreatedAt:       cutoff.Add(-time.Hour),
	}
	mustCreate(t, db, &user)
	post := models.Post{UserID: user.ID, Content: "must remain"}
	mustCreate(t, db, &post)

	_, deleted, err := DeleteExpiredUnverifiedUser(db, user.ID, cutoff)
	if err != nil {
		t.Fatalf("delete expired verified user: %v", err)
	}
	if deleted {
		t.Fatal("expected verified user to be skipped")
	}

	assertModelCount[models.User](t, db, 1, "id = ?", user.ID)
	assertModelCount[models.Post](t, db, 1, "id = ?", post.ID)
}

func mustCreate(t *testing.T, db *gorm.DB, value any) {
	t.Helper()

	if err := db.Create(value).Error; err != nil {
		t.Fatalf("create %T: %v", value, err)
	}
}

func mustExec(t *testing.T, db *gorm.DB, sql string, values ...any) {
	t.Helper()

	if err := db.Exec(sql, values...).Error; err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func assertModelCount[T any](t *testing.T, db *gorm.DB, want int64, query string, args ...any) {
	t.Helper()

	var count int64
	tx := db.Model(new(T))
	if query != "" {
		tx = tx.Where(query, args...)
	}
	if err := tx.Count(&count).Error; err != nil {
		t.Fatalf("count model rows: %v", err)
	}
	if count != want {
		t.Fatalf("expected %d rows, got %d for query %q", want, count, query)
	}
}

func assertTableCount(t *testing.T, db *gorm.DB, table string, want int64, query string, args ...any) {
	t.Helper()

	var count int64
	tx := db.Table(table)
	if query != "" {
		tx = tx.Where(query, args...)
	}
	if err := tx.Count(&count).Error; err != nil {
		t.Fatalf("count %s rows: %v", table, err)
	}
	if count != want {
		t.Fatalf("expected %d rows in %s, got %d for query %q", want, table, count, query)
	}
}
