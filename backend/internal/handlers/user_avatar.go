package handlers

import (
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"net/http"
	"time"

	"tester/internal/dto"
	"tester/internal/repository"
	"tester/internal/storage"

	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp"
	"gorm.io/gorm"
)

const (
	avatarMaxSize        = 5 << 20 // 5 MB
	avatarMaxRequestSize = avatarMaxSize + 1<<20
	avatarSignedURLTTL   = 15 * time.Minute
)

var allowedAvatarTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

func UploadAvatar(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := requireOwnUser(c, "id", "can only upload your own avatar")
		if !ok {
			return
		}

		user, err := repository.GetUserById(db, id)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}
			c.JSON(500, gin.H{"error": "failed to load user"})
			return
		}
		oldAvatar := user.Avatar

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, avatarMaxRequestSize)

		file, err := c.FormFile("avatar")
		if err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				c.JSON(413, gin.H{"error": "avatar is too large"})
				return
			}

			c.JSON(400, gin.H{"error": "avatar is required"})
			return
		}

		if file.Size > avatarMaxSize {
			c.JSON(413, gin.H{"error": "avatar is too large"})
			return
		}

		src, err := file.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read avatar"})
			return
		}
		defer src.Close()

		buf := make([]byte, 512)
		n, err := src.Read(buf)
		if err != nil && n == 0 {
			c.JSON(400, gin.H{"error": "failed to read avatar"})
			return
		}

		contentType := http.DetectContentType(buf[:n])
		ext, ok := allowedAvatarTypes[contentType]
		if !ok {
			c.JSON(415, gin.H{"error": "avatar must be jpeg, png or webp"})
			return
		}

		if _, err := src.Seek(0, 0); err != nil {
			c.JSON(400, gin.H{"error": "failed to read avatar"})
			return
		}

		if _, _, err := image.DecodeConfig(src); err != nil {
			c.JSON(415, gin.H{"error": "invalid image"})
			return
		}

		if _, err := src.Seek(0, 0); err != nil {
			c.JSON(400, gin.H{"error": "failed to read avatar"})
			return
		}

		key, err := storage.NewObjectKey(fmt.Sprintf("avatars/user_%d", id), ext)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to create avatar filename"})
			return
		}

		store, err := storage.Default()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to prepare upload storage"})
			return
		}

		if err := store.Upload(c.Request.Context(), key, src, contentType); err != nil {
			c.JSON(500, gin.H{"error": "failed to save avatar"})
			return
		}

		if err := repository.UpdateUserAvatar(db, id, key); err != nil {
			if cleanupErr := store.Delete(c.Request.Context(), key); cleanupErr != nil {
				log.Printf("failed to cleanup uploaded avatar %s after DB update failure: %v", key, cleanupErr)
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}

			c.JSON(500, gin.H{"error": "failed to update user"})
			return
		}

		if oldAvatar != "" && oldAvatar != key {
			if err := storage.DeleteStoredValue(c.Request.Context(), store, oldAvatar); err != nil {
				log.Printf("failed to delete old avatar for user %d: %v", id, err)
			}
		}

		c.JSON(200, gin.H{"avatar": dto.AvatarEndpoint(id, key)})
	}
}

func GetUserAvatar(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := uintParam(c, "id", "invalid user id")
		if !ok {
			return
		}

		user, err := repository.GetUserById(db, id)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load avatar"})
			return
		}

		key, ok := storage.KeyFromStoredValue(user.Avatar)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
			return
		}

		store, err := storage.Default()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load storage"})
			return
		}

		serveStoredAvatar(c, store, key)
	}
}

func serveStoredAvatar(c *gin.Context, store storage.Storage, key string) {
	if path, ok := storage.LocalPath(store, key); ok {
		c.File(path)
		return
	}

	signedURL, err := storage.SignedURL(c.Request.Context(), store, key, avatarSignedURLTTL)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "avatar not found"})
		return
	}

	c.Redirect(http.StatusTemporaryRedirect, signedURL)
}
