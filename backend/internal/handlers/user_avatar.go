package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	avatarMaxSize        = 5 << 20 // 5 MB
	avatarMaxRequestSize = avatarMaxSize + 1<<20
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

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, avatarMaxRequestSize)

		file, err := c.FormFile("avatar")
		if err != nil {
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

		uploadDir := filepath.Join("uploads", "avatars")
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			c.JSON(500, gin.H{"error": "failed to prepare upload directory"})
			return
		}

		filename := fmt.Sprintf("%d_%d%s", id, time.Now().UnixNano(), ext)
		savePath := filepath.Join(uploadDir, filename)

		if err := c.SaveUploadedFile(file, savePath); err != nil {
			c.JSON(500, gin.H{"error": "failed to save avatar"})
			return
		}

		avatarURL := "/" + filepath.ToSlash(savePath)
		if err := repository.UpdateUserAvatar(db, id, avatarURL); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}

			c.JSON(500, gin.H{"error": "failed to update user"})
			return
		}

		c.JSON(200, gin.H{"avatar": avatarURL})
	}
}
