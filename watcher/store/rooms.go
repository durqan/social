package store

import (
	"sync"
	"time"
	"watcher_back/dto"
	"watcher_back/models"

	"github.com/gorilla/websocket"
)

var rooms = make(map[string]models.Room)
var roomClients = make(map[string]map[*websocket.Conn]bool)
var roomStates = make(map[string]models.RoomState)
var roomsMutex sync.RWMutex

func SaveRoom(room models.Room) {
	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	rooms[room.ID] = room
	roomStates[room.ID] = models.RoomState{
		CurrentTime: 0,
		Paused:      true,
		UpdatedAt:   time.Now(),
	}
}

func GetRoom(id string) (models.Room, bool) {
	roomsMutex.RLock()
	defer roomsMutex.RUnlock()

	room, ok := rooms[id]
	return room, ok
}

func AddClient(roomID string, conn *websocket.Conn) {
	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	if roomClients[roomID] == nil {
		roomClients[roomID] = make(map[*websocket.Conn]bool)
	}

	roomClients[roomID][conn] = true
}

func RemoveClient(roomID string, conn *websocket.Conn) {
	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	if roomClients[roomID] == nil {
		return
	}

	delete(roomClients[roomID], conn)
	if len(roomClients[roomID]) == 0 {
		delete(roomClients, roomID)
	}
}

func GetClientCount(roomID string) int {
	roomsMutex.RLock()
	defer roomsMutex.RUnlock()

	return len(roomClients[roomID])
}

func Broadcast(roomID string, sender *websocket.Conn, messageType int, msg []byte) {
	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	if roomClients[roomID] == nil {
		return
	}

	for conn := range roomClients[roomID] {
		if conn == sender {
			continue
		}

		err := conn.WriteMessage(messageType, msg)
		if err != nil {
			conn.Close()
			delete(roomClients[roomID], conn)
		}
	}
	if len(roomClients[roomID]) == 0 {
		delete(roomClients, roomID)
	}
}

func BroadcastAll(roomID string, messageType int, msg []byte) {
	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	if roomClients[roomID] == nil {
		return
	}

	for conn := range roomClients[roomID] {
		err := conn.WriteMessage(messageType, msg)
		if err != nil {
			conn.Close()
			delete(roomClients[roomID], conn)
		}
	}
	if len(roomClients[roomID]) == 0 {
		delete(roomClients, roomID)
	}
}

func GetRoomState(roomId string) models.RoomState {
	roomsMutex.RLock()
	defer roomsMutex.RUnlock()

	state, ok := roomStates[roomId]
	if !ok {
		return models.RoomState{}
	}
	if !state.Paused {
		state.CurrentTime += time.Since(state.UpdatedAt).Seconds()
	}

	return state
}

func UpdateRoomState(roomId string, msg dto.WSMessage) {
	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	state, ok := roomStates[roomId]
	if !ok {
		return
	}

	switch msg.Type {
	case dto.WSMessageTypePlay:
		state.Paused = false
		state.CurrentTime = msg.Time
	case dto.WSMessageTypePause:
		state.Paused = true
		state.CurrentTime = msg.Time
	case dto.WSMessageTypeSeek:
		state.CurrentTime = msg.Time
	case dto.WSMessageTypeSync:
		state.CurrentTime = msg.Time
		state.Paused = msg.Paused
	}
	state.UpdatedAt = time.Now()

	roomStates[roomId] = state
}
