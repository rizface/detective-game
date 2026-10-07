package casefmt

import (
	"strings"
	"unicode"
)

// Index gives fast lookup over a case. Build it once per loaded case.
type Index struct {
	Case      *Case
	Locations map[string]*Location
	People    map[string]*Person
	Documents map[string]*Document
	Addresses map[string]*Location // normalised address -> location
	Streets   map[string]string    // normalised street name -> display name
	Directory map[string][]*DirEntry
	Scenes    map[string]bool // visit and dialogue IDs
	Flags     map[string]bool // flags set anywhere
	conds     map[string]Cond
}

func NewIndex(c *Case) *Index {
	ix := &Index{
		Case:      c,
		Locations: map[string]*Location{},
		People:    map[string]*Person{},
		Documents: map[string]*Document{},
		Addresses: map[string]*Location{},
		Streets:   map[string]string{},
		Directory: map[string][]*DirEntry{},
		Scenes:    map[string]bool{},
		Flags:     map[string]bool{},
		conds:     map[string]Cond{},
	}
	addFlags := func(r Reveal) {
		for _, f := range r.Flags {
			ix.Flags[f] = true
		}
	}
	addFlags(c.Start)
	for i := range c.Chapters {
		addFlags(c.Chapters[i].Reveals)
	}
	for i := range c.Locations {
		l := &c.Locations[i]
		ix.Locations[l.ID] = l
		ix.Addresses[NormalizeAddress(l.Address)] = l
		for _, a := range l.AltAddresses {
			ix.Addresses[NormalizeAddress(a)] = l
		}
		for _, v := range l.Visits {
			ix.Scenes[v.ID] = true
			addFlags(v.Reveals)
		}
	}
	for i := range c.People {
		p := &c.People[i]
		ix.People[p.ID] = p
		for _, d := range p.Dialogue {
			ix.Scenes[d.ID] = true
			addFlags(d.Reveals)
		}
	}
	for i := range c.Documents {
		ix.Documents[c.Documents[i].ID] = &c.Documents[i]
	}
	for _, s := range c.Map.Streets {
		ix.Streets[NormalizeStreet(s.Name)] = s.Name
	}
	for i := range c.Directory {
		e := &c.Directory[i]
		for _, k := range DirectoryKeys(e) {
			ix.Directory[k] = append(ix.Directory[k], e)
		}
	}
	return ix
}

// Cond returns the parsed condition, cached.
func (ix *Index) Cond(src string) Cond {
	if c, ok := ix.conds[src]; ok {
		return c
	}
	c := MustCond(src)
	ix.conds[src] = c
	return c
}

// DirectoryKeys returns the normalised search keys of a directory entry: its
// explicit keys, or else its full name and its last word (the surname).
func DirectoryKeys(e *DirEntry) []string {
	var keys []string
	if len(e.Keys) > 0 {
		for _, k := range e.Keys {
			keys = append(keys, NormalizeName(k))
		}
		return keys
	}
	full := NormalizeName(e.Name)
	keys = append(keys, full)
	words := strings.Fields(full)
	if len(words) > 1 {
		keys = append(keys, words[len(words)-1])
	}
	return keys
}

// NormalizeName lowercases and strips punctuation for directory search.
func NormalizeName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		case r == '&':
			b.WriteString(" and ")
		default:
			b.WriteRune(' ')
		}
	}
	words := strings.Fields(b.String())
	// "the" is noise in business names.
	if len(words) > 1 && words[0] == "the" {
		words = words[1:]
	}
	return strings.Join(words, " ")
}

var suffixes = map[string]string{
	"st": "street", "str": "street", "street": "street",
	"ave": "avenue", "av": "avenue", "avenue": "avenue",
	"rd": "road", "road": "road",
	"blvd": "boulevard", "boulevard": "boulevard",
	"ln": "lane", "lane": "lane",
	"dr": "drive", "drive": "drive",
	"pl": "place", "place": "place",
	"ct": "court", "court": "court",
	"sq": "square", "square": "square",
	"hwy": "highway", "highway": "highway",
	"pkwy": "parkway", "parkway": "parkway",
	"ter": "terrace", "terrace": "terrace",
	"wy": "way", "way": "way",
	"pier": "pier", "row": "row", "alley": "alley", "aly": "alley",
}

var directions = map[string]string{"n": "north", "s": "south", "e": "east", "w": "west"}

var ordinals = map[string]string{
	"first": "1st", "second": "2nd", "third": "3rd", "fourth": "4th", "fifth": "5th",
	"sixth": "6th", "seventh": "7th", "eighth": "8th", "ninth": "9th", "tenth": "10th",
	"eleventh": "11th", "twelfth": "12th",
}

// NormalizeAddress turns "1420 Harbor St." and "1420 harbor street" into the
// same key. Apartment or suite details after a comma or '#' are ignored.
func NormalizeAddress(s string) string {
	s = strings.ToLower(s)
	if i := strings.IndexAny(s, ",#"); i >= 0 {
		s = s[:i]
	}
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else {
			b.WriteRune(' ')
		}
	}
	words := strings.Fields(b.String())
	for i, w := range words {
		if v, ok := ordinals[w]; ok {
			words[i] = v
		}
		if v, ok := directions[w]; ok && i < len(words)-1 {
			words[i] = v
		}
		if i == len(words)-1 && i > 0 {
			if v, ok := suffixes[w]; ok {
				words[i] = v
			}
		}
		if i == 1 && w == "pier" { // "Pier 7" style addresses keep their order
			words[i] = "pier"
		}
	}
	return strings.Join(words, " ")
}

// SplitAddress separates a normalised address into house number and street.
func SplitAddress(norm string) (number, street string) {
	words := strings.Fields(norm)
	if len(words) > 1 && isNumber(words[0]) {
		return words[0], strings.Join(words[1:], " ")
	}
	return "", norm
}

// NormalizeStreet normalises a bare street name ("Harbor St" -> "harbor street").
func NormalizeStreet(s string) string { return NormalizeAddress(s) }

func isNumber(s string) bool {
	for _, r := range s {
		if !unicode.IsDigit(r) && !(r >= 'a' && r <= 'd' && len(s) > 1) {
			return false
		}
	}
	return s != "" && unicode.IsDigit(rune(s[0]))
}
