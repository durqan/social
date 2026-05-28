package models

import "time"

type Room struct {
	ID       string `json:"id"`
	VideoURL string `json:"video_url"`
}

type RoomState struct {
	CurrentTime float64   `json:"time"`
	Paused      bool      `json:"paused"`
	UpdatedAt   time.Time `json:"-"`
}
