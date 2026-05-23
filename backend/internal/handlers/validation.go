package handlers

import "strings"

const (
	maxPostContentLength    = 500
	maxCommentContentLength = 500
	maxMessageContentLength = 1000
)

func trimAndValidateContent(content string, maxLength int) (string, bool) {
	content = strings.TrimSpace(content)
	if content == "" || len([]rune(content)) > maxLength {
		return "", false
	}
	return content, true
}
