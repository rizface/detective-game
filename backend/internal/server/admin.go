package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/rizface/detective-game/backend/internal/casefmt"
	"github.com/rizface/detective-game/backend/internal/game"
)

// The case editor. Cases bundled with the server are "sealed": the editor
// refuses to open them unless the admin explicitly asks to see spoilers.

type AdminCase struct {
	ID        string    `json:"id"`
	Slug      string    `json:"slug"`
	Title     string    `json:"title"`
	Sealed    bool      `json:"sealed"`
	Published bool      `json:"published"`
	Version   int       `json:"version"`
	Teams     int       `json:"teams"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s *Server) adminListCases(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id, c.slug, c.title, c.sealed, c.published, c.version, c.updated_at,
		       (SELECT count(*) FROM teams t WHERE t.case_id = c.id)
		FROM cases c ORDER BY c.updated_at DESC`)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer rows.Close()
	out := []AdminCase{}
	for rows.Next() {
		var c AdminCase
		if err := rows.Scan(&c.ID, &c.Slug, &c.Title, &c.Sealed, &c.Published, &c.Version, &c.UpdatedAt, &c.Teams); err != nil {
			writeErr(w, err)
			return
		}
		out = append(out, c)
	}
	writeJSON(w, 200, out)
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}$`)

func skeleton(slug, title string) *casefmt.Case {
	return &casefmt.Case{
		Slug: slug, Title: title, Tagline: "", Setting: "", Difficulty: "Medium", EstimatedMinutes: 60, Players: "1–6", Version: 1,
		Clock: casefmt.Clock{Start: "1985-10-14T08:00", DayStartHour: 8, DayEndHour: 23, TravelBase: 20, TravelPerUnit: 8,
			InterviewMinutes: 15, SearchMinutes: 10, ParMinutes: 600},
		Intro:    "The phone rings in your office...",
		Start:    casefmt.Reveal{Locations: []string{"office"}},
		Chapters: []casefmt.Chapter{{ID: "ch1", Title: "Chapter One", Brief: "What the client wants."}},
		Map: casefmt.Map{Name: "The City", Width: 2000, Height: 1400,
			Districts: []casefmt.District{{ID: "downtown", Name: "Downtown", Points: []casefmt.Point{{0, 0}, {2000, 0}, {2000, 1400}, {0, 1400}}, Label: casefmt.Point{1000, 700}}},
			Streets:   []casefmt.Street{{Name: "Main Street", Kind: "avenue", Points: []casefmt.Point{{0, 700}, {2000, 700}}}},
		},
		Locations: []casefmt.Location{{ID: "office", Name: "Your Office", Address: "100 Main Street", District: "downtown", X: 1000, Y: 700, Kind: "office",
			Summary: "Home base.", Visits: []casefmt.Visit{{ID: "office-1", Text: "Rain on the window. The case starts here."}}}},
		People:    []casefmt.Person{},
		Documents: []casefmt.Document{},
		Directory: []casefmt.DirEntry{},
		Accusation: casefmt.Accusation{Intro: "File your report.", MaxAttempts: 3, Questions: []casefmt.Question{}},
		Epilogue:   "",
	}
}

func (s *Server) adminCreateCase(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Slug  string `json:"slug"`
		Title string `json:"title"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	in.Slug = strings.ToLower(strings.TrimSpace(in.Slug))
	if !slugRe.MatchString(in.Slug) {
		writeErr(w, errStatus(400, "slug: lowercase letters, digits and dashes"))
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		writeErr(w, errStatus(400, "title is required"))
		return
	}
	c := skeleton(in.Slug, strings.TrimSpace(in.Title))
	casefmt.HashAnswers(c)
	s.insertCase(w, r, c, false)
}

func (s *Server) insertCase(w http.ResponseWriter, r *http.Request, c *casefmt.Case, sealed bool) {
	raw, _ := json.Marshal(c)
	var id string
	err := s.pool.QueryRow(r.Context(), `INSERT INTO cases (slug, title, content, sealed, created_by, version) VALUES ($1, $2, $3, $4, $5, greatest($6, 1)) RETURNING id`,
		c.Slug, c.Title, raw, sealed, currentUser(r).ID, c.Version).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeErr(w, errStatus(409, "a case with that slug already exists"))
			return
		}
		writeErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"id": id})
}

func (s *Server) adminImportCase(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<20))
	if err != nil {
		writeErr(w, errStatus(400, "upload too large"))
		return
	}
	c, err := casefmt.Load(data)
	if err != nil {
		writeErr(w, errStatus(400, err.Error()))
		return
	}
	if !slugRe.MatchString(c.Slug) {
		writeErr(w, errStatus(400, "the case needs a valid slug"))
		return
	}
	casefmt.HashAnswers(c)
	s.insertCase(w, r, c, casefmt.IsSealed(data))
}

type adminCaseBody struct {
	AdminCase
	Content *casefmt.Case `json:"content,omitempty"`
}

func (s *Server) loadAdminCase(r *http.Request) (*adminCaseBody, error) {
	var out adminCaseBody
	var raw []byte
	err := s.pool.QueryRow(r.Context(), `
		SELECT c.id, c.slug, c.title, c.sealed, c.published, c.version, c.updated_at,
		       (SELECT count(*) FROM teams t WHERE t.case_id = c.id), c.content
		FROM cases c WHERE c.id::text = $1`, chi.URLParam(r, "caseID")).
		Scan(&out.ID, &out.Slug, &out.Title, &out.Sealed, &out.Published, &out.Version, &out.UpdatedAt, &out.Teams, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	var c casefmt.Case
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	out.Content = &c
	return &out, nil
}

func revealRequested(r *http.Request) bool { return r.URL.Query().Get("spoilers") == "yes" }

func (s *Server) adminGetCase(w http.ResponseWriter, r *http.Request) {
	c, err := s.loadAdminCase(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if c.Sealed && !revealRequested(r) {
		c.Content = nil
		writeJSON(w, 423, map[string]any{"error": "sealed", "case": c})
		return
	}
	writeJSON(w, 200, c)
}

func (s *Server) adminSaveCase(w http.ResponseWriter, r *http.Request) {
	prev, err := s.loadAdminCase(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if prev.Sealed && !revealRequested(r) {
		writeErr(w, errStatus(423, "this case is sealed"))
		return
	}
	var in struct {
		Content casefmt.Case `json:"content"`
		Version int          `json:"version"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in.Version != prev.Version {
		writeErr(w, errStatus(409, "someone else saved this case in the meantime; reload to see their changes"))
		return
	}
	c := in.Content
	if !slugRe.MatchString(c.Slug) {
		writeErr(w, errStatus(400, "slug: lowercase letters, digits and dashes"))
		return
	}
	// Keep stored answer hashes for questions whose answer wasn't retyped.
	if c.Accusation.Salt == "" {
		c.Accusation.Salt = prev.Content.Accusation.Salt
	}
	old := map[string]string{}
	for _, q := range prev.Content.Accusation.Questions {
		old[q.ID] = q.AnswerHash
	}
	for i := range c.Accusation.Questions {
		q := &c.Accusation.Questions[i]
		if q.Answer == "" && q.AnswerHash == "" && c.Accusation.Salt == prev.Content.Accusation.Salt {
			q.AnswerHash = old[q.ID]
		}
	}
	casefmt.HashAnswers(&c)
	c.Version = prev.Version + 1
	raw, _ := json.Marshal(c)
	_, err = s.pool.Exec(r.Context(), `UPDATE cases SET slug = $2, title = $3, content = $4, version = $5, sealed = false, updated_at = now() WHERE id = $1`,
		prev.ID, c.Slug, c.Title, raw, c.Version)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeErr(w, errStatus(409, "a case with that slug already exists"))
			return
		}
		writeErr(w, err)
		return
	}
	rep := game.Validate(&c)
	writeJSON(w, 200, map[string]any{"version": c.Version, "content": c, "report": rep})
}

func (s *Server) adminValidateDraft(w http.ResponseWriter, r *http.Request) {
	var c casefmt.Case
	if err := decode(r, &c); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, game.Validate(&c))
}

func (s *Server) adminPublish(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Published bool `json:"published"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	c, err := s.loadAdminCase(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if in.Published {
		rep := game.Validate(c.Content)
		if rep.Errors() > 0 {
			writeJSON(w, 422, map[string]any{"error": "fix the errors before publishing", "report": rep})
			return
		}
	}
	if _, err := s.pool.Exec(r.Context(), `UPDATE cases SET published = $2, updated_at = now() WHERE id = $1`, c.ID, in.Published); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"published": in.Published})
}

func (s *Server) adminDeleteCase(w http.ResponseWriter, r *http.Request) {
	c, err := s.loadAdminCase(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if c.Teams > 0 && r.URL.Query().Get("force") != "yes" {
		writeErr(w, errStatus(409, "teams are playing this case; deleting it deletes their progress"))
		return
	}
	if _, err := s.pool.Exec(r.Context(), `DELETE FROM cases WHERE id = $1`, c.ID); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(204)
}
