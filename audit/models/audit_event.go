package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type AuditEvent struct {
	ID        uuid.UUID      `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	ActorID   *uuid.UUID     `gorm:"type:uuid" json:"actor_id"`
	Action    string         `gorm:"not null" json:"action"`
	Entity    string         `gorm:"not null" json:"entity"`
	EntityID  *uuid.UUID     `gorm:"type:uuid" json:"entity_id"`
	IP        string         `json:"ip"`
	UserAgent string         `json:"user_agent"`
	Metadata  datatypes.JSON `gorm:"type:jsonb;default:'{}'" json:"metadata"`
	CreatedAt time.Time      `json:"created_at"`
}
