// Package game implements the rules of an investigation: travelling, scenes,
// interviews, the city directory, chapters and the game clock. It is pure: it
// mutates a State in memory and returns an Outcome describing what happened.
// Persistence and real-time fan-out live elsewhere.
package game

import (
	"sort"
	"strings"
	"time"

	"github.com/rizface/detective-game/backend/internal/casefmt"
)

// State is a team's progress through a case. It is stored as JSON.
type State struct {
	// Found maps "kind:id" (doc, loc, visited, person, met, flag, scene) to the
	// active minute it was first found, which orders the case file.
	Found   map[string]int `json:"found"`
	Chapter int            `json:"chapter"` // 0-based index into Case.Chapters
	Current string         `json:"current"` // location the team is at, "" at the start
	Active  int            `json:"active"`  // minutes spent on actions (used for score)
	Clock   int            `json:"clock"`   // minutes since case start incl. nights
	Actions int            `json:"actions"` // number of time-consuming actions
	clock   *casefmt.Clock
}

// NewState creates a fresh state with the case's starting knowledge.
func NewState(c *casefmt.Case) *State {
	st := &State{Found: map[string]int{}}
	st.Bind(c)
	st.apply(c.Start)
	if len(c.Chapters) > 0 {
		st.apply(c.Chapters[0].Reveals)
	}
	return st
}

// Bind attaches clock settings after loading a state from storage.
func (s *State) Bind(c *casefmt.Case) {
	if s.Found == nil {
		s.Found = map[string]int{}
	}
	clk := c.Clock
	if clk.DayStartHour == 0 && clk.DayEndHour == 0 {
		clk.DayStartHour, clk.DayEndHour = 8, 23
	}
	if clk.DayEndHour <= clk.DayStartHour {
		clk.DayEndHour = clk.DayStartHour + 14
	}
	if clk.TravelBase == 0 {
		clk.TravelBase = 20
	}
	if clk.InterviewMinutes == 0 {
		clk.InterviewMinutes = 15
	}
	if clk.SearchMinutes == 0 {
		clk.SearchMinutes = 10
	}
	s.clock = &clk
}

func (s *State) Has(kind, id string) bool {
	_, ok := s.Found[kind+":"+id]
	return ok
}

// Chapter satisfies casefmt.Facts (1-based).
func (s *State) ChapterNum() int { return s.Chapter + 1 }

func (s *State) Day() int { return s.dayOf(s.Clock) }

func (s *State) dayOf(clock int) int {
	start := s.startMinuteOfDay()
	return (start+clock)/(24*60) + 1
}

func (s *State) startMinuteOfDay() int {
	t, err := s.StartTime()
	if err != nil {
		return s.clock.DayStartHour * 60
	}
	return t.Hour()*60 + t.Minute()
}

// StartTime parses the case's start time.
func (s *State) StartTime() (time.Time, error) {
	if s.clock == nil || s.clock.Start == "" {
		return time.Date(1985, 10, 14, 8, 0, 0, 0, time.UTC), nil
	}
	return time.Parse("2006-01-02T15:04", s.clock.Start)
}

// Now returns the in-game wall time.
func (s *State) Now() time.Time {
	t, _ := s.StartTime()
	return t.Add(time.Duration(s.Clock) * time.Minute)
}

// spend advances both clocks. If an action would run past the end of the day
// the team goes home and resumes at the start of the next day.
func (s *State) spend(minutes int) (overnight bool) {
	if minutes <= 0 {
		return false
	}
	s.Active += minutes
	s.Actions++
	now := s.Now()
	end := time.Date(now.Year(), now.Month(), now.Day(), s.clock.DayEndHour, 0, 0, 0, time.UTC)
	after := now.Add(time.Duration(minutes) * time.Minute)
	if after.After(end) {
		next := time.Date(now.Year(), now.Month(), now.Day()+1, s.clock.DayStartHour, 0, 0, 0, time.UTC)
		if now.Hour() < s.clock.DayStartHour { // already past midnight somehow
			next = next.AddDate(0, 0, -1)
		}
		start, _ := s.StartTime()
		s.Clock = int(next.Sub(start).Minutes()) + minutes
		return true
	}
	s.Clock += minutes
	return false
}

func (s *State) mark(key string) bool {
	if _, ok := s.Found[key]; ok {
		return false
	}
	s.Found[key] = s.Active
	return true
}

// apply records a reveal and returns only what was new.
func (s *State) apply(r casefmt.Reveal) casefmt.Reveal {
	var out casefmt.Reveal
	for _, id := range r.Documents {
		if s.mark("doc:" + id) {
			out.Documents = append(out.Documents, id)
		}
	}
	for _, id := range r.Locations {
		if s.mark("loc:" + id) {
			out.Locations = append(out.Locations, id)
		}
	}
	for _, id := range r.People {
		if s.mark("person:" + id) {
			out.People = append(out.People, id)
		}
	}
	for _, id := range r.Flags {
		if s.mark("flag:" + id) {
			out.Flags = append(out.Flags, id)
		}
	}
	return out
}

// IDs lists found ids of a kind in discovery order.
func (s *State) IDs(kind string) []string {
	type kv struct {
		id string
		at int
	}
	var list []kv
	prefix := kind + ":"
	for k, at := range s.Found {
		if strings.HasPrefix(k, prefix) {
			list = append(list, kv{strings.TrimPrefix(k, prefix), at})
		}
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].at != list[j].at {
			return list[i].at < list[j].at
		}
		return list[i].id < list[j].id
	})
	out := make([]string, len(list))
	for i, e := range list {
		out[i] = e.id
	}
	return out
}

// Clone copies the state (used by the simulator and for safe retries).
func (s *State) Clone() *State {
	c := *s
	c.Found = make(map[string]int, len(s.Found))
	for k, v := range s.Found {
		c.Found[k] = v
	}
	return &c
}

// facts adapts State to casefmt.Facts.
type facts struct{ s *State }

func (f facts) Has(kind, id string) bool { return f.s.Has(kind, id) }
func (f facts) Chapter() int             { return f.s.ChapterNum() }
func (f facts) Day() int                 { return f.s.Day() }

func mergeReveal(a, b casefmt.Reveal) casefmt.Reveal {
	a.Documents = append(a.Documents, b.Documents...)
	a.Locations = append(a.Locations, b.Locations...)
	a.People = append(a.People, b.People...)
	a.Flags = append(a.Flags, b.Flags...)
	return a
}
