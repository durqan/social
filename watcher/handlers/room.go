package handlers

import (
	"encoding/json"
	"net/http"
	"watcher_back/dto"
	"watcher_back/models"
	"watcher_back/store"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func CreateRoom() gin.HandlerFunc {
	return func(c *gin.Context) {
		req := dto.CreateRoomReq{}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.VideoURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "VideoURL is empty"})
			return
		}

		roomID := uuid.NewString()

		room := models.Room{
			ID:       roomID,
			VideoURL: req.VideoURL,
		}

		store.SaveRoom(room)

		c.JSON(http.StatusCreated, dto.CreateRoomResp{
			RoomID:   roomID,
			VideoURL: req.VideoURL,
		})
	}
}

func JoinRoom() gin.HandlerFunc {
	return func(c *gin.Context) {
		roomId := c.Param("roomId")
		_, ok := store.GetRoom(roomId)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		store.AddClient(roomId, conn)
		defer store.RemoveClient(roomId, conn)

		state := store.GetRoomState(roomId)

		if err := conn.WriteJSON(dto.WSMessage{
			Type:   dto.WSMessageTypeSync,
			Time:   state.CurrentTime,
			Paused: state.Paused,
		}); err != nil {
			return
		}

		for {
			messageType, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var wsMsg dto.WSMessage

			if err := json.Unmarshal(msg, &wsMsg); err != nil {
				continue
			}

			if !dto.IsAllowedWSMessageType(wsMsg.Type) {
				continue
			}

			if wsMsg.Type == dto.WSMessageTypeMessage {
				store.BroadcastAll(roomId, messageType, msg)
				continue
			}

			store.UpdateRoomState(roomId, wsMsg)
			store.Broadcast(roomId, conn, messageType, msg)
		}
	}
}

func GetRoom() gin.HandlerFunc {
	return func(c *gin.Context) {
		roomId := c.Param("roomId")

		room, ok := store.GetRoom(roomId)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
			return
		}

		c.JSON(http.StatusOK, room)
	}
}

func GetRoomStatus() gin.HandlerFunc {
	return func(c *gin.Context) {
		roomId := c.Param("roomId")

		if _, ok := store.GetRoom(roomId); !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
			return
		}

		c.JSON(http.StatusOK, dto.RoomStatusResp{
			ClientCount: store.GetClientCount(roomId),
		})
	}
}
