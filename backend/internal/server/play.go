package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rizface/detective-game/backend/internal/game"
)

type EventRow struct {
	ID        int64           `json:"id"`
	Kind      string          `json:"kind"`
	By        *string         `json:"by"`
	Payload   json.RawMessage `json:"payload"`
	Clock     int             `json:"clock"`
	CreatedAt time.Time       `json:"createdAt"`
}

func (s *Server) snapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	t := teamFrom(r)
	eng, st, err := s.readTeam(ctx, t)
	if err != nil {
		writeErr(w, err)
		return
	}
	snap := Snapshot{Team: t, You: currentUser(r).ID, Case: caseView(eng, st), Game: gameView(eng, st)}
	if snap.Members, err = s.members(ctx, t.ID); err != nil {
		writeErr(w, err)
		return
	}
	if snap.Notes, err = s.notes(ctx, t.ID); err != nil {
		writeErr(w, err)
		return
	}
	if snap.Board, err = s.board(ctx, t.ID); err != nil {
		writeErr(w, err)
		return
	}
	if snap.Chat, err = s.chat(ctx, t.ID); err != nil {
		writeErr(w, err)
		return
	}
	if snap.Events, err = s.eventPage(ctx, t.ID, 0, 120); err != nil {
		writeErr(w, err)
		return
	}
	if snap.Draft, err = s.draft(ctx, t.ID); err != nil {
		writeErr(w, err)
		return
	}
	if snap.Attempts, err = s.attempts(ctx, t.ID); err != nil {
		writeErr(w, err)
		return
	}
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT result FROM teams WHERE id = $1`, t.ID).Scan(&raw); err != nil {
		writeErr(w, err)
		return
	}
	if raw != nil {
		snap.Result = decodeJSON[*Result](raw)
	}
	writeJSON(w, 200, snap)
}

// eventPage returns events newest-first before an id (0 = latest), then
// reverses them into chronological order.
func (s *Server) eventPage(ctx context.Context, teamID string, before int64, limit int) ([]EventRow, error) {
	if before <= 0 {
		before = 1<<62 - 1
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, kind, user_id, payload, clock, created_at FROM team_events
		WHERE team_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3`, teamID, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EventRow{}
	for rows.Next() {
		var e EventRow
		var by *string
		if err := rows.Scan(&e.ID, &e.Kind, &by, &e.Payload, &e.Clock, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.By = by
		out = append(out, e)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	list, err := s.eventPage(r.Context(), teamFrom(r).ID, before, 120)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, list)
}

func gameErr(err error) error {
	switch {
	case errors.Is(err, game.ErrUnknownLocation), errors.Is(err, game.ErrNotHere), errors.Is(err, game.ErrUnknownTopic),
		errors.Is(err, game.ErrUnknownPerson), errors.Is(err, game.ErrEmptyQuery):
		return errStatus(422, err.Error())
	}
	return err
}

// act runs one game action under the team lock, stores the outcome, and
// broadcasts the change.
func (s *Server) act(w http.ResponseWriter, r *http.Request, run func(e *game.Engine, st *game.State) (*game.Outcome, error)) {
	ctx := r.Context()
	u := currentUser(r)
	l, err := s.lockTeam(ctx, teamFrom(r))
	if err != nil {
		writeErr(w, err)
		return
	}
	defer l.tx.Rollback(ctx)
	out, err := run(l.engine, l.state)
	if err != nil {
		writeErr(w, gameErr(err))
		return
	}
	if out.Scenes == nil {
		out.Scenes = []game.Scene{}
	}
	stateJSON, _ := json.Marshal(l.state)
	if _, err := l.tx.Exec(ctx, `UPDATE teams SET state = $2, updated_at = now() WHERE id = $1`, l.team.ID, stateJSON); err != nil {
		writeErr(w, err)
		return
	}
	ev := EventRow{Kind: "action", By: &u.ID, Clock: l.state.Clock}
	ev.Payload, _ = json.Marshal(out)
	if err := l.tx.QueryRow(ctx, `INSERT INTO team_events (team_id, user_id, kind, payload, clock) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
		l.team.ID, u.ID, ev.Kind, ev.Payload, ev.Clock).Scan(&ev.ID, &ev.CreatedAt); err != nil {
		writeErr(w, err)
		return
	}
	if err := l.tx.Commit(ctx); err != nil {
		writeErr(w, err)
		return
	}
	d := delta(l.engine, l.state, out)
	d.Event = &ev
	s.publish(ctx, l.team.ID, Event{Type: "game", By: u.ID, Payload: d})
	writeJSON(w, 200, d)
}

func (s *Server) travel(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Location string `json:"location"`
		Address  string `json:"address"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	s.act(w, r, func(e *game.Engine, st *game.State) (*game.Outcome, error) {
		if strings.TrimSpace(in.Address) != "" {
			return e.TravelAddress(st, in.Address)
		}
		return e.Travel(st, in.Location)
	})
}

func (s *Server) ask(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Person string `json:"person"`
		Topic  string `json:"topic"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in.Topic == "" {
		in.Topic = "intro"
	}
	s.act(w, r, func(e *game.Engine, st *game.State) (*game.Outcome, error) {
		return e.Ask(st, in.Person, in.Topic)
	})
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Query string `json:"query"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if len(in.Query) > 80 {
		writeErr(w, errStatus(400, "that's a long name"))
		return
	}
	s.act(w, r, func(e *game.Engine, st *game.State) (*game.Outcome, error) {
		return e.Search(st, in.Query)
	})
}
