package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// --- notes ---------------------------------------------------------------------

type Note struct {
	ID        string    `json:"id"`
	AuthorID  *string   `json:"authorId"`
	Body      string    `json:"body"`
	Quote     string    `json:"quote"`
	Source    string    `json:"source"`
	Clock     int       `json:"clock"`
	Loc       string    `json:"loc"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const noteColumns = `id, author_id, body, quote, source, clock, at_loc, created_at, updated_at`

func scanNote(row pgx.Row) (Note, error) {
	var n Note
	err := row.Scan(&n.ID, &n.AuthorID, &n.Body, &n.Quote, &n.Source, &n.Clock, &n.Loc, &n.CreatedAt, &n.UpdatedAt)
	return n, err
}

func (s *Server) notes(ctx context.Context, teamID string) ([]Note, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+noteColumns+` FROM notes WHERE team_id = $1 ORDER BY created_at`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Note{}
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// noteText trims and checks a note's comment. A note needs a comment, a quote, or both.
func noteText(body, quote string) (string, string, error) {
	body = strings.TrimSpace(body)
	quote = strings.Join(strings.Fields(quote), " ")
	if body == "" && quote == "" {
		return "", "", errStatus(400, "the note is empty")
	}
	if utf8.RuneCountInString(body) > 4000 {
		return "", "", errStatus(400, "notes are limited to 4000 characters")
	}
	if utf8.RuneCountInString(quote) > 2000 {
		return "", "", errStatus(400, "quotes are limited to 2000 characters")
	}
	return body, quote, nil
}

// checkSource makes sure a quote's source is something the team has actually seen.
func (s *Server) checkSource(ctx context.Context, teamID, src string, chapters []string, st interface {
	Has(kind, id string) bool
}, chapter int) error {
	if src == "" {
		return nil
	}
	kind, id, ok := strings.Cut(src, ":")
	if !ok || id == "" || len(src) > 120 {
		return errStatus(400, "bad note source")
	}
	switch kind {
	case "doc", "person", "loc":
		if st.Has(kind, id) {
			return nil
		}
	case "event":
		var exists bool
		_ = s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM team_events WHERE team_id = $1 AND id::text = $2)`, teamID, id).Scan(&exists)
		if exists {
			return nil
		}
	case "chapter":
		for i, c := range chapters {
			if c == id && i <= chapter {
				return nil
			}
		}
	case "case":
		if id == "intro" {
			return nil
		}
	}
	return errStatus(422, "you can't quote something you haven't found")
}

func (s *Server) createNote(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	var in struct {
		Body   string `json:"body"`
		Quote  string `json:"quote"`
		Source string `json:"source"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	body, quote, err := noteText(in.Body, in.Quote)
	if err != nil {
		writeErr(w, err)
		return
	}
	eng, st, err := s.readTeam(r.Context(), t)
	if err != nil {
		writeErr(w, err)
		return
	}
	if quote == "" {
		in.Source = ""
	}
	chapters := make([]string, len(eng.Case.Chapters))
	for i, c := range eng.Case.Chapters {
		chapters[i] = c.ID
	}
	if err := s.checkSource(r.Context(), t.ID, in.Source, chapters, st, st.Chapter); err != nil {
		writeErr(w, err)
		return
	}
	n, err := scanNote(s.pool.QueryRow(r.Context(), `
		INSERT INTO notes (team_id, author_id, body, quote, source, clock, at_loc) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+noteColumns, t.ID, u.ID, body, quote, in.Source, st.Clock, st.Current))
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r.Context(), t.ID, Event{Type: "note.upsert", By: u.ID, Payload: n})
	writeJSON(w, 201, n)
}

// updateNote edits a note's comment. The quote and where it came from don't change.
func (s *Server) updateNote(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	var in struct {
		Body string `json:"body"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	var quote string
	err := s.pool.QueryRow(r.Context(), `SELECT quote FROM notes WHERE id::text = $2 AND team_id = $1`, t.ID, chi.URLParam(r, "noteID")).Scan(&quote)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, errNotFound)
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	body, _, err := noteText(in.Body, quote)
	if err != nil {
		writeErr(w, err)
		return
	}
	n, err := scanNote(s.pool.QueryRow(r.Context(), `UPDATE notes SET body = $3, updated_at = now() WHERE id::text = $2 AND team_id = $1
		RETURNING `+noteColumns, t.ID, chi.URLParam(r, "noteID"), body))
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, errNotFound)
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r.Context(), t.ID, Event{Type: "note.upsert", By: u.ID, Payload: n})
	writeJSON(w, 200, n)
}

func (s *Server) deleteNote(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	id := chi.URLParam(r, "noteID")
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM notes WHERE id::text = $2 AND team_id = $1`, t.ID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, errNotFound)
		return
	}
	// Board cards pinned to this note go with it.
	rows, _ := s.pool.Query(r.Context(), `DELETE FROM board_items WHERE team_id = $1 AND ref_kind = 'note' AND ref_id = $2 RETURNING id`, t.ID, id)
	var removed []string
	for rows.Next() {
		var itemID string
		_ = rows.Scan(&itemID)
		removed = append(removed, itemID)
	}
	rows.Close()
	s.publish(r.Context(), t.ID, Event{Type: "note.delete", By: u.ID, Payload: map[string]string{"id": id}})
	for _, itemID := range removed {
		s.publish(r.Context(), t.ID, Event{Type: "board.item.delete", By: u.ID, Payload: map[string]string{"id": itemID}})
	}
	w.WriteHeader(204)
}

// --- evidence board --------------------------------------------------------------

type BoardItem struct {
	ID        string  `json:"id"`
	RefKind   string  `json:"refKind"`
	RefID     string  `json:"refId"`
	Label     string  `json:"label"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	CreatedBy *string `json:"createdBy"`
}

type BoardLink struct {
	ID    string `json:"id"`
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label"`
}

type Board struct {
	Items []BoardItem `json:"items"`
	Links []BoardLink `json:"links"`
}

func (s *Server) board(ctx context.Context, teamID string) (Board, error) {
	b := Board{Items: []BoardItem{}, Links: []BoardLink{}}
	rows, err := s.pool.Query(ctx, `SELECT id, ref_kind, ref_id, label, x, y, created_by FROM board_items WHERE team_id = $1 ORDER BY created_at`, teamID)
	if err != nil {
		return b, err
	}
	for rows.Next() {
		var it BoardItem
		if err := rows.Scan(&it.ID, &it.RefKind, &it.RefID, &it.Label, &it.X, &it.Y, &it.CreatedBy); err != nil {
			rows.Close()
			return b, err
		}
		b.Items = append(b.Items, it)
	}
	rows.Close()
	rows, err = s.pool.Query(ctx, `SELECT id, from_item, to_item, label FROM board_links WHERE team_id = $1 ORDER BY created_at`, teamID)
	if err != nil {
		return b, err
	}
	defer rows.Close()
	for rows.Next() {
		var l BoardLink
		if err := rows.Scan(&l.ID, &l.From, &l.To, &l.Label); err != nil {
			return b, err
		}
		b.Links = append(b.Links, l)
	}
	return b, rows.Err()
}

const boardSize = 4000.0

func clampBoard(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > boardSize {
		return boardSize
	}
	return v
}

func (s *Server) createBoardItem(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	var in BoardItem
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	in.Label = strings.TrimSpace(in.Label)
	if utf8.RuneCountInString(in.Label) > 300 {
		writeErr(w, errStatus(400, "card text is limited to 300 characters"))
		return
	}
	switch in.RefKind {
	case "doc", "person", "loc":
		_, st, err := s.readTeam(r.Context(), t)
		if err != nil {
			writeErr(w, err)
			return
		}
		if !st.Has(in.RefKind, in.RefID) {
			writeErr(w, errStatus(422, "you haven't found that yet"))
			return
		}
	case "note":
		var ok bool
		_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM notes WHERE team_id = $1 AND id::text = $2)`, t.ID, in.RefID).Scan(&ok)
		if !ok {
			writeErr(w, errNotFound)
			return
		}
	case "text":
		if in.Label == "" {
			writeErr(w, errStatus(400, "write something on the card"))
			return
		}
		in.RefID = ""
	default:
		writeErr(w, errStatus(400, "unknown card type"))
		return
	}
	var count int
	_ = s.pool.QueryRow(r.Context(), `SELECT count(*) FROM board_items WHERE team_id = $1`, t.ID).Scan(&count)
	if count >= 400 {
		writeErr(w, errStatus(409, "the board is full"))
		return
	}
	err := s.pool.QueryRow(r.Context(), `INSERT INTO board_items (team_id, ref_kind, ref_id, label, x, y, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_by`,
		t.ID, in.RefKind, in.RefID, in.Label, clampBoard(in.X), clampBoard(in.Y), u.ID).Scan(&in.ID, &in.CreatedBy)
	if err != nil {
		writeErr(w, err)
		return
	}
	in.X, in.Y = clampBoard(in.X), clampBoard(in.Y)
	s.publish(r.Context(), t.ID, Event{Type: "board.item", By: u.ID, Payload: in})
	writeJSON(w, 201, in)
}

func (s *Server) updateBoardItem(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	var in struct {
		X     *float64 `json:"x"`
		Y     *float64 `json:"y"`
		Label *string  `json:"label"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	var it BoardItem
	err := s.pool.QueryRow(r.Context(), `
		UPDATE board_items SET
			x = coalesce($3, x), y = coalesce($4, y), label = coalesce($5, label)
		WHERE team_id = $1 AND id::text = $2
		RETURNING id, ref_kind, ref_id, label, x, y, created_by`,
		t.ID, chi.URLParam(r, "itemID"), clampPtr(in.X), clampPtr(in.Y), trimPtr(in.Label, 300)).
		Scan(&it.ID, &it.RefKind, &it.RefID, &it.Label, &it.X, &it.Y, &it.CreatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, errNotFound)
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r.Context(), t.ID, Event{Type: "board.item", By: u.ID, Payload: it})
	writeJSON(w, 200, it)
}

func clampPtr(v *float64) *float64 {
	if v == nil {
		return nil
	}
	c := clampBoard(*v)
	return &c
}

func trimPtr(s *string, max int) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if r := []rune(t); len(r) > max {
		t = string(r[:max])
	}
	return &t
}

func (s *Server) deleteBoardItem(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	id := chi.URLParam(r, "itemID")
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM board_items WHERE team_id = $1 AND id::text = $2`, t.ID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, errNotFound)
		return
	}
	s.publish(r.Context(), t.ID, Event{Type: "board.item.delete", By: u.ID, Payload: map[string]string{"id": id}})
	w.WriteHeader(204)
}

func (s *Server) createBoardLink(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	var in BoardLink
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in.From == in.To {
		writeErr(w, errStatus(400, "a card can't be linked to itself"))
		return
	}
	label := trimPtr(&in.Label, 80)
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO board_links (team_id, from_item, to_item, label)
		SELECT $1, a.id, b.id, $4 FROM board_items a, board_items b
		WHERE a.team_id = $1 AND b.team_id = $1 AND a.id::text = $2 AND b.id::text = $3
		ON CONFLICT (from_item, to_item) DO UPDATE SET label = excluded.label
		RETURNING id, from_item, to_item, label`, t.ID, in.From, in.To, *label).
		Scan(&in.ID, &in.From, &in.To, &in.Label)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, errNotFound)
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r.Context(), t.ID, Event{Type: "board.link", By: u.ID, Payload: in})
	writeJSON(w, 201, in)
}

func (s *Server) updateBoardLink(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	var in struct {
		Label string `json:"label"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	var l BoardLink
	err := s.pool.QueryRow(r.Context(), `UPDATE board_links SET label = $3 WHERE team_id = $1 AND id::text = $2
		RETURNING id, from_item, to_item, label`, t.ID, chi.URLParam(r, "linkID"), *trimPtr(&in.Label, 80)).
		Scan(&l.ID, &l.From, &l.To, &l.Label)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, errNotFound)
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r.Context(), t.ID, Event{Type: "board.link", By: u.ID, Payload: l})
	writeJSON(w, 200, l)
}

func (s *Server) deleteBoardLink(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	id := chi.URLParam(r, "linkID")
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM board_links WHERE team_id = $1 AND id::text = $2`, t.ID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, errNotFound)
		return
	}
	s.publish(r.Context(), t.ID, Event{Type: "board.link.delete", By: u.ID, Payload: map[string]string{"id": id}})
	w.WriteHeader(204)
}

// --- chat ------------------------------------------------------------------------

type ChatMessage struct {
	ID        int64     `json:"id"`
	UserID    *string   `json:"userId"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *Server) chat(ctx context.Context, teamID string) ([]ChatMessage, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, user_id, body, created_at FROM (
		SELECT * FROM chat_messages WHERE team_id = $1 ORDER BY id DESC LIMIT 200) m ORDER BY id`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatMessage{}
	for rows.Next() {
		var m ChatMessage
		if err := rows.Scan(&m.ID, &m.UserID, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Server) postChat(w http.ResponseWriter, r *http.Request) {
	u, t := currentUser(r), teamFrom(r)
	var in struct {
		Body string `json:"body"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	body := strings.TrimSpace(in.Body)
	if body == "" || utf8.RuneCountInString(body) > 1000 {
		writeErr(w, errStatus(400, "messages must be 1–1000 characters"))
		return
	}
	var m ChatMessage
	err := s.pool.QueryRow(r.Context(), `INSERT INTO chat_messages (team_id, user_id, body) VALUES ($1, $2, $3)
		RETURNING id, user_id, body, created_at`, t.ID, u.ID, body).Scan(&m.ID, &m.UserID, &m.Body, &m.CreatedAt)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r.Context(), t.ID, Event{Type: "chat", By: u.ID, Payload: m})
	writeJSON(w, 201, m)
}
