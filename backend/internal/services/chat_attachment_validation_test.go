package services

import (
	"bytes"
	"strings"
	"testing"
)

func TestValidateChatAttachmentUploadRejectsBlockedExtension(t *testing.T) {
	data := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}

	_, err := ValidateChatAttachmentUpload(
		bytes.NewReader(data),
		"photo.apk",
		"image/png",
		"image",
		int64(len(data)),
	)
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("ValidateChatAttachmentUpload error = %v, want blocked extension", err)
	}
}

func TestValidateChatAttachmentUploadDetectsPDFDocument(t *testing.T) {
	data := []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")

	info, err := ValidateChatAttachmentUpload(
		bytes.NewReader(data),
		"report.pdf",
		"application/pdf",
		"file",
		int64(len(data)),
	)
	if err != nil {
		t.Fatal(err)
	}
	if info.FileType != "file" {
		t.Fatalf("FileType = %q, want file", info.FileType)
	}
	if info.ContentType != "application/pdf" {
		t.Fatalf("ContentType = %q, want application/pdf", info.ContentType)
	}
	if info.Extension != ".pdf" {
		t.Fatalf("Extension = %q, want .pdf", info.Extension)
	}
	if info.OriginalFilename != "report.pdf" {
		t.Fatalf("OriginalFilename = %q, want report.pdf", info.OriginalFilename)
	}
}
