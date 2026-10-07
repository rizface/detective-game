package server

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/rizface/detective-game/backend/internal/casefmt"
	"github.com/rizface/detective-game/backend/internal/game"
)

const maxTeamSize = 6

var memberColors = []string{"#d9a441", "#c8553d", "#6fa8dc", "#8fbf7f", "#b48ead", "#e6e1cf"}

type Team struct {
	ID           string    `json:"id"`
	CaseID       string    `json:"caseId"`
	Name         string    `json:"name"`
	InviteCode   string    `json:"inviteCode"`
	OwnerID      string    `json:"ownerId"`
	Status       string    `json:"status"`
	AttemptsUsed int       `json:"attemptsUsed"`
	MaxAttempts  int       `json:"maxAttempts"`
	CreatedAt    time.Time `json:"createdAt"`
}

func teamFrom(r *http.Request) *Team {
	t, _ := r.Context().Value(teamKey).(*Team)
	return t
}

const teamColumns = `t.id, t.case_id, t.name, t.invite_code, t.owner_id, t.status, t.attempts_used, t.max_attempts, t.created_at`

func scanTeam(row pgx.Row) (*Team, error) {
	var t Team
	err := row.Scan(&t.ID, &t.CaseID, &t.Name, &t.InviteCode, &t.OwnerID, &t.Status, &t.AttemptsUsed, &t.MaxAttempts, &t.CreatedAt)
	return &t, err
}

// requireMember loads the team from the URL and checks membership.
func (s *Server) requireMember(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := currentUser(r)
		id := chi.URLParam(r, "teamID")
		t, err := scanTeam(s.pool.QueryRow(r.Context(), `
			SELECT `+teamColumns+` FROM teams t
			JOIN team_members m ON m.team_id = t.id AND m.user_id = $2
			WHERE t.id::text = $1`, id, u.ID))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeErr(w, errNotFound)
				return
			}
			writeErr(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), teamKey, t)))
	})
}

// --- case library -----------------------------------------------------------

type CaseSummary struct {
	ID               string `json:"id"`
	Slug             string `json:"slug"`
	Title            string `json:"title"`
	Tagline          string `json:"tagline"`
	Blurb            string `json:"blurb"`
	Setting          string `json:"setting"`
	Difficulty       string `json:"difficulty"`
	EstimatedMinutes int    `json:"estimatedMinutes"`
	Players          string `json:"players"`
	Published        bool   `json:"published"`
}

func (s *Server) listCases(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, slug, title, published,
		       coalesce(content->>'tagline', ''), coalesce(content->>'blurb', ''), coalesce(content->>'setting', ''),
		       coalesce(content->>'difficulty', ''), coalesce((content->>'estimatedMinutes')::int, 0), coalesce(content->>'players', '')
		FROM cases WHERE published OR $1
		ORDER BY published DESC, created_at`, u.IsAdmin)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer rows.Close()
	list := []CaseSummary{}
	for rows.Next() {
		var c CaseSummary
		if err := rows.Scan(&c.ID, &c.Slug, &c.Title, &c.Published, &c.Tagline, &c.Blurb, &c.Setting, &c.Difficulty, &c.EstimatedMinutes, &c.Players); err != nil {
			writeErr(w, err)
			return
		}
		list = append(list, c)
	}
	writeJSON(w, 200, list)
}

func (s *Server) caseBySlug(ctx context.Context, slug string, admin bool) (*CaseSummary, error) {
	var c CaseSummary
	err := s.pool.QueryRow(ctx, `
		SELECT id, slug, title, published,
		       coalesce(content->>'tagline', ''), coalesce(content->>'blurb', ''), coalesce(content->>'setting', ''),
		       coalesce(content->>'difficulty', ''), coalesce((content->>'estimatedMinutes')::int, 0), coalesce(content->>'players', '')
		FROM cases WHERE slug = $1 AND (published OR $2)`, slug, admin).
		Scan(&c.ID, &c.Slug, &c.Title, &c.Published, &c.Tagline, &c.Blurb, &c.Setting, &c.Difficulty, &c.EstimatedMinutes, &c.Players)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	return &c, err
}

func (s *Server) getCase(w http.ResponseWriter, r *http.Request) {
	c, err := s.caseBySlug(r.Context(), chi.URLParam(r, "slug"), currentUser(r).IsAdmin)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, c)
}

// --- teams -------------------------------------------------------------------

type TeamListing struct {
	Team
	CaseSlug  string    `json:"caseSlug"`
	CaseTitle string    `json:"caseTitle"`
	Members   []string  `json:"members"`
	UpdatedAt time.Time `json:"updatedAt"`
	Chapter   int       `json:"chapter"`
	Chapters  int       `json:"chapters"`
}

func (s *Server) myTeams(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	rows, err := s.pool.Query(r.Context(), `
		SELECT `+teamColumns+`, c.slug, c.title, t.updated_at,
		       coalesce((t.state->>'chapter')::int, 0), jsonb_array_length(coalesce(c.content->'chapters', '[]'::jsonb)),
		       (SELECT array_agg(u.display_name ORDER BY m2.joined_at) FROM team_members m2 JOIN users u ON u.id = m2.user_id WHERE m2.team_id = t.id)
		FROM teams t
		JOIN team_members m ON m.team_id = t.id AND m.user_id = $1
		JOIN cases c ON c.id = t.case_id
		ORDER BY t.updated_at DESC`, u.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer rows.Close()
	list := []TeamListing{}
	for rows.Next() {
		var t TeamListing
		if err := rows.Scan(&t.ID, &t.CaseID, &t.Name, &t.InviteCode, &t.OwnerID, &t.Status, &t.AttemptsUsed, &t.MaxAttempts, &t.CreatedAt,
			&t.CaseSlug, &t.CaseTitle, &t.UpdatedAt, &t.Chapter, &t.Chapters, &t.Members); err != nil {
			writeErr(w, err)
			return
		}
		list = append(list, t)
	}
	writeJSON(w, 200, list)
}

func inviteCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		b[i] = alphabet[n.Int64()]
	}
	return string(b)
}

func (s *Server) createTeam(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var in struct {
		CaseSlug string `json:"caseSlug"`
		Name     string `json:"name"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		in.Name = u.DisplayName + "'s agency"
	}
	if utf8.RuneCountInString(in.Name) > 48 {
		writeErr(w, errStatus(400, "keep the agency name under 48 characters"))
		return
	}
	cs, err := s.caseBySlug(r.Context(), in.CaseSlug, u.IsAdmin)
	if err != nil {
		writeErr(w, err)
		return
	}
	eng, err := s.cases.engine(r.Context(), cs.ID)
	if err != nil {
		writeErr(w, err)
		return
	}
	st := game.NewState(eng.Case)
	stateJSON, _ := json.Marshal(st)

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var teamID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO teams (case_id, case_version, name, invite_code, owner_id, state, max_attempts)
		VALUES ($1, (SELECT version FROM cases WHERE id = $1), $2, $3, $4, $5, $6) RETURNING id`,
		cs.ID, in.Name, inviteCode(), u.ID, stateJSON, eng.MaxAttempts()).Scan(&teamID)
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO team_members (team_id, user_id, color) VALUES ($1, $2, $3)`, teamID, u.ID, memberColors[0]); err != nil {
		writeErr(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO team_events (team_id, user_id, kind, payload, clock) VALUES ($1, $2, 'opened', $3, 0)`,
		teamID, u.ID, map[string]any{"name": in.Name}); err != nil {
		writeErr(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"id": teamID})
}

func (s *Server) previewInvite(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(chi.URLParam(r, "code"))
	var out struct {
		TeamID    string   `json:"teamId"`
		TeamName  string   `json:"teamName"`
		CaseTitle string   `json:"caseTitle"`
		CaseSlug  string   `json:"caseSlug"`
		Status    string   `json:"status"`
		Members   []string `json:"members"`
		IsMember  bool     `json:"isMember"`
	}
	err := s.pool.QueryRow(r.Context(), `
		SELECT t.id, t.name, c.title, c.slug, t.status,
		       coalesce((SELECT array_agg(u.display_name ORDER BY m.joined_at) FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = t.id), '{}'),
		       EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id AND m.user_id = $2)
		FROM teams t JOIN cases c ON c.id = t.case_id WHERE t.invite_code = $1`, code, currentUser(r).ID).
		Scan(&out.TeamID, &out.TeamName, &out.CaseTitle, &out.CaseSlug, &out.Status, &out.Members, &out.IsMember)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, errStatus(404, "that invite link isn't valid"))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, out)
}

func (s *Server) joinTeam(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	code := strings.ToUpper(chi.URLParam(r, "code"))
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var teamID string
	if err := tx.QueryRow(r.Context(), `SELECT id FROM teams WHERE invite_code = $1 FOR UPDATE`, code).Scan(&teamID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, errStatus(404, "that invite link isn't valid"))
			return
		}
		writeErr(w, err)
		return
	}
	var already bool
	var count int
	if err := tx.QueryRow(r.Context(), `SELECT count(*), bool_or(user_id = $2) FROM team_members WHERE team_id = $1`, teamID, u.ID).Scan(&count, &already); err != nil {
		writeErr(w, err)
		return
	}
	if already {
		writeJSON(w, 200, map[string]string{"id": teamID})
		return
	}
	if count >= maxTeamSize {
		writeErr(w, errStatus(409, "this team is full (6 detectives max)"))
		return
	}
	// Pick the first colour nobody on the team uses.
	used := map[string]bool{}
	rows, err := tx.Query(r.Context(), `SELECT color FROM team_members WHERE team_id = $1`, teamID)
	if err != nil {
		writeErr(w, err)
		return
	}
	for rows.Next() {
		var c string
		_ = rows.Scan(&c)
		used[c] = true
	}
	rows.Close()
	color := memberColors[count%len(memberColors)]
	for _, c := range memberColors {
		if !used[c] {
			color = c
			break
		}
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO team_members (team_id, user_id, color) VALUES ($1, $2, $3)`, teamID, u.ID, color); err != nil {
		writeErr(w, err)
		return
	}
	var clock int
	_ = tx.QueryRow(r.Context(), `SELECT coalesce((state->>'clock')::int, 0) FROM teams WHERE id = $1`, teamID).Scan(&clock)
	if _, err := tx.Exec(r.Context(), `INSERT INTO team_events (team_id, user_id, kind, payload, clock) VALUES ($1, $2, 'joined', '{}', $3)`, teamID, u.ID, clock); err != nil {
		writeErr(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r.Context(), teamID, Event{Type: "member.joined", By: u.ID, Payload: Member{ID: u.ID, DisplayName: u.DisplayName, Color: color}})
	writeJSON(w, 200, map[string]string{"id": teamID})
}

func (s *Server) leaveTeam(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	t := teamFrom(r)
	if t.OwnerID == u.ID {
		writeErr(w, errStatus(409, "the team's founder can't leave the case"))
		return
	}
	if _, err := s.pool.Exec(r.Context(), `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, t.ID, u.ID); err != nil {
		writeErr(w, err)
		return
	}
	s.publish(r.Context(), t.ID, Event{Type: "member.left", By: u.ID})
	w.WriteHeader(204)
}

// --- loading a team with its engine -------------------------------------------

type loaded struct {
	team   *Team
	engine *game.Engine
	state  *game.State
	tx     pgx.Tx
}

// lockTeam opens a transaction and locks the team row, so concurrent actions
// from teammates apply one after another.
func (s *Server) lockTeam(ctx context.Context, t *Team) (*loaded, error) {
	eng, err := s.cases.engine(ctx, t.CaseID)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	var raw []byte
	fresh, err := scanTeam(tx.QueryRow(ctx, `SELECT `+teamColumns+` FROM teams t WHERE t.id = $1 FOR UPDATE`, t.ID))
	if err == nil {
		err = tx.QueryRow(ctx, `SELECT state FROM teams WHERE id = $1`, t.ID).Scan(&raw)
	}
	if err != nil {
		tx.Rollback(ctx)
		return nil, err
	}
	var st game.State
	if err := json.Unmarshal(raw, &st); err != nil {
		tx.Rollback(ctx)
		return nil, err
	}
	st.Bind(eng.Case)
	return &loaded{team: fresh, engine: eng, state: &st, tx: tx}, nil
}

func (s *Server) readTeam(ctx context.Context, t *Team) (*game.Engine, *game.State, error) {
	eng, err := s.cases.engine(ctx, t.CaseID)
	if err != nil {
		return nil, nil, err
	}
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT state FROM teams WHERE id = $1`, t.ID).Scan(&raw); err != nil {
		return nil, nil, err
	}
	var st game.State
	if err := json.Unmarshal(raw, &st); err != nil {
		return nil, nil, err
	}
	st.Bind(eng.Case)
	return eng, &st, nil
}

var _ = casefmt.Reveal{}
