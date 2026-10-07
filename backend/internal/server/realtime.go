package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
)

// Real-time sync: every change to a team is published on the Redis channel
// team:<id>. Each server instance subscribes to team:* and forwards messages to
// its own WebSocket clients, so any number of instances can run side by side.
//
// Presence lives in a Redis sorted set per team (member -> last heartbeat).

type Event struct {
	Type    string `json:"type"`
	By      string `json:"by,omitempty"`     // user id
	Origin  string `json:"origin,omitempty"` // connection id, so senders can skip their own echo
	Payload any    `json:"payload,omitempty"`
}

type client struct {
	id     string
	userID string
	teamID string
	send   chan []byte
}

type hub struct {
	rdb     *redis.Client
	mu      sync.RWMutex
	clients map[string]map[*client]struct{}
	nextID  int64
}

func newHub(rdb *redis.Client) *hub {
	return &hub{rdb: rdb, clients: map[string]map[*client]struct{}{}}
}

func (h *hub) run(ctx context.Context) {
	for ctx.Err() == nil {
		sub := h.rdb.PSubscribe(ctx, "team:*")
		ch := sub.Channel()
		for msg := range ch {
			teamID := strings.TrimPrefix(msg.Channel, "team:")
			h.deliver(teamID, []byte(msg.Payload))
		}
		sub.Close()
		if ctx.Err() == nil {
			slog.Warn("redis subscription closed; reconnecting")
			time.Sleep(time.Second)
		}
	}
}

func (h *hub) deliver(teamID string, data []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients[teamID] {
		select {
		case c.send <- data:
		default: // slow client; it will resync on reconnect
		}
	}
}

func (h *hub) add(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[c.teamID] == nil {
		h.clients[c.teamID] = map[*client]struct{}{}
	}
	h.clients[c.teamID][c] = struct{}{}
}

func (h *hub) remove(c *client) (userStillHere bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients[c.teamID], c)
	for other := range h.clients[c.teamID] {
		if other.userID == c.userID {
			userStillHere = true
		}
	}
	if len(h.clients[c.teamID]) == 0 {
		delete(h.clients, c.teamID)
	}
	return
}

// publish sends an event to every connected member of a team.
func (s *Server) publish(ctx context.Context, teamID string, ev Event) {
	data, err := json.Marshal(ev)
	if err != nil {
		slog.Error("marshal event", "err", err)
		return
	}
	if err := s.rdb.Publish(ctx, "team:"+teamID, data).Err(); err != nil {
		slog.Error("publish event", "err", err)
	}
}

const presenceWindow = 45 * time.Second

func (s *Server) touchPresence(ctx context.Context, teamID, userID string) {
	s.rdb.ZAdd(ctx, "presence:"+teamID, redis.Z{Score: float64(time.Now().Unix()), Member: userID})
	s.rdb.Expire(ctx, "presence:"+teamID, time.Hour)
}

// online returns the ids of members seen recently.
func (s *Server) online(ctx context.Context, teamID string) map[string]bool {
	min := strconv.FormatInt(time.Now().Add(-presenceWindow).Unix(), 10)
	ids, _ := s.rdb.ZRangeByScore(ctx, "presence:"+teamID, &redis.ZRangeBy{Min: min, Max: "+inf"}).Result()
	out := map[string]bool{}
	for _, id := range ids {
		out[id] = true
	}
	return out
}

func (s *Server) broadcastPresence(ctx context.Context, teamID string) {
	ids := []string{}
	for id := range s.online(ctx, teamID) {
		ids = append(ids, id)
	}
	s.publish(ctx, teamID, Event{Type: "presence", Payload: map[string]any{"online": ids}})
}

// Messages clients may send over the socket. They are relayed to teammates
// as-is and never stored: live dragging on the board and "who is reading what".
var relayable = map[string]bool{"board.drag": true, "viewing": true, "typing": true}

func (s *Server) websocket(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	team := teamFrom(r)
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"localhost:*", "127.0.0.1:*"}})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	s.hub.mu.Lock()
	s.hub.nextID++
	id := strconv.FormatInt(s.hub.nextID, 36) + "-" + strconv.FormatInt(time.Now().UnixNano()%1e6, 36)
	s.hub.mu.Unlock()
	c := &client{id: id, userID: u.ID, teamID: team.ID, send: make(chan []byte, 256)}
	s.hub.add(c)

	// Use a background context: the request context ends when the handler
	// returns, and cleanup must still reach Redis.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s.touchPresence(ctx, team.ID, u.ID)
	s.broadcastPresence(ctx, team.ID)
	hello, _ := json.Marshal(Event{Type: "hello", Payload: map[string]string{"connection": id}})
	_ = conn.Write(ctx, websocket.MessageText, hello)

	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-c.send:
				wctx, wcancel := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Write(wctx, websocket.MessageText, msg)
				wcancel()
				if err != nil {
					cancel()
					return
				}
			case <-ticker.C:
				s.touchPresence(ctx, team.ID, u.ID)
				pctx, pcancel := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Ping(pctx)
				pcancel()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	conn.SetReadLimit(64 << 10)
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			break
		}
		var ev Event
		if json.Unmarshal(data, &ev) != nil || !relayable[ev.Type] {
			continue
		}
		ev.By = u.ID
		ev.Origin = c.id
		s.publish(ctx, team.ID, ev)
	}
	cancel()
	if !s.hub.remove(c) {
		bg := context.Background()
		s.rdb.ZRem(bg, "presence:"+team.ID, u.ID)
		s.broadcastPresence(bg, team.ID)
	}
}
