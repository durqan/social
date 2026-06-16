package services

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	ChatAttachmentTypeImage = "image"
	ChatAttachmentTypeVideo = "video"
	ChatAttachmentTypeAudio = "audio"
	ChatAttachmentTypeFile  = "file"
)

type ChatAttachmentUploadInfo struct {
	FileType         string
	ContentType      string
	Extension        string
	OriginalFilename string
	MaxSize          int64
}

type chatUploadReadSeekerAt interface {
	io.Reader
	io.ReaderAt
	io.Seeker
}

var blockedChatAttachmentExtensions = map[string]struct{}{
	".exe":  {},
	".apk":  {},
	".bat":  {},
	".cmd":  {},
	".sh":   {},
	".js":   {},
	".mjs":  {},
	".cjs":  {},
	".php":  {},
	".py":   {},
	".jar":  {},
	".dmg":  {},
	".deb":  {},
	".rpm":  {},
	".msi":  {},
	".html": {},
	".htm":  {},
	".svg":  {},
}

var allowedChatVideoTypes = map[string]struct {
	extension   string
	contentType string
}{
	"video/mp4":       {extension: ".mp4", contentType: "video/mp4"},
	"video/webm":      {extension: ".webm", contentType: "video/webm"},
	"video/quicktime": {extension: ".mov", contentType: "video/quicktime"},
}

var allowedChatAudioTypes = map[string]struct {
	extension   string
	contentType string
}{
	"audio/mpeg":      {extension: ".mp3", contentType: "audio/mpeg"},
	"audio/mp3":       {extension: ".mp3", contentType: "audio/mpeg"},
	"audio/mp4":       {extension: ".m4a", contentType: "audio/mp4"},
	"audio/x-m4a":     {extension: ".m4a", contentType: "audio/mp4"},
	"audio/wav":       {extension: ".wav", contentType: "audio/wav"},
	"audio/wave":      {extension: ".wav", contentType: "audio/wav"},
	"audio/x-wav":     {extension: ".wav", contentType: "audio/wav"},
	"audio/ogg":       {extension: ".ogg", contentType: "audio/ogg"},
	"application/ogg": {extension: ".ogg", contentType: "audio/ogg"},
	"audio/webm":      {extension: ".webm", contentType: "audio/webm"},
}

var allowedChatFileContentTypes = map[string]struct {
	extension   string
	contentType string
}{
	"application/pdf": {extension: ".pdf", contentType: "application/pdf"},
	"text/plain":      {extension: ".txt", contentType: "text/plain"},
	"application/json": {
		extension:   ".json",
		contentType: "application/json",
	},
	"text/csv": {extension: ".csv", contentType: "text/csv"},
	"application/msword": {
		extension:   ".doc",
		contentType: "application/msword",
	},
	"application/vnd.ms-excel": {
		extension:   ".xls",
		contentType: "application/vnd.ms-excel",
	},
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
		extension:   ".docx",
		contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	},
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
		extension:   ".xlsx",
		contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	},
	"application/zip": {extension: ".zip", contentType: "application/zip"},
}

func NormalizeChatAttachmentFileType(fileType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(fileType)) {
	case ChatAttachmentTypeImage:
		return ChatAttachmentTypeImage, true
	case ChatAttachmentTypeVideo:
		return ChatAttachmentTypeVideo, true
	case ChatAttachmentTypeAudio:
		return ChatAttachmentTypeAudio, true
	case ChatAttachmentTypeFile, "document":
		return ChatAttachmentTypeFile, true
	default:
		return "", false
	}
}

func ChatAttachmentMaxSizeForType(fileType string) (int64, bool) {
	switch fileType {
	case ChatAttachmentTypeImage:
		return ChatImageMaxSize, true
	case ChatAttachmentTypeVideo:
		return ChatVideoMaxSize, true
	case ChatAttachmentTypeAudio:
		return ChatAudioMaxSize, true
	case ChatAttachmentTypeFile:
		return ChatFileMaxSize, true
	default:
		return 0, false
	}
}

func ChatAttachmentLabel(fileType string) string {
	switch fileType {
	case ChatAttachmentTypeImage:
		return "image"
	case ChatAttachmentTypeVideo:
		return "video"
	case ChatAttachmentTypeAudio:
		return "audio"
	default:
		return "file"
	}
}

func ValidateChatAttachmentUpload(src chatUploadReadSeekerAt, filename string, declaredContentType string, requestedFileType string, size int64) (ChatAttachmentUploadInfo, error) {
	if size <= 0 {
		return ChatAttachmentUploadInfo{}, errors.New("file is empty")
	}

	requestedType := ""
	if strings.TrimSpace(requestedFileType) != "" {
		normalized, ok := NormalizeChatAttachmentFileType(requestedFileType)
		if !ok {
			return ChatAttachmentUploadInfo{}, errors.New("unsupported attachment type")
		}
		requestedType = normalized
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if _, blocked := blockedChatAttachmentExtensions[ext]; blocked {
		return ChatAttachmentUploadInfo{}, errors.New("file type is not allowed")
	}

	header, err := readHeaderFromSeeker(src)
	if err != nil {
		return ChatAttachmentUploadInfo{}, errors.New("failed to read file")
	}
	defer src.Seek(0, io.SeekStart)

	declared := normalizeMediaType(declaredContentType)
	info, err := detectChatAttachment(src, header, size, ext, declared, requestedType)
	if err != nil {
		return ChatAttachmentUploadInfo{}, err
	}
	if requestedType != "" && info.FileType != requestedType {
		return ChatAttachmentUploadInfo{}, errors.New("file content does not match attachment type")
	}
	if !declaredContentTypeCompatible(declared, info.ContentType) {
		return ChatAttachmentUploadInfo{}, errors.New("file content does not match content type")
	}

	maxSize, _ := ChatAttachmentMaxSizeForType(info.FileType)
	if size > maxSize {
		return ChatAttachmentUploadInfo{}, errors.New(ChatAttachmentLabel(info.FileType) + " is too large")
	}

	info.MaxSize = maxSize
	info.OriginalFilename = SanitizeAttachmentFilename(filename, info.Extension)
	return info, nil
}

func SanitizeAttachmentFilename(filename string, fallbackExt string) string {
	filename = strings.TrimSpace(strings.ReplaceAll(filename, "\\", "/"))
	filename = filepath.Base(filename)
	filename = strings.Map(func(r rune) rune {
		if r == 0 || r == '/' || r == '\\' || unicode.IsControl(r) {
			return -1
		}
		switch r {
		case '<', '>', ':', '"', '|', '?', '*':
			return '_'
		default:
			return r
		}
	}, filename)
	filename = strings.Trim(filename, ". ")

	ext := strings.ToLower(filepath.Ext(filename))
	base := strings.TrimSpace(strings.TrimSuffix(filename, ext))
	if base == "" {
		base = "attachment"
	}
	if len([]rune(base)) > 120 {
		runes := []rune(base)
		base = string(runes[:120])
	}
	if ext == "" {
		ext = strings.ToLower(strings.TrimSpace(fallbackExt))
	}
	if ext != "" && !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	if _, blocked := blockedChatAttachmentExtensions[ext]; blocked {
		ext = strings.ToLower(strings.TrimSpace(fallbackExt))
	}
	if ext == "" {
		ext = ".bin"
	}

	return base + ext
}

func ChatAttachmentContentTypeMatchesFileType(fileType string, contentType string) bool {
	contentType = normalizeMediaType(contentType)
	if contentType == "" {
		return false
	}

	switch fileType {
	case ChatAttachmentTypeImage:
		_, ok := allowedChatImageTypes[contentType]
		return ok
	case ChatAttachmentTypeVideo:
		_, ok := allowedChatVideoTypes[contentType]
		return ok
	case ChatAttachmentTypeAudio:
		_, ok := allowedChatAudioTypes[contentType]
		return ok
	case ChatAttachmentTypeFile:
		_, ok := allowedChatFileContentTypes[contentType]
		return ok
	default:
		return false
	}
}

func ChatAttachmentExtensionMatchesFileType(fileType string, filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	if _, blocked := blockedChatAttachmentExtensions[ext]; blocked {
		return false
	}
	if ext == ".jpeg" {
		ext = ".jpg"
	}

	switch fileType {
	case ChatAttachmentTypeImage:
		return ext == ".jpg" || ext == ".png" || ext == ".webp" || ext == ".gif"
	case ChatAttachmentTypeVideo:
		return ext == ".mp4" || ext == ".webm" || ext == ".mov"
	case ChatAttachmentTypeAudio:
		return ext == ".mp3" || ext == ".m4a" || ext == ".wav" || ext == ".ogg" || ext == ".webm"
	case ChatAttachmentTypeFile:
		return ext == ".pdf" || ext == ".txt" || ext == ".doc" || ext == ".docx" ||
			ext == ".xls" || ext == ".xlsx" || ext == ".zip" || ext == ".json" || ext == ".csv"
	default:
		return false
	}
}

func detectChatAttachment(src chatUploadReadSeekerAt, header []byte, size int64, ext string, declared string, requestedType string) (ChatAttachmentUploadInfo, error) {
	if contentType, extension, ok := imageTypeFromMagic(header); ok {
		return detectedAttachment(ChatAttachmentTypeImage, contentType, extension, ext)
	}
	if isWebMMagic(header) {
		if requestedType == ChatAttachmentTypeAudio || strings.HasPrefix(declared, "audio/") {
			return detectedAttachment(ChatAttachmentTypeAudio, "audio/webm", ".webm", ext)
		}
		return detectedAttachment(ChatAttachmentTypeVideo, "video/webm", ".webm", ext)
	}
	if isOggMagic(header) {
		return detectedAttachment(ChatAttachmentTypeAudio, "audio/ogg", ".ogg", ext)
	}
	if isMP3Magic(header) {
		return detectedAttachment(ChatAttachmentTypeAudio, "audio/mpeg", ".mp3", ext)
	}
	if isWAVMagic(header) {
		return detectedAttachment(ChatAttachmentTypeAudio, "audio/wav", ".wav", ext)
	}
	if isISOBaseMediaMagic(header) {
		if requestedType == ChatAttachmentTypeAudio || declared == "audio/mp4" || declared == "audio/x-m4a" || ext == ".m4a" {
			return detectedAttachment(ChatAttachmentTypeAudio, "audio/mp4", ".m4a", ext)
		}
		if declared == "video/quicktime" || ext == ".mov" {
			return detectedAttachment(ChatAttachmentTypeVideo, "video/quicktime", ".mov", ext)
		}
		return detectedAttachment(ChatAttachmentTypeVideo, "video/mp4", ".mp4", ext)
	}
	if isPDFMagic(header) {
		return detectedAttachment(ChatAttachmentTypeFile, "application/pdf", ".pdf", ext)
	}
	if isOLEMagic(header) {
		switch ext {
		case ".doc":
			return detectedAttachment(ChatAttachmentTypeFile, "application/msword", ".doc", ext)
		case ".xls":
			return detectedAttachment(ChatAttachmentTypeFile, "application/vnd.ms-excel", ".xls", ext)
		default:
			return ChatAttachmentUploadInfo{}, errors.New("file content does not match supported document type")
		}
	}
	if isZIPMagic(header) {
		officeType, err := officeTypeFromZip(src, size)
		if err != nil {
			return ChatAttachmentUploadInfo{}, errors.New("invalid zip file")
		}
		if ext == ".docx" {
			if officeType != "docx" {
				return ChatAttachmentUploadInfo{}, errors.New("file content does not match extension")
			}
			return detectedAttachment(ChatAttachmentTypeFile, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx", ext)
		}
		if ext == ".xlsx" {
			if officeType != "xlsx" {
				return ChatAttachmentUploadInfo{}, errors.New("file content does not match extension")
			}
			return detectedAttachment(ChatAttachmentTypeFile, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx", ext)
		}
		if ext != "" && ext != ".zip" {
			return ChatAttachmentUploadInfo{}, errors.New("file content does not match extension")
		}
		return detectedAttachment(ChatAttachmentTypeFile, "application/zip", ".zip", ext)
	}

	if textLike(header) {
		if looksLikeHTMLOrSVG(header) {
			return ChatAttachmentUploadInfo{}, errors.New("file type is not allowed")
		}
		switch {
		case ext == ".json" || declared == "application/json":
			if !validJSONDocument(src, size) {
				return ChatAttachmentUploadInfo{}, errors.New("invalid json file")
			}
			return detectedAttachment(ChatAttachmentTypeFile, "application/json", ".json", ext)
		case ext == ".csv" || declared == "text/csv":
			return detectedAttachment(ChatAttachmentTypeFile, "text/csv", ".csv", ext)
		case ext == ".txt" || declared == "text/plain":
			return detectedAttachment(ChatAttachmentTypeFile, "text/plain", ".txt", ext)
		}
	}

	return ChatAttachmentUploadInfo{}, errors.New("unsupported attachment type")
}

func detectedAttachment(fileType string, contentType string, extension string, originalExt string) (ChatAttachmentUploadInfo, error) {
	if originalExt != "" && !detectedExtensionMatches(extension, originalExt) {
		return ChatAttachmentUploadInfo{}, errors.New("file content does not match extension")
	}
	return ChatAttachmentUploadInfo{
		FileType:    fileType,
		ContentType: contentType,
		Extension:   extension,
	}, nil
}

func detectedExtensionMatches(detectedExt string, originalExt string) bool {
	if originalExt == ".jpeg" {
		originalExt = ".jpg"
	}
	return originalExt == detectedExt
}

func readHeaderFromSeeker(src io.ReadSeeker) ([]byte, error) {
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	header := make([]byte, 512)
	n, err := src.Read(header)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return header[:n], nil
}

func normalizeMediaType(contentType string) string {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(contentType))
	if err != nil {
		mediaType = strings.TrimSpace(contentType)
	}
	return strings.ToLower(mediaType)
}

func declaredContentTypeCompatible(declared string, canonical string) bool {
	if declared == "" || declared == "application/octet-stream" || declared == "binary/octet-stream" {
		return true
	}
	if declared == canonical {
		return true
	}

	switch canonical {
	case "image/jpeg":
		return declared == "image/jpg" || declared == "image/pjpeg"
	case "audio/mpeg":
		return declared == "audio/mp3"
	case "audio/mp4":
		return declared == "audio/x-m4a"
	case "audio/wav":
		return declared == "audio/wave" || declared == "audio/x-wav"
	case "audio/ogg":
		return declared == "application/ogg"
	case "text/csv":
		return declared == "application/csv" || declared == "application/vnd.ms-excel" || declared == "text/plain"
	case "application/json":
		return declared == "text/json" || declared == "text/plain"
	case "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return declared == "application/zip" || declared == "application/x-zip-compressed"
	case "application/zip":
		return declared == "application/x-zip-compressed"
	default:
		return false
	}
}

func imageTypeFromMagic(data []byte) (string, string, bool) {
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return "image/jpeg", ".jpg", true
	}
	if len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}) {
		return "image/png", ".png", true
	}
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "image/webp", ".webp", true
	}
	if len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a") {
		return "image/gif", ".gif", true
	}
	return "", "", false
}

func isWebMMagic(data []byte) bool {
	return len(data) >= 4 && data[0] == 0x1a && data[1] == 0x45 && data[2] == 0xdf && data[3] == 0xa3
}

func isOggMagic(data []byte) bool {
	return len(data) >= 4 && string(data[:4]) == "OggS"
}

func isMP3Magic(data []byte) bool {
	if len(data) >= 3 && string(data[:3]) == "ID3" {
		return true
	}
	return len(data) >= 2 && data[0] == 0xff && (data[1]&0xe0) == 0xe0
}

func isWAVMagic(data []byte) bool {
	return len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WAVE"
}

func isISOBaseMediaMagic(data []byte) bool {
	return len(data) >= 12 && string(data[4:8]) == "ftyp"
}

func isPDFMagic(data []byte) bool {
	return len(data) >= 5 && string(data[:5]) == "%PDF-"
}

func isOLEMagic(data []byte) bool {
	return len(data) >= 8 && bytes.Equal(data[:8], []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1})
}

func isZIPMagic(data []byte) bool {
	return len(data) >= 4 && data[0] == 'P' && data[1] == 'K' &&
		(data[2] == 0x03 || data[2] == 0x05 || data[2] == 0x07) &&
		(data[3] == 0x04 || data[3] == 0x06 || data[3] == 0x08)
}

func textLike(data []byte) bool {
	if len(data) == 0 || !utf8.Valid(data) {
		return false
	}
	detected := normalizeMediaType(http.DetectContentType(data))
	return strings.HasPrefix(detected, "text/plain") || detected == "application/json"
}

func looksLikeHTMLOrSVG(data []byte) bool {
	trimmed := strings.ToLower(strings.TrimSpace(string(data)))
	return strings.HasPrefix(trimmed, "<!doctype html") ||
		strings.HasPrefix(trimmed, "<html") ||
		strings.HasPrefix(trimmed, "<script") ||
		strings.HasPrefix(trimmed, "<svg")
}

func validJSONDocument(src io.ReaderAt, size int64) bool {
	if size <= 0 || size > ChatFileMaxSize {
		return false
	}
	data, err := io.ReadAll(io.NewSectionReader(src, 0, size))
	if err != nil {
		return false
	}
	data = bytes.TrimSpace(data)
	return len(data) > 0 && json.Valid(data)
}

func officeTypeFromZip(src io.ReaderAt, size int64) (string, error) {
	reader, err := zip.NewReader(src, size)
	if err != nil {
		return "", err
	}

	hasContentTypes := false
	hasWord := false
	hasWorkbook := false
	for _, file := range reader.File {
		name := strings.TrimPrefix(strings.ToLower(file.Name), "/")
		switch {
		case name == "[content_types].xml":
			hasContentTypes = true
		case name == "word/document.xml" || strings.HasPrefix(name, "word/"):
			hasWord = true
		case name == "xl/workbook.xml" || strings.HasPrefix(name, "xl/"):
			hasWorkbook = true
		}
	}

	if hasContentTypes && hasWord {
		return "docx", nil
	}
	if hasContentTypes && hasWorkbook {
		return "xlsx", nil
	}
	return "zip", nil
}
