package game

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/rizface/detective-game/backend/internal/casefmt"
)

var (
	ErrUnknownLocation = errors.New("you don't know where that is")
	ErrNotHere         = errors.New("that person isn't here")
	ErrUnknownTopic    = errors.New("you don't know enough about that to ask")
	ErrUnknownPerson   = errors.New("unknown person")
	ErrEmptyQuery      = errors.New("type a name to look up")
)

// Engine runs the rules of one case.
type Engine struct {
	Case *casefmt.Case
	Ix   *casefmt.Index
}

func NewEngine(c *casefmt.Case) *Engine {
	return &Engine{Case: c, Ix: casefmt.NewIndex(c)}
}

// Scene is a passage of narrative shown to the team.
type Scene struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"` // visit, dialogue, chapter, idle, info
	Title   string `json:"title,omitempty"`
	Speaker string `json:"speaker,omitempty"` // person id for dialogue
	Text    string `json:"text"`
	Repeat  bool   `json:"repeat,omitempty"`
}

// Outcome describes the result of one action.
type Outcome struct {
	Action    string             `json:"action"` // travel, ask, search, address
	Location  string             `json:"location,omitempty"`
	Person    string             `json:"person,omitempty"`
	Topic     string             `json:"topic,omitempty"`
	Query     string             `json:"query,omitempty"`
	Scenes    []Scene            `json:"scenes"`
	Revealed  casefmt.Reveal     `json:"revealed"`
	Chapters  []string           `json:"chapters,omitempty"` // chapter ids entered
	Directory []casefmt.DirEntry `json:"directory,omitempty"`
	Minutes   int                `json:"minutes"`
	Overnight bool               `json:"overnight,omitempty"`
}

func (e *Engine) holds(st *State, cond string) bool {
	return e.Ix.Cond(cond).Eval(facts{st})
}

// TravelCost returns the minutes needed to reach a location from the current one.
func (e *Engine) TravelCost(st *State, to string) int {
	dest := e.Ix.Locations[to]
	if dest == nil || st.Current == to {
		return 0
	}
	base := st.clock.TravelBase
	from := e.Ix.Locations[st.Current]
	if from == nil {
		return base
	}
	d := math.Hypot(dest.X-from.X, dest.Y-from.Y)
	cost := base + int(math.Round(d/100*float64(st.clock.TravelPerUnit)))
	return roundTo5(cost)
}

func roundTo5(n int) int { return ((n + 4) / 5) * 5 }

// Travel moves the team to a known location and plays any scenes there.
func (e *Engine) Travel(st *State, locID string) (*Outcome, error) {
	loc := e.Ix.Locations[locID]
	if loc == nil || !st.Has("loc", locID) {
		return nil, ErrUnknownLocation
	}
	out := &Outcome{Action: "travel", Location: locID}
	out.Minutes = e.TravelCost(st, locID)
	out.Overnight = st.spend(out.Minutes)
	st.Current = locID
	st.mark("visited:" + locID)
	e.playVisits(st, loc, out)
	e.advance(st, out)
	return out, nil
}

func (e *Engine) playVisits(st *State, loc *casefmt.Location, out *Outcome) {
	for {
		played := false
		for _, v := range loc.Visits {
			if st.Has("scene", v.ID) || !e.holds(st, v.Requires) {
				continue
			}
			st.mark("scene:" + v.ID)
			out.Scenes = append(out.Scenes, Scene{ID: v.ID, Kind: "visit", Title: v.Title, Text: v.Text})
			out.Revealed = mergeReveal(out.Revealed, st.apply(v.Reveals))
			played = true
		}
		if !played {
			break
		}
	}
	if len(out.Scenes) == 0 {
		idle := loc.Idle
		if idle == "" {
			idle = "Nothing new here. You look around once more, but whatever this place had to tell you, it has already told you."
		}
		out.Scenes = append(out.Scenes, Scene{ID: "idle:" + loc.ID, Kind: "idle", Text: idle})
	}
}

// advance enters every chapter whose condition now holds.
func (e *Engine) advance(st *State, out *Outcome) {
	for st.Chapter+1 < len(e.Case.Chapters) {
		next := e.Case.Chapters[st.Chapter+1]
		if !e.holds(st, next.Requires) {
			return
		}
		st.Chapter++
		out.Chapters = append(out.Chapters, next.ID)
		out.Scenes = append(out.Scenes, Scene{ID: "chapter:" + next.ID, Kind: "chapter", Title: next.Title, Text: next.Brief})
		out.Revealed = mergeReveal(out.Revealed, st.apply(next.Reveals))
	}
}

// Present lists the people the team can talk to at a location right now.
func (e *Engine) Present(st *State, locID string) []string {
	loc := e.Ix.Locations[locID]
	if loc == nil {
		return nil
	}
	var ids []string
	for _, p := range loc.Presence {
		if e.holds(st, p.Requires) {
			ids = append(ids, p.Person)
		}
	}
	return ids
}

func (e *Engine) isPresent(st *State, personID string) bool {
	for _, id := range e.Present(st, st.Current) {
		if id == personID {
			return true
		}
	}
	return false
}

// TopicKnown reports whether the team can raise a topic.
func (e *Engine) TopicKnown(st *State, topic string) bool {
	if topic == "intro" {
		return true
	}
	kind, id, ok := strings.Cut(topic, ":")
	if !ok {
		return false
	}
	switch kind {
	case "person":
		return st.Has("person", id)
	case "loc":
		return st.Has("loc", id)
	case "doc":
		d := e.Ix.Documents[id]
		return d != nil && d.Askable && st.Has("doc", id)
	}
	return false
}

// Ask raises a topic with a person at the team's current location. Topic
// "intro" opens the conversation.
func (e *Engine) Ask(st *State, personID, topic string) (*Outcome, error) {
	p := e.Ix.People[personID]
	if p == nil {
		return nil, ErrUnknownPerson
	}
	if !e.isPresent(st, personID) {
		return nil, ErrNotHere
	}
	if !e.TopicKnown(st, topic) {
		return nil, ErrUnknownTopic
	}
	out := &Outcome{Action: "ask", Person: personID, Topic: topic, Location: st.Current}
	firstMeeting := !st.Has("met", personID)
	st.mark("met:" + personID)
	st.mark("person:" + personID)

	play := func(t string) bool {
		played := false
		for _, d := range p.Dialogue {
			if d.Topic != t || st.Has("scene", d.ID) || !e.holds(st, d.Requires) {
				continue
			}
			st.mark("scene:" + d.ID)
			out.Scenes = append(out.Scenes, Scene{ID: d.ID, Kind: "dialogue", Speaker: personID, Text: d.Text})
			out.Revealed = mergeReveal(out.Revealed, st.apply(d.Reveals))
			played = true
		}
		return played
	}

	if firstMeeting && topic != "intro" {
		play("intro")
	}
	if play(topic) {
		out.Minutes = st.clock.InterviewMinutes
	} else if topic == "intro" && firstMeeting && len(out.Scenes) == 0 {
		out.Minutes = st.clock.InterviewMinutes
		out.Scenes = append(out.Scenes, Scene{ID: "fallback:" + personID, Kind: "dialogue", Speaker: personID, Text: e.fallback(p)})
	} else if len(out.Scenes) == 0 {
		// Nothing new. Repeat the latest answer on this topic for free, or
		// spend time on the fallback.
		if last := e.lastPlayed(st, p, topic); last != nil {
			out.Scenes = append(out.Scenes, Scene{ID: last.ID, Kind: "dialogue", Speaker: personID, Text: last.Text, Repeat: true})
		} else {
			out.Minutes = st.clock.InterviewMinutes
			out.Scenes = append(out.Scenes, Scene{ID: "fallback:" + personID, Kind: "dialogue", Speaker: personID, Text: e.fallback(p)})
		}
	} else {
		out.Minutes = st.clock.InterviewMinutes
	}
	// "any" entries play after a real question once their condition holds.
	if topic != "intro" {
		play("any")
	}
	out.Overnight = st.spend(out.Minutes)
	e.advance(st, out)
	return out, nil
}

func (e *Engine) lastPlayed(st *State, p *casefmt.Person, topic string) *casefmt.Dialogue {
	var last *casefmt.Dialogue
	for i := range p.Dialogue {
		d := &p.Dialogue[i]
		if d.Topic == topic && st.Has("scene", d.ID) {
			last = d
		}
	}
	return last
}

func (e *Engine) fallback(p *casefmt.Person) string {
	if p.Fallback != "" {
		return p.Fallback
	}
	return fmt.Sprintf("%s shrugs. \"Can't help you with that.\"", p.Name)
}

// Search looks a name up in the city directory.
func (e *Engine) Search(st *State, query string) (*Outcome, error) {
	key := casefmt.NormalizeName(query)
	if key == "" {
		return nil, ErrEmptyQuery
	}
	out := &Outcome{Action: "search", Query: query}
	out.Minutes = st.clock.SearchMinutes
	if len(e.Ix.Directory[key]) > 0 {
		st.mark("dir:" + key)
	}
	for _, entry := range e.Ix.Directory[key] {
		out.Directory = append(out.Directory, *entry)
		if entry.Location != "" {
			out.Revealed = mergeReveal(out.Revealed, st.apply(casefmt.Reveal{Locations: []string{entry.Location}}))
		}
	}
	if len(out.Directory) == 0 {
		out.Scenes = append(out.Scenes, Scene{ID: "search:none", Kind: "info",
			Text: fmt.Sprintf("You thumb through the city directory. No listing under \"%s\".", strings.TrimSpace(query))})
	}
	out.Overnight = st.spend(out.Minutes)
	e.advance(st, out)
	return out, nil
}

// TravelAddress goes to a typed address. Unknown locations at a valid
// address are revealed; other addresses on real streets cost a wasted trip.
func (e *Engine) TravelAddress(st *State, address string) (*Outcome, error) {
	norm := casefmt.NormalizeAddress(address)
	if norm == "" {
		return nil, ErrEmptyQuery
	}
	if loc := e.Ix.Addresses[norm]; loc != nil {
		newly := st.apply(casefmt.Reveal{Locations: []string{loc.ID}})
		out, err := e.Travel(st, loc.ID)
		if err != nil {
			return nil, err
		}
		out.Action = "address"
		out.Query = address
		out.Revealed = mergeReveal(newly, out.Revealed)
		return out, nil
	}
	num, street := casefmt.SplitAddress(norm)
	out := &Outcome{Action: "address", Query: address}
	if name, ok := e.Ix.Streets[street]; ok {
		out.Minutes = st.clock.TravelBase
		out.Overnight = st.spend(out.Minutes)
		where := name
		if num != "" {
			where = num + " " + name
		}
		out.Scenes = append(out.Scenes, Scene{ID: "address:none", Kind: "info",
			Text: fmt.Sprintf("You find %s easily enough. A shuttered storefront, a stoop, a dog that doesn't care about you. Nothing here has anything to do with the case.", where)})
		return out, nil
	}
	out.Scenes = append(out.Scenes, Scene{ID: "address:nostreet", Kind: "info",
		Text: "The cab driver squints at you in the mirror. \"Never heard of it, pal.\" Check the spelling against the map."})
	return out, nil
}

// AccusationOpen reports whether the team may file their final report.
func (e *Engine) AccusationOpen(st *State) bool {
	return e.holds(st, e.Case.Accusation.AvailableFrom)
}

// MaxAttempts returns the case's attempt limit.
func (e *Engine) MaxAttempts() int {
	if e.Case.Accusation.MaxAttempts > 0 {
		return e.Case.Accusation.MaxAttempts
	}
	return 3
}

// Grade scores a set of answers. It reports how many required questions were
// right, without saying which.
type Grade struct {
	Passed          bool            `json:"passed"`
	RequiredCorrect int             `json:"requiredCorrect"`
	RequiredTotal   int             `json:"requiredTotal"`
	Points          int             `json:"points"`
	MaxPoints       int             `json:"maxPoints"`
	PerQuestion     map[string]bool `json:"-"` // revealed only after the case ends
}

func (e *Engine) Grade(answers map[string]string) Grade {
	g := Grade{PerQuestion: map[string]bool{}}
	for _, q := range e.Case.Accusation.Questions {
		ok := casefmt.CheckAnswer(e.Case, q, answers[q.ID])
		g.PerQuestion[q.ID] = ok
		g.MaxPoints += q.Points
		if ok {
			g.Points += q.Points
		}
		if q.Required {
			g.RequiredTotal++
			if ok {
				g.RequiredCorrect++
			}
		}
	}
	g.Passed = g.RequiredCorrect == g.RequiredTotal
	return g
}
