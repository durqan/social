package handlers

import (
	"testing"

	"tester/internal/models"
)

func TestMessageAttachmentDownloadFilename(t *testing.T) {
	tests := []struct {
		name        string
		attachment  models.MessageAttachment
		key         string
		contentType string
		want        string
	}{
		{
			name: "uses original filename",
			attachment: models.MessageAttachment{
				ID:               11,
				FileType:         "file",
				OriginalFilename: "report final.pdf",
			},
			key:         "messages/user_1/uuid.bin",
			contentType: "application/pdf",
			want:        "report final.pdf",
		},
		{
			name: "generates image filename",
			attachment: models.MessageAttachment{
				ID:       42,
				FileType: "image",
			},
			key:         "messages/user_1/uuid",
			contentType: "image/png",
			want:        "image-42.png",
		},
		{
			name: "generates audio filename for voice",
			attachment: models.MessageAttachment{
				ID:       7,
				FileType: "voice",
			},
			key:         "voice/user_1/uuid.webm",
			contentType: "audio/webm",
			want:        "audio-7.webm",
		},
		{
			name: "uses key extension for generic file",
			attachment: models.MessageAttachment{
				ID:       9,
				FileType: "file",
			},
			key:         "messages/user_1/archive.zip",
			contentType: "",
			want:        "file-9.zip",
		},
		{
			name: "generates video note filename",
			attachment: models.MessageAttachment{
				ID:       13,
				FileType: "video_note",
			},
			key:         "video-notes/user_1/uuid.webm",
			contentType: "video/webm",
			want:        "video-note-13.webm",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := messageAttachmentDownloadFilename(&tt.attachment, tt.key, tt.contentType)
			if got != tt.want {
				t.Fatalf("messageAttachmentDownloadFilename() = %q, want %q", got, tt.want)
			}
		})
	}
}
