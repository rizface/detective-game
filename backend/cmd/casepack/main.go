// Command casepack validates, seals and unseals case files.
//
//	casepack validate <case.yaml|case.json|case.dgcase>   check a case and print stats
//	casepack seal <case.yaml> <out.dgcase>                validate, hash answers, seal
//	casepack unseal <case.dgcase> <out.json>              recover the full case (spoilers!)
//	casepack play <case> <script.txt>                     play a scripted path and check expectations
//
// A play script has one action per line:
//
//	travel <location-id>       address <typed address>     search <name>
//	ask <person-id> <topic>    expect <condition>          # comment
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/rizface/detective-game/backend/internal/casefmt"
	"github.com/rizface/detective-game/backend/internal/game"
)

func main() {
	if len(os.Args) < 3 {
		usage()
	}
	switch os.Args[1] {
	case "validate":
		c := load(os.Args[2])
		rep := game.Validate(c)
		show(rep, len(os.Args) > 3 && os.Args[3] == "-q")
		if rep.Errors() > 0 {
			os.Exit(1)
		}
	case "seal":
		if len(os.Args) < 4 {
			usage()
		}
		c := load(os.Args[2])
		rep := game.Validate(c)
		show(rep, true)
		if rep.Errors() > 0 {
			fmt.Fprintln(os.Stderr, "not sealing: fix the errors first")
			os.Exit(1)
		}
		out, err := casefmt.Seal(c)
		check(err)
		check(os.WriteFile(os.Args[3], out, 0o644))
		fmt.Printf("sealed %s (v%d) -> %s\n", c.Slug, c.Version, os.Args[3])
	case "unseal":
		if len(os.Args) < 4 {
			usage()
		}
		fmt.Fprintln(os.Stderr, "Unsealing reveals the whole story, including the solution's evidence trail.")
		c := load(os.Args[2])
		out, err := json.MarshalIndent(c, "", "  ")
		check(err)
		check(os.WriteFile(os.Args[3], out, 0o644))
	case "play":
		if len(os.Args) < 4 {
			usage()
		}
		os.Exit(play(load(os.Args[2]), os.Args[3]))
	default:
		usage()
	}
}

func play(c *casefmt.Case, script string) int {
	data, err := os.ReadFile(script)
	check(err)
	e := game.NewEngine(c)
	st := game.NewState(c)
	failures := 0
	for n, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		verb, rest, _ := strings.Cut(line, " ")
		var out *game.Outcome
		switch verb {
		case "travel":
			out, err = e.Travel(st, rest)
		case "address":
			out, err = e.TravelAddress(st, rest)
		case "search":
			out, err = e.Search(st, rest)
		case "ask":
			person, topic, _ := strings.Cut(rest, " ")
			if topic == "" {
				topic = "intro"
			}
			out, err = e.Ask(st, person, topic)
		case "expect":
			cond, perr := casefmt.ParseCond(rest)
			if perr != nil {
				fmt.Printf("%3d  !! bad condition: %v\n", n+1, perr)
				failures++
				continue
			}
			if !cond.Eval(stateFacts{st}) {
				fmt.Printf("%3d  !! EXPECT FAILED: %s\n", n+1, rest)
				failures++
			}
			continue
		default:
			fmt.Printf("%3d  !! unknown verb %q\n", n+1, verb)
			failures++
			continue
		}
		if err != nil {
			fmt.Printf("%3d  !! %s: %v\n", n+1, line, err)
			failures++
			continue
		}
		var titles []string
		for _, sc := range out.Scenes {
			label := sc.ID
			if sc.Repeat {
				label += "(repeat)"
			}
			titles = append(titles, label)
		}
		fmt.Printf("%3d  %-40s +%3dm  day %d %s  %s", n+1, line, out.Minutes, st.Day(), st.Now().Format("15:04"), strings.Join(titles, ", "))
		r := out.Revealed
		if !r.Empty() {
			fmt.Printf("  => docs%v locs%v people%v flags%v", r.Documents, r.Locations, r.People, r.Flags)
		}
		if len(out.Chapters) > 0 {
			fmt.Printf("  ** CHAPTER %v", out.Chapters)
		}
		fmt.Println()
	}
	fmt.Printf("\nchapter %d · active %d min · %d actions · %d docs · %d failures\n",
		st.Chapter+1, st.Active, st.Actions, len(st.IDs("doc")), failures)
	if failures > 0 {
		return 1
	}
	return 0
}

type stateFacts struct{ s *game.State }

func (f stateFacts) Has(kind, id string) bool { return f.s.Has(kind, id) }
func (f stateFacts) Chapter() int             { return f.s.ChapterNum() }
func (f stateFacts) Day() int                 { return f.s.Day() }

func load(path string) *casefmt.Case {
	data, err := os.ReadFile(path)
	check(err)
	c, err := casefmt.Load(data)
	check(err)
	return c
}

func show(rep game.Report, quiet bool) {
	errs, warns := 0, 0
	for _, i := range rep.Issues {
		if i.Level == "error" {
			errs++
		} else {
			warns++
		}
		if !quiet || i.Level == "error" {
			fmt.Println(i)
		}
	}
	s := rep.Stats
	fmt.Printf("\n%d errors, %d warnings\n", errs, warns)
	fmt.Printf("chapters %d · locations %d · people %d · documents %d · scenes %d · directory %d\n",
		s.Chapters, s.Locations, s.People, s.Documents, s.Scenes, s.DirectoryEntries)
	fmt.Printf("words %d (reachable %d) · estimated play %d min · exhaustive in-game time %d min\n",
		s.Words, s.ReachableWords, s.EstimatedMinutes, s.ExhaustiveActive)
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: casepack validate|seal|unseal|play <in> [out|script]")
	os.Exit(2)
}
