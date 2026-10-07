package casefmt

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// Conditions are small boolean expressions that gate scenes, dialogue,
// presence and chapters. Examples:
//
//	doc:letter & visited:docks
//	(met:pike | flag:tailed) & !flag:arrested
//	chapter>=2 & day>=3
//
// Atoms:
//
//	doc:ID       document has been found
//	loc:ID       location is known (on the map)
//	visited:ID   location has been visited at least once
//	person:ID    person is known
//	met:ID       the team has talked to the person
//	flag:NAME    a flag set by some scene
//	scene:ID     a visit or dialogue entry has played
//	chapter>=N   the current chapter index (1-based) is at least N
//	day>=N       the in-game day (1-based) is at least N
//
// Operators: & (and), | (or), ! (not), parentheses. The words and/or/not work too.
// An empty condition is always true.
type Cond interface {
	Eval(Facts) bool
	Atoms() []Atom
	String() string
}

// Facts answers atom queries. The game state implements it.
type Facts interface {
	Has(kind, id string) bool
	Chapter() int
	Day() int
}

type Atom struct {
	Kind string // doc, loc, visited, person, met, flag, scene, chapter, day
	ID   string // for numeric atoms, the number as text
}

var refKinds = map[string]bool{"doc": true, "loc": true, "visited": true, "person": true, "met": true, "flag": true, "scene": true}

type always struct{}

func (always) Eval(Facts) bool  { return true }
func (always) Atoms() []Atom    { return nil }
func (always) String() string   { return "" }

type atomCond struct{ a Atom }

func (c atomCond) Eval(f Facts) bool {
	switch c.a.Kind {
	case "chapter":
		n, _ := strconv.Atoi(c.a.ID)
		return f.Chapter() >= n
	case "day":
		n, _ := strconv.Atoi(c.a.ID)
		return f.Day() >= n
	}
	return f.Has(c.a.Kind, c.a.ID)
}
func (c atomCond) Atoms() []Atom { return []Atom{c.a} }
func (c atomCond) String() string {
	if c.a.Kind == "chapter" || c.a.Kind == "day" {
		return c.a.Kind + ">=" + c.a.ID
	}
	return c.a.Kind + ":" + c.a.ID
}

type notCond struct{ c Cond }

func (n notCond) Eval(f Facts) bool { return !n.c.Eval(f) }
func (n notCond) Atoms() []Atom     { return n.c.Atoms() }
func (n notCond) String() string    { return "!" + wrap(n.c) }

type andCond struct{ cs []Cond }

func (a andCond) Eval(f Facts) bool {
	for _, c := range a.cs {
		if !c.Eval(f) {
			return false
		}
	}
	return true
}
func (a andCond) Atoms() []Atom { return collect(a.cs) }
func (a andCond) String() string { return join(a.cs, " & ") }

type orCond struct{ cs []Cond }

func (o orCond) Eval(f Facts) bool {
	for _, c := range o.cs {
		if c.Eval(f) {
			return true
		}
	}
	return false
}
func (o orCond) Atoms() []Atom  { return collect(o.cs) }
func (o orCond) String() string { return join(o.cs, " | ") }

func collect(cs []Cond) []Atom {
	var out []Atom
	for _, c := range cs {
		out = append(out, c.Atoms()...)
	}
	return out
}

func join(cs []Cond, sep string) string {
	parts := make([]string, len(cs))
	for i, c := range cs {
		parts[i] = wrap(c)
	}
	return strings.Join(parts, sep)
}

func wrap(c Cond) string {
	switch c.(type) {
	case andCond, orCond:
		return "(" + c.String() + ")"
	}
	return c.String()
}

// ParseCond parses a condition expression.
func ParseCond(src string) (Cond, error) {
	toks, err := lex(src)
	if err != nil {
		return nil, err
	}
	if len(toks) == 0 {
		return always{}, nil
	}
	p := &parser{toks: toks}
	c, err := p.or()
	if err != nil {
		return nil, err
	}
	if p.pos < len(p.toks) {
		return nil, fmt.Errorf("unexpected %q", p.toks[p.pos])
	}
	return c, nil
}

// MustCond parses a condition and treats parse errors as false. The validator
// reports parse errors separately, so the engine can stay forgiving.
func MustCond(src string) Cond {
	c, err := ParseCond(src)
	if err != nil {
		return notCond{always{}}
	}
	return c
}

func lex(src string) ([]string, error) {
	var toks []string
	r := []rune(src)
	for i := 0; i < len(r); {
		ch := r[i]
		switch {
		case unicode.IsSpace(ch):
			i++
		case ch == '(' || ch == ')' || ch == '!' || ch == '&' || ch == '|':
			// tolerate && and ||
			if (ch == '&' || ch == '|') && i+1 < len(r) && r[i+1] == ch {
				i++
			}
			toks = append(toks, string(ch))
			i++
		case isIdent(ch):
			j := i
			for j < len(r) && (isIdent(r[j]) || r[j] == ':' || r[j] == '>' || r[j] == '=') {
				j++
			}
			w := string(r[i:j])
			switch strings.ToLower(w) {
			case "and":
				w = "&"
			case "or":
				w = "|"
			case "not":
				w = "!"
			}
			toks = append(toks, w)
			i = j
		default:
			return nil, fmt.Errorf("unexpected character %q", ch)
		}
	}
	return toks, nil
}

func isIdent(ch rune) bool {
	return unicode.IsLetter(ch) || unicode.IsDigit(ch) || ch == '_' || ch == '-' || ch == '.'
}

type parser struct {
	toks []string
	pos  int
}

func (p *parser) peek() string {
	if p.pos < len(p.toks) {
		return p.toks[p.pos]
	}
	return ""
}

func (p *parser) or() (Cond, error) {
	first, err := p.and()
	if err != nil {
		return nil, err
	}
	cs := []Cond{first}
	for p.peek() == "|" {
		p.pos++
		c, err := p.and()
		if err != nil {
			return nil, err
		}
		cs = append(cs, c)
	}
	if len(cs) == 1 {
		return first, nil
	}
	return orCond{cs}, nil
}

func (p *parser) and() (Cond, error) {
	first, err := p.unary()
	if err != nil {
		return nil, err
	}
	cs := []Cond{first}
	for p.peek() == "&" {
		p.pos++
		c, err := p.unary()
		if err != nil {
			return nil, err
		}
		cs = append(cs, c)
	}
	if len(cs) == 1 {
		return first, nil
	}
	return andCond{cs}, nil
}

func (p *parser) unary() (Cond, error) {
	switch t := p.peek(); t {
	case "!":
		p.pos++
		c, err := p.unary()
		if err != nil {
			return nil, err
		}
		return notCond{c}, nil
	case "(":
		p.pos++
		c, err := p.or()
		if err != nil {
			return nil, err
		}
		if p.peek() != ")" {
			return nil, fmt.Errorf("missing )")
		}
		p.pos++
		return c, nil
	case "", ")", "&", "|":
		if t == "" {
			return nil, fmt.Errorf("unexpected end of condition")
		}
		return nil, fmt.Errorf("unexpected %q", t)
	default:
		p.pos++
		a, err := parseAtom(t)
		if err != nil {
			return nil, err
		}
		return atomCond{a}, nil
	}
}

func parseAtom(t string) (Atom, error) {
	for _, k := range []string{"chapter", "day"} {
		if strings.HasPrefix(t, k+">=") {
			n := strings.TrimPrefix(t, k+">=")
			if _, err := strconv.Atoi(n); err != nil {
				return Atom{}, fmt.Errorf("bad number in %q", t)
			}
			return Atom{Kind: k, ID: n}, nil
		}
	}
	kind, id, ok := strings.Cut(t, ":")
	if !ok || id == "" {
		return Atom{}, fmt.Errorf("bad atom %q (want kind:id)", t)
	}
	if !refKinds[kind] {
		return Atom{}, fmt.Errorf("unknown atom kind %q in %q", kind, t)
	}
	return Atom{Kind: kind, ID: id}, nil
}
