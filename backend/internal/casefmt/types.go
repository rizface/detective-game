// Package casefmt defines the data format for detective cases: the city map,
// locations, people, documents, unlock conditions and the final accusation.
//
// A case is pure data. The game engine (package game) interprets it, the
// validator checks it for broken references and unreachable content, and the
// sealer packs it into an obfuscated bundle so the story can live in a public
// or shared repository without spoiling anyone who browses the files.
package casefmt

// Case is the root of a case file.
type Case struct {
	Slug             string `json:"slug" yaml:"slug"`
	Title            string `json:"title" yaml:"title"`
	Tagline          string `json:"tagline" yaml:"tagline"`
	Blurb            string `json:"blurb" yaml:"blurb"`             // shown in the case library
	Setting          string `json:"setting" yaml:"setting"`         // e.g. "Port Aurelia, October 1985"
	Difficulty       string `json:"difficulty" yaml:"difficulty"`   // free text: "Hard"
	EstimatedMinutes int    `json:"estimatedMinutes" yaml:"estimatedMinutes"`
	Players          string `json:"players" yaml:"players"` // "2–6"
	Version          int    `json:"version" yaml:"version"`

	Clock      Clock      `json:"clock" yaml:"clock"`
	Intro      string     `json:"intro" yaml:"intro"` // markdown, read at the start
	Start      Reveal     `json:"start" yaml:"start"` // what the team knows at the start
	Chapters   []Chapter  `json:"chapters" yaml:"chapters"`
	Map        Map        `json:"map" yaml:"map"`
	Locations  []Location `json:"locations" yaml:"locations"`
	People     []Person   `json:"people" yaml:"people"`
	Documents  []Document `json:"documents" yaml:"documents"`
	Directory  []DirEntry `json:"directory" yaml:"directory"`
	Accusation Accusation `json:"accusation" yaml:"accusation"`
	Epilogue   string     `json:"epilogue" yaml:"epilogue"` // revealed when the case ends
}

// Clock controls the in-game calendar. Every action costs time; the team's
// final score compares the time they used against Par.
type Clock struct {
	Start            string `json:"start" yaml:"start"`                       // "1985-10-14T08:00"
	DayStartHour     int    `json:"dayStartHour" yaml:"dayStartHour"`         // 8
	DayEndHour       int    `json:"dayEndHour" yaml:"dayEndHour"`             // 23
	TravelBase       int    `json:"travelBase" yaml:"travelBase"`             // minutes per trip
	TravelPerUnit    int    `json:"travelPerUnit" yaml:"travelPerUnit"`       // extra minutes per 100 map units
	InterviewMinutes int    `json:"interviewMinutes" yaml:"interviewMinutes"` // per question
	SearchMinutes    int    `json:"searchMinutes" yaml:"searchMinutes"`       // directory lookups
	ParMinutes       int    `json:"parMinutes" yaml:"parMinutes"`
}

// Chapter is a stage of the investigation. The team enters a chapter as soon
// as its Requires condition holds; chapters are entered in order.
type Chapter struct {
	ID         string   `json:"id" yaml:"id"`
	Title      string   `json:"title" yaml:"title"`
	Requires   string   `json:"requires,omitempty" yaml:"requires,omitempty"`
	Brief      string   `json:"brief" yaml:"brief"` // markdown
	Objectives []string `json:"objectives,omitempty" yaml:"objectives,omitempty"`
	Reveals    Reveal   `json:"reveals,omitempty" yaml:"reveals,omitempty"`
}

// Map describes the stylised city drawn on the game board. Coordinates are in
// an abstract space of Width x Height units.
type Map struct {
	Name      string     `json:"name" yaml:"name"`
	Width     float64    `json:"width" yaml:"width"`
	Height    float64    `json:"height" yaml:"height"`
	Districts []District `json:"districts" yaml:"districts"`
	Water     []Shape    `json:"water,omitempty" yaml:"water,omitempty"`
	Parks     []Shape    `json:"parks,omitempty" yaml:"parks,omitempty"`
	Streets   []Street   `json:"streets" yaml:"streets"`
}

type Point [2]float64

type Shape struct {
	Name   string  `json:"name,omitempty" yaml:"name,omitempty"`
	Points []Point `json:"points" yaml:"points"`
}

type District struct {
	ID     string  `json:"id" yaml:"id"`
	Name   string  `json:"name" yaml:"name"`
	Points []Point `json:"points" yaml:"points"`
	Label  Point   `json:"label" yaml:"label"`
	Tone   string  `json:"tone,omitempty" yaml:"tone,omitempty"` // colour hint for the client
	Blurb  string  `json:"blurb,omitempty" yaml:"blurb,omitempty"`
}

type Street struct {
	Name   string  `json:"name" yaml:"name"`
	Kind   string  `json:"kind,omitempty" yaml:"kind,omitempty"` // "avenue", "street", "highway", "rail"
	Points []Point `json:"points" yaml:"points"`
}

// Location is a place the team can travel to.
//
// Hidden locations do not appear on the map until revealed, but the team can
// still reach them by typing the address into the travel box, which is how a
// sharp-eyed team skips ahead.
type Location struct {
	ID           string     `json:"id" yaml:"id"`
	Name         string     `json:"name" yaml:"name"`
	Address      string     `json:"address" yaml:"address"`
	AltAddresses []string   `json:"altAddresses,omitempty" yaml:"altAddresses,omitempty"`
	District     string     `json:"district" yaml:"district"`
	X            float64    `json:"x" yaml:"x"`
	Y            float64    `json:"y" yaml:"y"`
	Kind         string     `json:"kind" yaml:"kind"` // icon hint: home, office, bar, police, ...
	Hidden       bool       `json:"hidden,omitempty" yaml:"hidden,omitempty"`
	Summary      string     `json:"summary" yaml:"summary"` // one line shown on the map
	Visits       []Visit    `json:"visits" yaml:"visits"`
	Presence     []Presence `json:"presence,omitempty" yaml:"presence,omitempty"`
	Idle         string     `json:"idle,omitempty" yaml:"idle,omitempty"` // shown when nothing new happens
}

// Visit is a scene that plays when the team arrives at a location and its
// condition holds. Each visit plays once; arriving later with new knowledge can
// unlock further visits at the same place.
type Visit struct {
	ID       string `json:"id" yaml:"id"`
	Title    string `json:"title,omitempty" yaml:"title,omitempty"`
	Requires string `json:"requires,omitempty" yaml:"requires,omitempty"`
	Text     string `json:"text" yaml:"text"`
	Reveals  Reveal `json:"reveals,omitempty" yaml:"reveals,omitempty"`
}

// Presence says a person can be interviewed at a location while Requires holds.
type Presence struct {
	Person   string `json:"person" yaml:"person"`
	Requires string `json:"requires,omitempty" yaml:"requires,omitempty"`
}

// Person is a character. Talking to a person and asking about a topic plays
// the first matching Dialogue entry, or the Fallback line.
type Person struct {
	ID          string     `json:"id" yaml:"id"`
	Name        string     `json:"name" yaml:"name"`
	Role        string     `json:"role" yaml:"role"`
	Description string     `json:"description" yaml:"description"` // dossier text
	Age         string     `json:"age,omitempty" yaml:"age,omitempty"`
	Dialogue    []Dialogue `json:"dialogue,omitempty" yaml:"dialogue,omitempty"`
	Fallback    string     `json:"fallback,omitempty" yaml:"fallback,omitempty"`
}

// Dialogue is one answer. Topic is "intro" (first conversation), or a
// reference such as "person:rosa", "doc:matchbook", "loc:pier9".
type Dialogue struct {
	ID       string `json:"id" yaml:"id"`
	Topic    string `json:"topic" yaml:"topic"`
	Requires string `json:"requires,omitempty" yaml:"requires,omitempty"`
	Text     string `json:"text" yaml:"text"`
	Reveals  Reveal `json:"reveals,omitempty" yaml:"reveals,omitempty"`
}

// Document is a piece of evidence the team can read.
type Document struct {
	ID      string `json:"id" yaml:"id"`
	Title   string `json:"title" yaml:"title"`
	Kind    string `json:"kind" yaml:"kind"` // report, letter, photo, newspaper, ledger, phone, cipher, note, transcript, receipt, card
	Date    string `json:"date,omitempty" yaml:"date,omitempty"`
	Source  string `json:"source,omitempty" yaml:"source,omitempty"` // where it came from
	Body    string `json:"body" yaml:"body"`                         // markdown
	Askable bool   `json:"askable,omitempty" yaml:"askable,omitempty"`
}

// DirEntry is a line in the city directory. Searching an exact key (a surname
// or business name) shows the entry; if it links a location, that location is
// revealed on the map.
type DirEntry struct {
	Name     string   `json:"name" yaml:"name"`
	Keys     []string `json:"keys,omitempty" yaml:"keys,omitempty"`
	Address  string   `json:"address" yaml:"address"`
	Phone    string   `json:"phone,omitempty" yaml:"phone,omitempty"`
	Note     string   `json:"note,omitempty" yaml:"note,omitempty"`
	Location string   `json:"location,omitempty" yaml:"location,omitempty"`
}

// Reveal lists what becomes known when a scene plays.
type Reveal struct {
	Documents []string `json:"documents,omitempty" yaml:"documents,omitempty"`
	Locations []string `json:"locations,omitempty" yaml:"locations,omitempty"`
	People    []string `json:"people,omitempty" yaml:"people,omitempty"`
	Flags     []string `json:"flags,omitempty" yaml:"flags,omitempty"`
}

func (r Reveal) Empty() bool {
	return len(r.Documents) == 0 && len(r.Locations) == 0 && len(r.People) == 0 && len(r.Flags) == 0
}

// Accusation is the final report the team files.
type Accusation struct {
	Intro          string     `json:"intro" yaml:"intro"`
	AvailableFrom  string     `json:"availableFrom,omitempty" yaml:"availableFrom,omitempty"` // condition
	MaxAttempts    int        `json:"maxAttempts" yaml:"maxAttempts"`
	Salt           string     `json:"salt" yaml:"salt"`
	Questions      []Question `json:"questions" yaml:"questions"`
	SuccessMessage string     `json:"successMessage,omitempty" yaml:"successMessage,omitempty"`
}

// Question is one item of the final report. Kind "person" lets the team pick
// any person they know; kind "choice" offers fixed Options.
//
// Answer holds the correct option in source form. It is replaced by AnswerHash
// when the case is sealed or saved through the editor, so the stored case never
// contains the solution in plain text.
type Question struct {
	ID         string   `json:"id" yaml:"id"`
	Prompt     string   `json:"prompt" yaml:"prompt"`
	Kind       string   `json:"kind" yaml:"kind"` // person | choice
	Options    []Option `json:"options,omitempty" yaml:"options,omitempty"`
	Required   bool     `json:"required" yaml:"required"`
	Points     int      `json:"points" yaml:"points"`
	Answer     string   `json:"answer,omitempty" yaml:"answer,omitempty"`
	AnswerHash string   `json:"answerHash,omitempty" yaml:"answerHash,omitempty"`
	Evidence   []string `json:"evidence,omitempty" yaml:"evidence,omitempty"` // refs that support the answer (validator)
}

type Option struct {
	ID    string `json:"id" yaml:"id"`
	Label string `json:"label" yaml:"label"`
}
