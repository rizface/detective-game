# Writing cases

A case is one YAML (or JSON) file. The engine is data-driven: everything a team can see, hear and find is in
the file, unlocked by small conditions. This page describes the format. For a complete small case, see
[examples/missing-cat.yaml](examples/missing-cat.yaml).

## The shape of a case

```yaml
slug: missing-cat            # URL-safe id
title: The Missing Cat
tagline: One line for the library.
blurb: A paragraph for the library card.
setting: Port Calloway, 1985
difficulty: Easy
estimatedMinutes: 20
players: 1–6
version: 1                   # bump to upgrade a bundled case on servers that already have it

clock: {...}                 # the game clock (below)
intro: |                     # markdown, read when the case opens
start: {...}                 # what the team knows at the start (a Reveal)
chapters: [...]              # the stages of the investigation
map: {...}                   # the city drawn on the board
locations: [...]             # places to travel to, with scenes
people: [...]                # characters, with dialogue
documents: [...]             # evidence to read
directory: [...]             # city directory listings
accusation: {...}            # the final report
epilogue: |                  # markdown, shown when the case ends
```

## Reveals

Scenes, answers and chapters can reveal things. Everything revealed goes into the team's case file.

```yaml
reveals:
  documents: [collar]
  locations: [docks]          # puts a hidden place on the map
  people: [pike]              # adds a dossier to People
  flags: [pike_talked]        # a named fact other conditions can test
```

## Conditions

Scenes, dialogue, presence and chapters take a `requires:` condition. Empty means always.

| Atom | True when |
|---|---|
| `doc:ID` | the team has found the document |
| `loc:ID` | the location is on the team's map |
| `visited:ID` | the team has been there |
| `person:ID` | the person is in the People list |
| `met:ID` | the team has talked to them |
| `flag:NAME` | some scene set the flag |
| `scene:ID` | a visit or dialogue entry has played |
| `chapter>=N` | the current chapter (1-based) is at least N |
| `day>=N` | the in-game day is at least N |

Combine with `&`, `|`, `!` and parentheses (or `and`, `or`, `not`). In YAML, quote a condition that starts with
`!`: `requires: "!flag:shop_closed"`.

Avoid gating anything a team *needs* on `day>=N`: there's no way to wait, so a team that's fast could get stuck.
Use days for color — a hearing on Wednesday, a funeral on Thursday.

## Locations and scenes

```yaml
- id: home
  name: Mrs. Gray's House
  address: 12 Elm Street         # what a player types; must be on a street from the map
  altAddresses: [Gray House]
  district: downtown
  x: 900                         # map coordinates
  y: 100
  kind: home                     # icon hint
  hidden: false                  # hidden places aren't on the map until revealed
  summary: One line on the map card.
  idle: Shown when a visit plays nothing new.
  visits:
    - id: home_1
      title: The client
      text: |
        Markdown prose.
      reveals: {...}
    - id: home_2
      requires: flag:pike_talked     # plays on a later visit, once this holds
      text: ...
  presence:
    - person: gray
      requires: "!flag:gone_to_sister"
```

Every visit plays once, the first time the team arrives while its condition holds. Arriving later with new
knowledge plays the new visits. A **hidden** place can still be reached by typing its address, which rewards
teams that read carefully.

## People and dialogue

```yaml
- id: gray
  name: Edna Gray
  role: The client
  age: "72"
  description: Dossier text.
  fallback: What they say about things they don't discuss.
  dialogue:
    - id: gray_intro
      topic: intro                 # first conversation
      text: ...
    - id: gray_pike
      topic: person:pike           # or loc:ID, or doc:ID (the doc must be askable)
      requires: ...
      text: ...
      reveals: {...}
    - id: gray_later
      topic: any                   # plays after any question, once its condition holds
      requires: flag:something
      text: ...
```

Asking about a topic plays every matching answer whose condition holds and hasn't played yet. If nothing new
plays, the team gets the last answer again for free, or the fallback line.

## Documents

```yaml
- id: collar
  title: A red collar
  kind: report        # report, letter, photo, newspaper, clipping, ledger, phone, cipher, note,
                      # transcript, receipt, card, telegram, map, record, ticket
  date: October 13, 1985
  source: Found in the hedge at 12 Elm Street
  askable: true       # can be raised in interviews
  body: |
    Markdown, including tables.
```

## The directory

Players find a listing by typing an exact key. By default the keys are the full name and the surname. Add
`keys` for businesses and nicknames. A listing with `location` puts that place on the map.

```yaml
directory:
  - {name: Sam Pike, address: 3 Oak Avenue, phone: CA 5-1234, location: docks}
  - name: Pike & Daughters Fishing
    keys: [pike, pike and daughters]
    address: 4 Oak Avenue
```

Decoy listings (same surname, unrelated person) make lookups feel like a real directory.

## Chapters

```yaml
chapters:
  - id: one
    title: The Cat
    brief: |
      Markdown shown when the chapter begins and kept in the case file.
    objectives: [Where was Mittens last seen?, Who was seen near the house?]
  - id: two
    title: The Truth
    requires: doc:collar          # entered as soon as this holds
```

Chapters are entered in order, as soon as the next chapter's condition holds.

## The final report

```yaml
accusation:
  intro: Markdown above the form.
  availableFrom: chapter>=2
  maxAttempts: 3
  questions:
    - id: who
      prompt: Who took the cat?
      kind: person                # pick from the people the team knows
      required: true              # all required answers must be right to solve the case
      points: 30
      answer: pike                # hashed when sealed or saved; never sent to players
      evidence: ["doc:collar", "flag:confessed"]   # the validator checks these are reachable
    - id: why
      prompt: Why?
      kind: choice
      options:
        - {id: money, label: For a ransom}
        - {id: love, label: He loved her}
      answer: love
      required: false             # bonus
      points: 10
```

## The map

The map is drawn from districts (polygons), water and parks (polygons), and streets (polylines), in an abstract
space of `width` × `height` units. Street names are what players type in addresses, so every location's street
must exist on the map (the validator warns if it doesn't). Streets take `kind: avenue | street | rail | pier` and
`dim: true` to draw them unlit.

## Clock

```yaml
clock:
  start: "1985-10-14T08:00"
  dayStartHour: 8
  dayEndHour: 23        # an action that would run past this rolls to the next morning
  travelBase: 15        # minutes per trip
  travelPerUnit: 1      # extra minutes per 100 map units
  interviewMinutes: 10
  searchMinutes: 10
  parMinutes: 2700      # a sharp agency's time; used for the score
```

## Tools

```sh
cd backend
go run ./cmd/casepack validate my-case.yaml        # errors, warnings, reachability, stats
go run ./cmd/casepack play my-case.yaml path.play  # play a scripted path and check expectations
go run ./cmd/casepack seal my-case.yaml cases/my-case.dgcase
go run ./cmd/casepack unseal cases/my-case.dgcase out.json   # spoilers!
```

A play script is one action per line:

```
travel morgue
address 12 Elm Street
ask gray                    # intro
ask gray person:pike
search Pike
travel docks
expect doc:collar & chapter>=2
```

Sealed bundles (`*.dgcase` in `backend/cases/`) are installed into the database when the server starts, and
upgraded when their `version` goes up. The editor won't open a sealed case unless you insist, so a case can sit
in a repository without spoiling it for people who'll play it.
