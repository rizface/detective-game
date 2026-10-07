// Command casepack validates, seals and unseals case files.
//
//	casepack validate <case.yaml|case.json|case.dgcase>   check a case and print stats
//	casepack seal <case.yaml> <out.dgcase>                validate, hash answers, seal
//	casepack unseal <case.dgcase> <out.json>              recover the full case (spoilers!)
package main

import (
	"encoding/json"
	"fmt"
	"os"

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
	default:
		usage()
	}
}

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
	fmt.Fprintln(os.Stderr, "usage: casepack validate|seal|unseal <in> [out]")
	os.Exit(2)
}
