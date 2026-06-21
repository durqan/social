package handlers

import (
	"fmt"
	"testing"
	"time"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBuildPostResponsesUsesBatchAggregates(t *testing.T) {
	db := newPostResponseTestDB(t)
	user := models.User{ID: 1, Name: "Author", Email: "author@example.com", Password: "hash"}
	viewer := models.User{ID: 2, Name: "Viewer", Email: "viewer@example.com", Password: "hash"}
	if err := db.Create(&[]models.User{user, viewer}).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}
	posts := []models.Post{
		{ID: 10, UserID: user.ID, User: user, Content: "first", CreatedAt: time.Now()},
		{ID: 11, UserID: user.ID, User: user, Content: "second", CreatedAt: time.Now()},
	}
	if err := db.Create(&posts).Error; err != nil {
		t.Fatalf("seed posts: %v", err)
	}
	if err := db.Create(&[]models.PostLike{
		{PostID: 10, UserID: viewer.ID},
		{PostID: 10, UserID: user.ID},
	}).Error; err != nil {
		t.Fatalf("seed post likes: %v", err)
	}
	if err := db.Create(&[]models.Comment{
		{ID: 20, PostID: 10, UserID: viewer.ID, Content: "one"},
		{ID: 21, PostID: 10, UserID: user.ID, Content: "two"},
		{ID: 22, PostID: 11, UserID: viewer.ID, Content: "three"},
	}).Error; err != nil {
		t.Fatalf("seed comments: %v", err)
	}

	got := buildPostResponses(db, posts, viewer.ID)
	if len(got) != 2 {
		t.Fatalf("responses length = %d, want 2", len(got))
	}
	if got[0].LikesCount != 2 || got[0].CommentsCount != 2 || !got[0].IsLiked {
		t.Fatalf("first post aggregate mismatch: %+v", got[0])
	}
	if got[1].LikesCount != 0 || got[1].CommentsCount != 1 || got[1].IsLiked {
		t.Fatalf("second post aggregate mismatch: %+v", got[1])
	}
}

func TestBuildCommentResponsesUsesBatchAggregates(t *testing.T) {
	db := newPostResponseTestDB(t)
	user := models.User{ID: 1, Name: "Author", Email: "author@example.com", Password: "hash"}
	viewer := models.User{ID: 2, Name: "Viewer", Email: "viewer@example.com", Password: "hash"}
	if err := db.Create(&[]models.User{user, viewer}).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}
	comments := []models.Comment{
		{ID: 30, PostID: 10, UserID: user.ID, User: user, Content: "first"},
		{ID: 31, PostID: 10, UserID: user.ID, User: user, Content: "second"},
	}
	if err := db.Create(&comments).Error; err != nil {
		t.Fatalf("seed comments: %v", err)
	}
	if err := db.Create(&[]models.CommentLike{
		{CommentID: 30, UserID: viewer.ID},
		{CommentID: 30, UserID: user.ID},
	}).Error; err != nil {
		t.Fatalf("seed comment likes: %v", err)
	}

	got := buildCommentResponses(db, comments, viewer.ID)
	if len(got) != 2 {
		t.Fatalf("responses length = %d, want 2", len(got))
	}
	if got[0].LikesCount != 2 || !got[0].IsLiked {
		t.Fatalf("first comment aggregate mismatch: %+v", got[0])
	}
	if got[1].LikesCount != 0 || got[1].IsLiked {
		t.Fatalf("second comment aggregate mismatch: %+v", got[1])
	}
}

func newPostResponseTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Post{},
		&models.PostLike{},
		&models.Comment{},
		&models.CommentLike{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}
