package server

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/rizface/detective-game/backend/internal/casefmt"
	"github.com/rizface/detective-game/backend/internal/game"
)

// The client only ever receives what the team has discovered. The full case
// never leaves the server, so peeking at network traffic spoils nothing.

type Member struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Color       string `json:"color"`
	Online      bool   `json:"online"`
}

type LocationView struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Address  string   `json:"address"`
	District string   `json:"district"`
	Kind     string   `json:"kind"`
	Summary  string   `json:"summary"`
	X        float64  `json:"x"`
	Y        float64  `json:"y"`
	Visited  bool     `json:"visited"`
	Present  []string `json:"present"`
	Travel   int      `json:"travel"` // minutes from the current location
	FoundAt  int      `json:"foundAt"`
}

type PersonView struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Age         string `json:"age,omitempty"`
	Description string `json:"description"`
	Met         bool   `json:"met"`
	FoundAt     int    `json:"foundAt"`
}

type DocView struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	Date    string `json:"date,omitempty"`
	Source  string `json:"source,omitempty"`
	Body    string `json:"body"`
	Askable bool   `json:"askable"`
	FoundAt int    `json:"foundAt"`
}

type ChapterView struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Brief      string   `json:"brief"`
	Objectives []string `json:"objectives,omitempty"`
}

type ClockView struct {
	Active  int    `json:"active"`
	Clock   int    `json:"clock"`
	Now     string `json:"now"` // in-game time, "2006-01-02T15:04"
	Day     int    `json:"day"`
	Par     int    `json:"par"`
	Actions int    `json:"actions"`
}

type QuestionView struct {
	ID       string           `json:"id"`
	Prompt   string           `json:"prompt"`
	Kind     string           `json:"kind"`
	Options  []casefmt.Option `json:"options,omitempty"`
	Required bool             `json:"required"`
	Points   int              `json:"points"`
}

type CaseView struct {
	Slug          string        `json:"slug"`
	Title         string        `json:"title"`
	Tagline       string        `json:"tagline"`
	Setting       string        `json:"setting"`
	Intro         string        `json:"intro"`
	Map           casefmt.Map   `json:"map"`
	TotalChapters int           `json:"totalChapters"`
	Accusation    AccusationView `json:"accusation"`
}

type AccusationView struct {
	Intro     string         `json:"intro"`
	Open      bool           `json:"open"`
	Questions []QuestionView `json:"questions"`
}

type GameView struct {
	Chapter   int               `json:"chapter"`
	Chapters  []ChapterView     `json:"chapters"`
	Clock     ClockView         `json:"clock"`
	Current   string            `json:"current"`
	Locations []LocationView    `json:"locations"`
	People    []PersonView      `json:"people"`
	Documents []DocView         `json:"documents"`
	Directory []casefmt.DirEntry `json:"directory"`
	Topics    []string          `json:"topics"`
	Open      bool              `json:"accusationOpen"`
}

func clockView(e *game.Engine, st *game.State) ClockView {
	return ClockView{
		Active: st.Active, Clock: st.Clock, Now: st.Now().Format("2006-01-02T15:04"),
		Day: st.Day(), Par: e.Case.Clock.ParMinutes, Actions: st.Actions,
	}
}

func chaptersView(e *game.Engine, st *game.State) []ChapterView {
	var out []ChapterView
	for i, ch := range e.Case.Chapters {
		if i > st.Chapter {
			break
		}
		out = append(out, ChapterView{ID: ch.ID, Title: ch.Title, Brief: ch.Brief, Objectives: ch.Objectives})
	}
	return out
}

func locationsView(e *game.Engine, st *game.State) []LocationView {
	out := []LocationView{}
	for _, id := range st.IDs("loc") {
		l := e.Ix.Locations[id]
		if l == nil {
			continue
		}
		present := e.Present(st, id)
		if present == nil {
			present = []string{}
		}
		out = append(out, LocationView{
			ID: l.ID, Name: l.Name, Address: l.Address, District: l.District, Kind: l.Kind, Summary: l.Summary,
			X: l.X, Y: l.Y, Visited: st.Has("visited", id), Present: present, Travel: e.TravelCost(st, id),
			FoundAt: st.Found["loc:"+id],
		})
	}
	return out
}

func peopleView(e *game.Engine, st *game.State) []PersonView {
	out := []PersonView{}
	for _, id := range st.IDs("person") {
		p := e.Ix.People[id]
		if p == nil {
			continue
		}
		out = append(out, PersonView{ID: p.ID, Name: p.Name, Role: p.Role, Age: p.Age, Description: p.Description,
			Met: st.Has("met", id), FoundAt: st.Found["person:"+id]})
	}
	return out
}

func docView(e *game.Engine, st *game.State, id string) (DocView, bool) {
	d := e.Ix.Documents[id]
	if d == nil {
		return DocView{}, false
	}
	return DocView{ID: d.ID, Title: d.Title, Kind: d.Kind, Date: d.Date, Source: d.Source, Body: d.Body,
		Askable: d.Askable, FoundAt: st.Found["doc:"+id]}, true
}

func documentsView(e *game.Engine, st *game.State, only []string) []DocView {
	ids := only
	if ids == nil {
		ids = st.IDs("doc")
	}
	out := []DocView{}
	for _, id := range ids {
		if v, ok := docView(e, st, id); ok {
			out = append(out, v)
		}
	}
	return out
}

func directoryView(e *game.Engine, st *game.State) []casefmt.DirEntry {
	out := []casefmt.DirEntry{}
	seen := map[*casefmt.DirEntry]bool{}
	for _, key := range st.IDs("dir") {
		for _, entry := range e.Ix.Directory[key] {
			if !seen[entry] {
				seen[entry] = true
				out = append(out, *entry)
			}
		}
	}
	return out
}

func gameView(e *game.Engine, st *game.State) GameView {
	topics := e.Topics(st)
	if topics == nil {
		topics = []string{}
	}
	return GameView{
		Chapter: st.Chapter, Chapters: chaptersView(e, st), Clock: clockView(e, st), Current: st.Current,
		Locations: locationsView(e, st), People: peopleView(e, st), Documents: documentsView(e, st, nil),
		Directory: directoryView(e, st), Topics: topics, Open: e.AccusationOpen(st),
	}
}

// Delta is what teammates receive after an action. Documents only include the
// newly found ones; everything else is small enough to send whole.
type Delta struct {
	Outcome   *game.Outcome      `json:"outcome"`
	Event     *EventRow          `json:"event,omitempty"`
	Chapter   int                `json:"chapter"`
	Chapters  []ChapterView      `json:"chapters"`
	Clock     ClockView          `json:"clock"`
	Current   string             `json:"current"`
	Locations []LocationView     `json:"locations"`
	People    []PersonView       `json:"people"`
	Documents []DocView          `json:"documents"`
	Directory []casefmt.DirEntry `json:"directory"`
	Topics    []string           `json:"topics"`
	Open      bool               `json:"accusationOpen"`
}

func delta(e *game.Engine, st *game.State, out *game.Outcome) Delta {
	g := gameView(e, st)
	newDocs := out.Revealed.Documents
	if newDocs == nil {
		newDocs = []string{}
	}
	return Delta{
		Outcome: out, Chapter: g.Chapter, Chapters: g.Chapters, Clock: g.Clock, Current: g.Current,
		Locations: g.Locations, People: g.People, Documents: documentsView(e, st, newDocs),
		Directory: g.Directory, Topics: g.Topics, Open: g.Open,
	}
}

func caseView(e *game.Engine, st *game.State) CaseView {
	c := e.Case
	var qs []QuestionView
	for _, q := range c.Accusation.Questions {
		qs = append(qs, QuestionView{ID: q.ID, Prompt: q.Prompt, Kind: q.Kind, Options: q.Options, Required: q.Required, Points: q.Points})
	}
	return CaseView{
		Slug: c.Slug, Title: c.Title, Tagline: c.Tagline, Setting: c.Setting, Intro: c.Intro, Map: c.Map,
		TotalChapters: len(c.Chapters),
		Accusation:    AccusationView{Intro: c.Accusation.Intro, Open: e.AccusationOpen(st), Questions: qs},
	}
}

// --- result -------------------------------------------------------------------

type QuestionResult struct {
	ID      string `json:"id"`
	Prompt  string `json:"prompt"`
	Correct bool   `json:"correct"`
	Given   string `json:"given"`  // label of the team's answer
	Answer  string `json:"answer"` // label of the right answer
	Points  int    `json:"points"`
}

type Result struct {
	Status    string           `json:"status"` // solved | failed
	Questions []QuestionResult `json:"questions"`
	Points    int              `json:"points"`
	MaxPoints int              `json:"maxPoints"`
	Active    int              `json:"active"`
	Par       int              `json:"par"`
	Attempts  int              `json:"attempts"`
	Score     int              `json:"score"`
	Rank      string           `json:"rank"`
	Epilogue  string           `json:"epilogue"`
	Finished  time.Time        `json:"finished"`
}

func optionLabel(e *game.Engine, q casefmt.Question, id string) string {
	if id == "" {
		return "—"
	}
	if q.Kind == "person" {
		if p := e.Ix.People[id]; p != nil {
			return p.Name
		}
		return id
	}
	for _, o := range q.Options {
		if o.ID == id {
			return o.Label
		}
	}
	return id
}

// correctAnswer recovers the right option by testing candidates against the
// stored hash. Only used once the case is over.
func correctAnswer(e *game.Engine, q casefmt.Question) string {
	var candidates []string
	if q.Kind == "person" {
		for _, p := range e.Case.People {
			candidates = append(candidates, p.ID)
		}
	} else {
		for _, o := range q.Options {
			candidates = append(candidates, o.ID)
		}
	}
	for _, c := range candidates {
		if casefmt.CheckAnswer(e.Case, q, c) {
			return c
		}
	}
	return ""
}

func buildResult(e *game.Engine, st *game.State, status string, answers map[string]string, attempts int) *Result {
	g := e.Grade(answers)
	res := &Result{
		Status: status, Points: g.Points, MaxPoints: g.MaxPoints, Active: st.Active, Par: e.Case.Clock.ParMinutes,
		Attempts: attempts, Epilogue: e.Case.Epilogue, Finished: time.Now(),
	}
	for _, q := range e.Case.Accusation.Questions {
		res.Questions = append(res.Questions, QuestionResult{
			ID: q.ID, Prompt: q.Prompt, Correct: g.PerQuestion[q.ID], Points: q.Points,
			Given: optionLabel(e, q, answers[q.ID]), Answer: optionLabel(e, q, correctAnswer(e, q)),
		})
	}
	if status == "solved" {
		ratio := 1.0
		if g.MaxPoints > 0 {
			ratio = float64(g.Points) / float64(g.MaxPoints)
		}
		eff := 1.0
		if res.Par > 0 && st.Active > 0 {
			eff = math.Min(1, float64(res.Par)/float64(st.Active))
		}
		score := ratio*100*(0.75+0.25*eff) - float64(attempts-1)*8
		res.Score = int(math.Max(0, math.Round(score)))
	}
	switch {
	case status != "solved":
		res.Rank = "The city keeps its secret"
	case res.Score >= 90:
		res.Rank = "Sharpest eye in the city"
	case res.Score >= 75:
		res.Rank = "A gumshoe with a future"
	case res.Score >= 55:
		res.Rank = "Gets there in the end"
	default:
		res.Rank = "Lucky, and you know it"
	}
	return res
}

// --- snapshot -----------------------------------------------------------------

type Snapshot struct {
	Team     *Team         `json:"team"`
	You      string        `json:"you"`
	Members  []Member      `json:"members"`
	Case     CaseView      `json:"case"`
	Game     GameView      `json:"game"`
	Notes    []Note        `json:"notes"`
	Board    Board         `json:"board"`
	Chat     []ChatMessage `json:"chat"`
	Events   []EventRow    `json:"events"`
	Draft    Draft         `json:"draft"`
	Attempts []AttemptRow  `json:"attempts"`
	Result   *Result       `json:"result"`
}

func (s *Server) members(ctx context.Context, teamID string) ([]Member, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.display_name, m.color FROM team_members m JOIN users u ON u.id = m.user_id
		WHERE m.team_id = $1 ORDER BY m.joined_at`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	online := s.online(ctx, teamID)
	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.ID, &m.DisplayName, &m.Color); err != nil {
			return nil, err
		}
		m.Online = online[m.ID]
		out = append(out, m)
	}
	return out, rows.Err()
}

func decodeJSON[T any](raw []byte) T {
	var v T
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &v)
	}
	return v
}

var _ = strings.TrimSpace
