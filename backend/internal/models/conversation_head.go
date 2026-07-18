package models

import "time"

// ConversationHead stores the per-participant state of a direct conversation.
// ConversationID is the ID of the earliest message in the pair and is shared by
// both participant rows.
type ConversationHead struct {
	ConversationID uint       `json:"conversation_id" gorm:"primaryKey;not null"`
	UserID         uint       `json:"user_id" gorm:"primaryKey;not null;uniqueIndex:ux_conversation_heads_user_peer,priority:1;check:chk_conversation_heads_distinct_users,user_id <> peer_user_id"`
	PeerUserID     uint       `json:"peer_user_id" gorm:"not null;uniqueIndex:ux_conversation_heads_user_peer,priority:2"`
	LastMessageID  *uint      `json:"last_message_id" gorm:"index:idx_conversation_heads_last_message_id"`
	LastMessageAt  *time.Time `json:"last_message_at"`
	UnreadCount    int64      `json:"unread_count" gorm:"not null;default:0;check:chk_conversation_heads_unread_nonnegative,unread_count >= 0"`
	IsPinned       bool       `json:"is_pinned" gorm:"not null;default:false"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`

	User        User     `json:"-" gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE;"`
	PeerUser    User     `json:"peer_user,omitempty" gorm:"foreignKey:PeerUserID;constraint:OnDelete:CASCADE;"`
	LastMessage *Message `json:"last_message,omitempty" gorm:"foreignKey:LastMessageID;constraint:OnDelete:SET NULL;"`
}
