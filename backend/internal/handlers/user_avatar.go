package handlers

import (
	"errors"
	"net/http"

	"tester/internal/repository"
	"tester/internal/storage"
	"tester/internal/utils"

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

		randomName, err := utils.GenerateSecureToken()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to create avatar filename"})
			return
		}
		filename := randomName + ext
		store, err := storage.Default()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to prepare upload storage"})
			return
		}

		object, err := store.Upload(c.Request.Context(), "avatars/"+filename, src, file.Size, contentType)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to save avatar"})
			return
		}

		if err := repository.UpdateUserAvatar(db, id, object.URL); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}

			c.JSON(500, gin.H{"error": "failed to update user"})
			return
		}

		c.JSON(200, gin.H{"avatar": object.URL})
	}
}
