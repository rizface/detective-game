package game

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/rizface/detective-game/backend/internal/casefmt"
)

// Report is the result of validating a case.
type Report struct {
	Issues []casefmt.Issue `json:"issues"`
	Stats  Stats           `json:"stats"`
}

func (r Report) Errors() int {
	n := 0
	for _, i := range r.Issues {
		if i.Level == "error" {
			n++
		}
	}
	return n
}

type Stats struct {
	Chapters         int `json:"chapters"`
	Locations        int `json:"locations"`
	People           int `json:"people"`
	Documents        int `json:"documents"`
	Scenes           int `json:"scenes"`
	DirectoryEntries int `json:"directoryEntries"`
	Words            int `json:"words"`
	ReachableWords   int `json:"reachableWords"`
	// EstimatedMinutes is a rough play-time guess: reading at ~150 words per
	// minute aloud-ish (teams read together and discuss) plus time to decide
	// each action.
	EstimatedMinutes int `json:"estimatedMinutes"`
	ExhaustiveActive int `json:"exhaustiveActiveMinutes"` // in-game minutes to see everything
}

// Validate runs static checks and a reachability simulation: a tireless team
// that goes everywhere it knows about, asks everyone about everything, and
// looks up every name and address that appears in what it has read.
func Validate(c *casefmt.Case) Report {
	issues := casefmt.ValidateStatic(c)
	rep := Report{}
	hasErrors := false
	for _, i := range issues {
		if i.Level == "error" {
			hasErrors = true
		}
	}
	rep.Stats = countStats(c)
	if !hasErrors {
		sim := Simulate(c)
		issues = append(issues, sim.issues...)
		rep.Stats.ReachableWords = sim.words
		rep.Stats.ExhaustiveActive = sim.active
		rep.Stats.EstimatedMinutes = sim.words/150 + sim.actions*2
	}
	casefmt.SortIssues(issues)
	rep.Issues = issues
	return rep
}

type simResult struct {
	issues  []casefmt.Issue
	words   int
	active  int
	actions int
	state   *State
}

var wordRe = regexp.MustCompile(`[\p{L}\p{N}']+`)

func countWords(s string) int { return len(wordRe.FindAllString(s, -1)) }

func countStats(c *casefmt.Case) Stats {
	s := Stats{
		Chapters: len(c.Chapters), Locations: len(c.Locations), People: len(c.People),
		Documents: len(c.Documents), DirectoryEntries: len(c.Directory),
	}
	w := countWords(c.Intro) + countWords(c.Epilogue)
	for _, ch := range c.Chapters {
		w += countWords(ch.Brief)
	}
	for _, l := range c.Locations {
		s.Scenes += len(l.Visits)
		for _, v := range l.Visits {
			w += countWords(v.Text)
		}
	}
	for _, p := range c.People {
		s.Scenes += len(p.Dialogue)
		w += countWords(p.Description)
		for _, d := range p.Dialogue {
			w += countWords(d.Text)
		}
	}
	for _, d := range c.Documents {
		w += countWords(d.Body)
	}
	s.Words = w
	return s
}

// Simulate plays the case exhaustively and reports what can never be reached.
func Simulate(c *casefmt.Case) simResult {
	e := NewEngine(c)
	st := NewState(c)
	var corpus strings.Builder
	words := countWords(c.Intro)
	corpus.WriteString(c.Intro + "\n")
	if len(c.Chapters) > 0 {
		corpus.WriteString(c.Chapters[0].Brief + "\n")
		words += countWords(c.Chapters[0].Brief)
	}
	meaningful := 0
	readDocs := map[string]bool{}
	readPeople := map[string]bool{}
	searched := map[string]bool{}
	absorb := func(out *Outcome) {
		if out == nil {
			return
		}
		useful := false
		for _, sc := range out.Scenes {
			if sc.Kind == "idle" || sc.Kind == "info" || sc.Repeat || strings.HasPrefix(sc.ID, "fallback:") {
				continue
			}
			useful = true
			corpus.WriteString(sc.Text + "\n")
			words += countWords(sc.Text)
		}
		if useful || len(out.Directory) > 0 {
			meaningful++
		}
		for _, d := range out.Directory {
			corpus.WriteString(d.Name + " " + d.Address + " " + d.Note + "\n")
		}
	}
	readNew := func() {
		for _, id := range st.IDs("doc") {
			if !readDocs[id] {
				readDocs[id] = true
				d := e.Ix.Documents[id]
				corpus.WriteString(d.Title + "\n" + d.Body + "\n")
				words += countWords(d.Body)
			}
		}
		for _, id := range st.IDs("person") {
			if !readPeople[id] {
				readPeople[id] = true
				p := e.Ix.People[id]
				corpus.WriteString(p.Name + "\n" + p.Description + "\n")
			}
		}
	}

	for round := 0; round < 200; round++ {
		before := len(st.Found)
		readNew()
		text := " " + casefmt.NormalizeName(corpus.String()) + " "

		// Names in the text can be looked up in the directory.
		for key := range e.Ix.Directory {
			if searched[key] || !strings.Contains(text, " "+key+" ") {
				continue
			}
			searched[key] = true
			out, _ := e.Search(st, key)
			absorb(out)
		}
		// Addresses in the text can be visited even when not on the map.
		for i := range c.Locations {
			l := &c.Locations[i]
			if st.Has("loc", l.ID) {
				continue
			}
			for _, a := range append([]string{l.Address}, l.AltAddresses...) {
				if strings.Contains(text, " "+addressStem(a)+" ") {
					out, _ := e.TravelAddress(st, a)
					absorb(out)
					break
				}
			}
		}
		// Go everywhere known, talk to everyone about everything.
		for _, id := range st.IDs("loc") {
			out, err := e.Travel(st, id)
			if err != nil {
				continue
			}
			absorb(out)
			for _, pid := range e.Present(st, id) {
				out, _ := e.Ask(st, pid, "intro")
				absorb(out)
				for _, topic := range e.topics(st) {
					out, err := e.Ask(st, pid, topic)
					if err == nil {
						absorb(out)
					}
				}
			}
		}
		readNew()
		if len(st.Found) == before {
			break
		}
	}

	var is []casefmt.Issue
	add := func(level, where, format string, a ...any) {
		is = append(is, casefmt.Issue{Level: level, Where: where, Msg: fmt.Sprintf(format, a...)})
	}
	for i, ch := range c.Chapters {
		if i > st.Chapter {
			add("error", "chapter "+ch.ID, "is never reached")
		}
	}
	for _, d := range c.Documents {
		if !st.Has("doc", d.ID) {
			add("warning", "document "+d.ID, "is never found")
		}
	}
	for _, l := range c.Locations {
		if !st.Has("visited", l.ID) {
			add("warning", "location "+l.ID, "is never reached")
		}
		for _, v := range l.Visits {
			if !st.Has("scene", v.ID) {
				add("warning", "location "+l.ID+" / visit "+v.ID, "never plays")
			}
		}
	}
	for _, p := range c.People {
		if !st.Has("person", p.ID) {
			add("warning", "person "+p.ID, "is never met or mentioned")
		}
		for _, d := range p.Dialogue {
			if !st.Has("scene", d.ID) {
				add("warning", "person "+p.ID+" / dialogue "+d.ID, "never plays")
			}
		}
	}
	if !e.AccusationOpen(st) {
		add("error", "accusation", "never becomes available")
	}
	for _, q := range c.Accusation.Questions {
		for _, ref := range q.Evidence {
			kind, id, _ := strings.Cut(ref, ":")
			if !st.Has(kind, id) {
				add("error", "question "+q.ID, "evidence %s is unreachable", ref)
			}
		}
		if q.Kind == "person" && q.Answer != "" && !st.Has("person", q.Answer) {
			add("error", "question "+q.ID, "the answer is never a known person, so it can't be picked")
		}
	}
	sort.SliceStable(is, func(i, j int) bool { return is[i].Where < is[j].Where })
	return simResult{issues: is, words: words, active: st.Active, actions: meaningful, state: st}
}

// addressStem is the number and street words without the suffix, normalised
// like directory names: "1420 Harbor St." -> "1420 harbor".
func addressStem(a string) string {
	words := strings.Fields(casefmt.NormalizeName(a))
	if len(words) > 2 {
		if _, ok := streetSuffix[words[len(words)-1]]; ok {
			words = words[:len(words)-1]
		}
	}
	return strings.Join(words, " ")
}

var streetSuffix = map[string]bool{
	"st": true, "street": true, "ave": true, "avenue": true, "rd": true, "road": true, "blvd": true,
	"boulevard": true, "ln": true, "lane": true, "dr": true, "drive": true, "pl": true, "place": true,
	"ct": true, "court": true, "sq": true, "square": true, "way": true, "row": true, "terrace": true,
}

// topics lists everything the team could currently ask about.
func (e *Engine) topics(st *State) []string {
	var t []string
	for _, id := range st.IDs("person") {
		t = append(t, "person:"+id)
	}
	for _, id := range st.IDs("loc") {
		t = append(t, "loc:"+id)
	}
	for _, id := range st.IDs("doc") {
		if d := e.Ix.Documents[id]; d != nil && d.Askable {
			t = append(t, "doc:"+id)
		}
	}
	return t
}

// Topics is the exported form used by the API.
func (e *Engine) Topics(st *State) []string { return e.topics(st) }
