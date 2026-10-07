package game

import (
	"strings"
	"testing"

	"github.com/rizface/detective-game/backend/internal/casefmt"
)

const fixture = `
slug: fixture
title: Fixture
clock: {start: "1985-10-14T08:00", dayStartHour: 8, dayEndHour: 23, travelBase: 20, travelPerUnit: 10, interviewMinutes: 15, searchMinutes: 10, parMinutes: 300}
intro: You are hired to find a lost cat. The owner lives at 12 Elm St.
start: {locations: [office], documents: [letter]}
chapters:
  - id: one
    title: The Cat
    brief: Find the cat.
  - id: two
    title: The Truth
    requires: doc:collar
    brief: The cat was taken.
map:
  width: 1000
  height: 1000
  districts:
    - {id: d, name: Downtown, points: [[0,0],[1000,0],[1000,1000],[0,1000]], label: [500,500]}
  streets:
    - {name: Elm Street, points: [[0,100],[1000,100]]}
    - {name: Oak Avenue, points: [[0,200],[1000,200]]}
locations:
  - id: office
    name: Your Office
    address: 1 Oak Ave
    district: d
    x: 100
    y: 200
    kind: office
    visits:
      - {id: office1, text: Your office smells of old coffee.}
  - id: home
    name: Mrs. Gray's House
    address: 12 Elm Street
    district: d
    x: 900
    y: 100
    kind: home
    hidden: true
    visits:
      - {id: home1, text: "Mrs. Gray is waiting. Ask Pike at the docks.", reveals: {people: [gray, pike], documents: [collar]}}
      - {id: home2, requires: flag:pike_talked, text: She gasps when you tell her., reveals: {flags: [told]}}
    presence:
      - {person: gray}
  - id: docks
    name: The Docks
    address: 3 Oak Ave
    district: d
    x: 600
    y: 200
    kind: pier
    hidden: true
    visits:
      - {id: docks1, text: Gulls.}
    presence:
      - {person: pike, requires: chapter>=2}
people:
  - id: gray
    name: Edna Gray
    role: Client
    description: Cat owner.
    fallback: '"I just want Mittens back."'
    dialogue:
      - {id: gray_intro, topic: intro, text: '"Oh, detective!"'}
      - {id: gray_pike, topic: person:pike, text: '"Pike? He fishes."'}
  - id: pike
    name: Sam Pike
    role: Fisherman
    description: Smells of fish.
    fallback: '"Dunno."'
    dialogue:
      - {id: pike_intro, topic: intro, text: '"What?"', reveals: {flags: [pike_talked]}}
      - {id: pike_collar, topic: doc:collar, text: '"Fine. I took it."', reveals: {flags: [confessed]}}
documents:
  - {id: letter, title: Letter, kind: letter, body: "Please find Mittens. — Edna Gray"}
  - {id: collar, title: Collar, kind: photo, body: A red collar., askable: true}
directory:
  - {name: Sam Pike, address: 3 Oak Ave, location: docks, note: Fisherman}
accusation:
  intro: Who took the cat?
  availableFrom: chapter>=2
  maxAttempts: 2
  salt: s
  questions:
    - {id: who, prompt: "Who?", kind: person, required: true, points: 10, answer: pike, evidence: ["flag:confessed"]}
    - {id: why, prompt: "Why?", kind: choice, points: 5, options: [{id: a, label: Money}, {id: b, label: Love}], answer: b}
`

func load(t *testing.T) *casefmt.Case {
	t.Helper()
	c, err := casefmt.Load([]byte(fixture))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestPlaythrough(t *testing.T) {
	c := load(t)
	e := NewEngine(c)
	st := NewState(c)

	if _, err := e.Travel(st, "home"); err != ErrUnknownLocation {
		t.Fatalf("hidden location should not be travelable by id, got %v", err)
	}
	out, err := e.TravelAddress(st, "12 elm st.")
	if err != nil {
		t.Fatal(err)
	}
	if out.Scenes[0].ID != "home1" || !st.Has("loc", "home") || !st.Has("doc", "collar") {
		t.Fatalf("address travel failed: %+v", out)
	}
	if len(out.Chapters) != 1 || st.Chapter != 1 {
		t.Fatalf("expected chapter two after finding the collar, got %v", out.Chapters)
	}
	out, err = e.Ask(st, "gray", "person:pike")
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Scenes) != 2 || out.Scenes[0].ID != "gray_intro" || out.Scenes[1].ID != "gray_pike" {
		t.Fatalf("expected intro then answer, got %+v", out.Scenes)
	}
	// Asking again repeats for free.
	again, _ := e.Ask(st, "gray", "person:pike")
	if !again.Scenes[0].Repeat || again.Minutes != 0 {
		t.Fatalf("repeat should be free: %+v", again)
	}
	if _, err := e.Ask(st, "pike", "intro"); err != ErrNotHere {
		t.Fatalf("pike is not at the house: %v", err)
	}
	search, _ := e.Search(st, "pike")
	if len(search.Directory) != 1 || !st.Has("loc", "docks") {
		t.Fatalf("directory search failed: %+v", search)
	}
	if _, err := e.Travel(st, "docks"); err != nil {
		t.Fatal(err)
	}
	out, _ = e.Ask(st, "pike", "doc:collar")
	if !st.Has("flag", "confessed") {
		t.Fatalf("expected confession: %+v", out)
	}
	out, _ = e.Travel(st, "home")
	if out.Scenes[0].ID != "home2" {
		t.Fatalf("expected second visit: %+v", out.Scenes)
	}
	if !e.AccusationOpen(st) {
		t.Fatal("accusation should be open")
	}
}

func TestGradeAndSeal(t *testing.T) {
	c := load(t)
	sealed, err := casefmt.Seal(c)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(sealed), "Mittens") {
		t.Fatal("sealed bundle leaks text")
	}
	c2, err := casefmt.Unseal(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if c2.Accusation.Questions[0].Answer != "" || c2.Accusation.Questions[0].AnswerHash == "" {
		t.Fatal("answers should be hashed")
	}
	e := NewEngine(c2)
	g := e.Grade(map[string]string{"who": "gray", "why": "b"})
	if g.Passed || g.Points != 5 {
		t.Fatalf("bad grade %+v", g)
	}
	g = e.Grade(map[string]string{"who": "PIKE", "why": "a"})
	if !g.Passed || g.Points != 10 {
		t.Fatalf("bad grade %+v", g)
	}
}

func TestValidate(t *testing.T) {
	c := load(t)
	rep := Validate(c)
	for _, i := range rep.Issues {
		if i.Level == "error" {
			t.Errorf("unexpected: %s", i)
		}
	}
	bad := load(t)
	bad.Locations[0].Visits[0].Reveals.Documents = []string{"nope"}
	bad.People[0].Dialogue[1].Requires = "flag:never &"
	rep = Validate(bad)
	if rep.Errors() < 2 {
		t.Fatalf("expected errors, got %v", rep.Issues)
	}
}

func TestOvernight(t *testing.T) {
	c := load(t)
	st := NewState(c)
	st.Clock = 14*60 + 50 // 22:50 on day 1
	over := st.spend(30)
	if !over || st.Day() != 2 || st.Now().Hour() != 8 || st.Now().Minute() != 30 {
		t.Fatalf("overnight failed: day %d time %v", st.Day(), st.Now())
	}
}

func TestCond(t *testing.T) {
	for _, src := range []string{"doc:a & (flag:b | !met:c)", "chapter>=2 and not flag:x", ""} {
		if _, err := casefmt.ParseCond(src); err != nil {
			t.Errorf("%q: %v", src, err)
		}
	}
	for _, src := range []string{"doc:", "(doc:a", "foo:bar", "doc:a &", "chapter>=x"} {
		if _, err := casefmt.ParseCond(src); err == nil {
			t.Errorf("%q should fail", src)
		}
	}
}

func TestAddressNormalize(t *testing.T) {
	cases := map[string]string{
		"1420 Harbor St.":        "1420 harbor street",
		"1420 harbor street, #3": "1420 harbor street",
		"88 N. Fifth Ave":        "88 north 5th avenue",
	}
	for in, want := range cases {
		if got := casefmt.NormalizeAddress(in); got != want {
			t.Errorf("%q -> %q, want %q", in, got, want)
		}
	}
}
