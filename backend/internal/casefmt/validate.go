package casefmt

import (
	"fmt"
	"sort"
	"strings"
)

// Issue is a validation finding. Errors make a case unplayable; warnings point
// at likely mistakes.
type Issue struct {
	Level string `json:"level"` // error | warning
	Where string `json:"where"`
	Msg   string `json:"msg"`
}

func (i Issue) String() string { return fmt.Sprintf("[%s] %s: %s", i.Level, i.Where, i.Msg) }

type issues []Issue

func (is *issues) errf(where, format string, a ...any) {
	*is = append(*is, Issue{"error", where, fmt.Sprintf(format, a...)})
}
func (is *issues) warnf(where, format string, a ...any) {
	*is = append(*is, Issue{"warning", where, fmt.Sprintf(format, a...)})
}

var docKinds = map[string]bool{
	"report": true, "letter": true, "photo": true, "newspaper": true, "ledger": true, "phone": true,
	"cipher": true, "note": true, "transcript": true, "receipt": true, "card": true, "telegram": true,
	"map": true, "record": true, "clipping": true, "ticket": true,
}

// ValidateStatic checks structure and references. It does not simulate play;
// see game.Validate for reachability.
func ValidateStatic(c *Case) []Issue {
	var is issues
	ix := NewIndex(c)

	if c.Slug == "" {
		is.errf("case", "slug is required")
	} else if strings.ContainsAny(c.Slug, " /?#") {
		is.errf("case", "slug %q must be URL-safe", c.Slug)
	}
	if c.Title == "" {
		is.errf("case", "title is required")
	}
	if len(c.Chapters) == 0 {
		is.errf("case", "at least one chapter is required")
	}
	if c.Clock.Start == "" {
		is.warnf("clock", "no start time; defaulting to 08:00 on day 1")
	}

	// Unique IDs.
	seen := map[string]string{}
	claim := func(kind, id, where string) {
		if id == "" {
			is.errf(where, "%s has an empty id", kind)
			return
		}
		key := kind + ":" + id
		if prev, ok := seen[key]; ok {
			is.errf(where, "duplicate %s id %q (also at %s)", kind, id, prev)
			return
		}
		seen[key] = where
	}
	for i, ch := range c.Chapters {
		claim("chapter", ch.ID, fmt.Sprintf("chapters[%d]", i))
	}
	for _, l := range c.Locations {
		claim("loc", l.ID, "location "+l.ID)
		for _, v := range l.Visits {
			claim("scene", v.ID, "location "+l.ID)
		}
	}
	for _, p := range c.People {
		claim("person", p.ID, "person "+p.ID)
		for _, d := range p.Dialogue {
			claim("scene", d.ID, "person "+p.ID)
		}
	}
	for _, d := range c.Documents {
		claim("doc", d.ID, "document "+d.ID)
	}

	checkCond := func(where, src string) {
		if strings.TrimSpace(src) == "" {
			return
		}
		cond, err := ParseCond(src)
		if err != nil {
			is.errf(where, "condition %q: %v", src, err)
			return
		}
		for _, a := range cond.Atoms() {
			checkRef(&is, ix, where, a.Kind, a.ID)
		}
	}
	checkReveal := func(where string, r Reveal) {
		for _, id := range r.Documents {
			if ix.Documents[id] == nil {
				is.errf(where, "reveals unknown document %q", id)
			}
		}
		for _, id := range r.Locations {
			if ix.Locations[id] == nil {
				is.errf(where, "reveals unknown location %q", id)
			}
		}
		for _, id := range r.People {
			if ix.People[id] == nil {
				is.errf(where, "reveals unknown person %q", id)
			}
		}
	}

	checkReveal("start", c.Start)
	for i, ch := range c.Chapters {
		where := "chapter " + ch.ID
		if i == 0 && ch.Requires != "" {
			is.warnf(where, "first chapter has a condition; it is ignored")
		}
		if i > 0 && ch.Requires == "" {
			is.errf(where, "chapters after the first need a requires condition")
		}
		checkCond(where, ch.Requires)
		checkReveal(where, ch.Reveals)
		if strings.TrimSpace(ch.Brief) == "" {
			is.warnf(where, "empty brief")
		}
	}

	districts := map[string]bool{}
	for _, d := range c.Map.Districts {
		districts[d.ID] = true
		if len(d.Points) < 3 {
			is.errf("district "+d.ID, "needs at least 3 points")
		}
	}
	if c.Map.Width <= 0 || c.Map.Height <= 0 {
		is.errf("map", "width and height must be positive")
	}

	addrSeen := map[string]string{}
	for _, l := range c.Locations {
		where := "location " + l.ID
		if l.Name == "" {
			is.errf(where, "name is required")
		}
		if l.Address == "" {
			is.errf(where, "address is required")
		} else {
			n := NormalizeAddress(l.Address)
			if prev, ok := addrSeen[n]; ok {
				is.errf(where, "address %q is also used by %s", l.Address, prev)
			}
			addrSeen[n] = l.ID
			_, street := SplitAddress(n)
			if len(ix.Streets) > 0 && ix.Streets[street] == "" {
				is.warnf(where, "street %q of address %q is not on the map", street, l.Address)
			}
		}
		if !districts[l.District] {
			is.errf(where, "unknown district %q", l.District)
		}
		if l.X < 0 || l.Y < 0 || l.X > c.Map.Width || l.Y > c.Map.Height {
			is.errf(where, "position (%.0f,%.0f) is outside the map", l.X, l.Y)
		}
		if len(l.Visits) == 0 {
			is.warnf(where, "has no visits")
		}
		for _, v := range l.Visits {
			vw := where + " / visit " + v.ID
			checkCond(vw, v.Requires)
			checkReveal(vw, v.Reveals)
			if strings.TrimSpace(v.Text) == "" {
				is.errf(vw, "empty text")
			}
		}
		for _, p := range l.Presence {
			if ix.People[p.Person] == nil {
				is.errf(where, "presence of unknown person %q", p.Person)
			}
			checkCond(where+" / presence "+p.Person, p.Requires)
		}
	}

	for _, p := range c.People {
		where := "person " + p.ID
		if p.Name == "" {
			is.errf(where, "name is required")
		}
		hasIntro := false
		for _, d := range p.Dialogue {
			dw := where + " / dialogue " + d.ID
			checkCond(dw, d.Requires)
			checkReveal(dw, d.Reveals)
			if strings.TrimSpace(d.Text) == "" {
				is.errf(dw, "empty text")
			}
			switch {
			case d.Topic == "intro":
				hasIntro = true
			case d.Topic == "any":
			default:
				kind, id, ok := strings.Cut(d.Topic, ":")
				if !ok {
					is.errf(dw, "bad topic %q", d.Topic)
					continue
				}
				switch kind {
				case "person":
					if ix.People[id] == nil {
						is.errf(dw, "topic refers to unknown person %q", id)
					}
				case "loc":
					if ix.Locations[id] == nil {
						is.errf(dw, "topic refers to unknown location %q", id)
					}
				case "doc":
					doc := ix.Documents[id]
					if doc == nil {
						is.errf(dw, "topic refers to unknown document %q", id)
					} else if !doc.Askable {
						is.errf(dw, "topic document %q is not marked askable", id)
					}
				default:
					is.errf(dw, "bad topic kind %q", kind)
				}
			}
		}
		if len(p.Dialogue) > 0 && !hasIntro {
			is.warnf(where, "has dialogue but no intro")
		}
		if len(p.Dialogue) > 0 && p.Fallback == "" {
			is.warnf(where, "has no fallback line")
		}
	}

	for _, d := range c.Documents {
		where := "document " + d.ID
		if d.Title == "" {
			is.errf(where, "title is required")
		}
		if !docKinds[d.Kind] {
			is.warnf(where, "unusual kind %q", d.Kind)
		}
		if strings.TrimSpace(d.Body) == "" {
			is.errf(where, "empty body")
		}
	}

	for i, e := range c.Directory {
		where := fmt.Sprintf("directory[%d] %s", i, e.Name)
		if e.Location != "" && ix.Locations[e.Location] == nil {
			is.errf(where, "links unknown location %q", e.Location)
		}
		if e.Location != "" {
			l := ix.Locations[e.Location]
			if l != nil && NormalizeAddress(l.Address) != NormalizeAddress(e.Address) {
				match := false
				for _, a := range l.AltAddresses {
					if NormalizeAddress(a) == NormalizeAddress(e.Address) {
						match = true
					}
				}
				if !match {
					is.warnf(where, "address %q differs from location %s (%q)", e.Address, l.ID, l.Address)
				}
			}
		}
	}

	a := c.Accusation
	checkCond("accusation", a.AvailableFrom)
	if len(a.Questions) == 0 {
		is.errf("accusation", "no questions")
	}
	if a.MaxAttempts <= 0 {
		is.warnf("accusation", "maxAttempts not set; defaulting to 3")
	}
	required := 0
	for _, q := range a.Questions {
		where := "question " + q.ID
		if q.Required {
			required++
		}
		switch q.Kind {
		case "person":
			if q.Answer != "" && ix.People[q.Answer] == nil {
				is.errf(where, "answer %q is not a person id", q.Answer)
			}
		case "choice":
			if len(q.Options) < 2 {
				is.errf(where, "choice questions need at least 2 options")
			}
			if q.Answer != "" {
				found := false
				for _, o := range q.Options {
					if o.ID == q.Answer {
						found = true
					}
				}
				if !found {
					is.errf(where, "answer %q is not one of the options", q.Answer)
				}
			}
		default:
			is.errf(where, "kind must be person or choice")
		}
		if q.Answer == "" && q.AnswerHash == "" {
			is.errf(where, "no answer set")
		}
		for _, ref := range q.Evidence {
			kind, id, ok := strings.Cut(ref, ":")
			if !ok {
				is.errf(where, "bad evidence ref %q", ref)
				continue
			}
			checkRef(&is, ix, where, kind, id)
		}
	}
	if len(a.Questions) > 0 && required == 0 {
		is.errf("accusation", "at least one question must be required")
	}
	return is
}

func checkRef(is *issues, ix *Index, where, kind, id string) {
	switch kind {
	case "doc":
		if ix.Documents[id] == nil {
			is.errf(where, "refers to unknown document %q", id)
		}
	case "loc", "visited":
		if ix.Locations[id] == nil {
			is.errf(where, "refers to unknown location %q", id)
		}
	case "person", "met":
		if ix.People[id] == nil {
			is.errf(where, "refers to unknown person %q", id)
		}
	case "scene":
		if !ix.Scenes[id] {
			is.errf(where, "refers to unknown scene %q", id)
		}
	case "flag":
		if !ix.Flags[id] {
			is.errf(where, "flag %q is never set", id)
		}
	case "chapter", "day":
	default:
		is.errf(where, "unknown reference kind %q", kind)
	}
}

// SortIssues orders errors before warnings.
func SortIssues(list []Issue) {
	sort.SliceStable(list, func(i, j int) bool {
		return list[i].Level == "error" && list[j].Level != "error"
	})
}
